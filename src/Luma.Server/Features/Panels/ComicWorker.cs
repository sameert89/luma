using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Indexing;
using Luma.Server.Features.Files;
using Luma.Server.MediaProcessing;

namespace Luma.Server.Features.Panels;

public sealed class ComicWorker(Database database, IndexingOptions options, ComicLibrary library, ComicPageContent pages,
    ILogger<ComicWorker> logger, Luma.Server.Features.Settings.UiConfiguration? settings = null) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (options.Libraries.Count == 0) return;
        await using (var db = await database.OpenAsync(stoppingToken))
        {
            if (await db.ExecuteScalarAsync<bool>(new CommandDefinition("SELECT EXISTS(SELECT 1 FROM ComicJobs WHERE State='running')", cancellationToken: stoppingToken)))
            {
                await database.YieldToForegroundAsync(stoppingToken);
                await db.ExecuteAsync(new CommandDefinition("UPDATE ComicJobs SET State='queued' WHERE State='running'", cancellationToken: stoppingToken));
            }
        }
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (settings?.Applications.PanelsEnabled == false) { await Task.Delay(1000, stoppingToken); continue; }
                await new ComicDiscovery(database, options).ProcessPendingAsync(stoppingToken);
                await using var db = await database.OpenAsync(stoppingToken);
                // Idle discovery is a read, not a recurring SQLite writer competing with likes/tags.
                if (!await db.ExecuteScalarAsync<bool>(new CommandDefinition("SELECT EXISTS(SELECT 1 FROM ComicJobs WHERE State='queued')", cancellationToken: stoppingToken)))
                {
                    await Task.Delay(1000, stoppingToken);
                    continue;
                }
                await database.YieldToForegroundAsync(stoppingToken);
                var job = await db.QuerySingleOrDefaultAsync<ComicJob>(new CommandDefinition($"""
                    UPDATE ComicJobs SET State='running' WHERE Id=(SELECT j.Id FROM ComicJobs j JOIN Libraries l ON l.Id=j.LibraryId
                      WHERE j.State='queued' AND l.Enabled=1 AND NOT EXISTS(SELECT 1 FROM FileOperations WHERE LibraryId=j.LibraryId AND State IN ({FileOperations.ActiveStates}))
                      ORDER BY j.Id LIMIT 1) RETURNING *
                    """, cancellationToken: stoppingToken));
                if (job is null) { await Task.Delay(1000, stoppingToken); continue; }
                await ProcessAsync(job, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception error) { logger.LogError(error, "Comic worker could not claim work"); await Task.Delay(1000, stoppingToken); }
        }
    }
    internal async Task ProcessAsync(ComicJob job, CancellationToken ct)
    {
        var root = options.Libraries.Find(x => x.Id == job.LibraryId);
        try
        {
            if (root is null) throw new IOException();
            var recursiveReconciliation = !job.Shallow;
            if (job.Source is not null && !job.Recursive && !job.Shallow)
                await IndexAsync(job, root, job.Source, ct);
            else
            {
                var discoveryRoot = ResolveDiscoveryPath(root, job.Source ?? "");
                if (Directory.Exists(discoveryRoot))
                    await DiscoverFolderAsync(job, root, job.Source ?? "", 0, ct);
                else
                {
                    // A deleted location may be reconciled only while its library is accessible.
                    if (!Directory.Exists(SourcePaths.Resolve(root, ""))) throw new IOException();
                    if (File.Exists(discoveryRoot)) throw new IOException();
                    recursiveReconciliation = true;
                }
            }
            await database.YieldToForegroundAsync(ct);
            await using var db = await database.OpenAsync(ct);
            using var tx = db.BeginTransaction();
            if (!await IsRunningAsync(db, job, ct, tx)) return;
            if ((job.Recursive || job.Shallow || job.Source is null) &&
                await db.ExecuteScalarAsync<int>(new CommandDefinition("SELECT Failed FROM ComicJobs WHERE Id=@Id", job, tx, cancellationToken: ct)) == 0)
            {
                var key = root.Key(job.Source ?? "");
                // Seek the job subtree; shallow scans also retire descendants of removed immediate directories.
                await db.ExecuteAsync(new CommandDefinition("""
                    UPDATE Comics SET Availability='missing' WHERE LibraryId=@LibraryId
                      AND PathKey>=@key AND PathKey<@end AND COALESCE(LastJobId,0)<>@Id
                      AND (@key='' OR PathKey=@key OR (PathKey>=@prefix AND PathKey<@branchEnd))
                      AND NOT (Format='folder' AND NOT @images AND EXISTS(SELECT 1 FROM ComicFolders observed
                        WHERE observed.LibraryId=@LibraryId AND observed.PathKey=Comics.PathKey
                          AND (observed.SeenJobId=@Id OR observed.LastJobId=@Id)))
                      AND (@recursive OR PathKey=@key OR (Format<>'folder' AND instr(substr(PathKey,length(@prefix)+1),'/')=0)
                        OR EXISTS(SELECT 1 FROM ComicFolders visited WHERE visited.LibraryId=@LibraryId AND visited.LastJobId=@Id
                          AND (Comics.PathKey=visited.PathKey OR (Comics.Format<>'folder'
                            AND Comics.PathKey>=visited.PathKey||'/' AND Comics.PathKey<visited.PathKey||'0'
                            AND instr(substr(Comics.PathKey,length(visited.PathKey)+2),'/')=0)))
                        OR EXISTS(SELECT 1 FROM ComicFolders f WHERE f.LibraryId=@LibraryId
                          AND f.ParentKey=@key AND COALESCE(f.SeenJobId,0)<>@Id
                          AND (Comics.PathKey=f.PathKey OR (Comics.PathKey>=f.PathKey||'/' AND Comics.PathKey<f.PathKey||'0'))))
                    """, new { job.LibraryId, job.Id, key, end = key + "\U0010FFFF", prefix = key.Length == 0 ? "" : key + "/", branchEnd = key + "0", recursive = recursiveReconciliation, images = job.ImageFolders }, tx, cancellationToken: ct));
            }
            await db.ExecuteAsync(new CommandDefinition("UPDATE ComicJobs SET State='completed' WHERE Id=@Id AND State='running'", job, tx, cancellationToken: ct));
            tx.Commit();
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception error)
        {
            logger.LogWarning(error, "Comic job {Job} failed", job.Id);
            await using var db = await database.OpenAsync(ct);
            await db.ExecuteAsync(new CommandDefinition("UPDATE ComicJobs SET State='failed',FailureCode='comic_source_unavailable' WHERE Id=@Id AND State='running'", job, cancellationToken: ct));
        }
    }
    private static string ResolveDiscoveryPath(LibraryOptions root, string relative)
    {
        SourcePaths.Check(root, root.Path);
        try { return SourcePaths.Resolve(root, relative); }
        catch (Exception error) when (error is FileNotFoundException or DirectoryNotFoundException)
        {
            // Resolve checked every existing ancestor for links before encountering the missing entry.
            return Path.GetFullPath(Path.Combine(root.Path, relative));
        }
    }

    private static Task<bool> IsRunningAsync(Microsoft.Data.Sqlite.SqliteConnection db, ComicJob job, CancellationToken ct, Microsoft.Data.Sqlite.SqliteTransaction? tx = null) =>
        db.ExecuteScalarAsync<bool>(new CommandDefinition("SELECT EXISTS(SELECT 1 FROM ComicJobs WHERE Id=@Id AND State='running')", job, tx, cancellationToken: ct));

    private async Task DiscoverFolderAsync(ComicJob job, LibraryOptions root, string relative, int depth, CancellationToken ct)
    {
        if (depth >= 128) throw new IOException("Directory depth limit exceeded.");
        var source = SourcePaths.Resolve(root, relative);
        var ticks = Directory.GetLastWriteTimeUtc(source).Ticks;
        var hasImages = false;
        var count = 0;
        foreach (var entry in SourceTraversal.Enumerate(source, recursive: false))
        {
            ct.ThrowIfCancellationRequested();
            if (count++ % 32 == 0)
            {
                await using var state = await database.OpenAsync(ct);
                if (!await IsRunningAsync(state, job, ct)) throw new OperationCanceledException();
            }
            var child = Path.GetRelativePath(root.Path, entry.FullName).Replace(Path.DirectorySeparatorChar, '/');
            if (entry is DirectoryInfo)
            {
                bool known;
                await using (var lookup = await database.OpenAsync(ct))
                    known = await lookup.ExecuteScalarAsync<bool>(new CommandDefinition("""
                    SELECT EXISTS(SELECT 1 FROM ComicFolders f JOIN ComicJobs j ON j.Id=f.LastJobId
                      WHERE f.LibraryId=@LibraryId AND f.PathKey=@key AND j.State='completed' AND j.Failed=0
                        AND f.SeenJobId=(SELECT p.LastJobId FROM ComicFolders p WHERE p.LibraryId=f.LibraryId AND p.PathKey=f.ParentKey))
                    """, new { job.LibraryId, key = root.Key(child) }, cancellationToken: ct));
                if (!job.Shallow || depth > 0 || !known)
                    await DiscoverFolderAsync(job, root, child, depth + 1, ct);
                await database.YieldToForegroundAsync(ct);
                await using var db = await database.OpenAsync(ct);
                await db.ExecuteAsync(new CommandDefinition("UPDATE ComicFolders SET SeenJobId=@Id WHERE LibraryId=@LibraryId AND PathKey=@key",
                    new { job.Id, job.LibraryId, key = root.Key(child) }, cancellationToken: ct));
            }
            else
            {
                if (ComicSources.IsImage(entry.Name)) hasImages = true;
                if (ComicSources.IsBook(entry.Name)) await TryIndexAsync(job, root, child, ct);
            }
        }
        if (hasImages && job.ImageFolders) await TryIndexAsync(job, root, relative, ct);
        // Capture the time observed before enumeration, so a concurrent modification triggers another refresh.
        await database.YieldToForegroundAsync(ct);
        await using var checkpoint = await database.OpenAsync(ct);
        using var tx = checkpoint.BeginTransaction();
        if (!await IsRunningAsync(checkpoint, job, ct, tx)) throw new OperationCanceledException();
        await checkpoint.ExecuteAsync(new CommandDefinition("""
            INSERT INTO ComicFolders(LibraryId,RelativePath,PathKey,ParentKey,SourceModifiedTicks,LastJobId,SeenJobId)
            VALUES(@LibraryId,@relative,@key,@parent,@ticks,@Id,@Id)
            ON CONFLICT(LibraryId,PathKey) DO UPDATE SET SourceModifiedTicks=excluded.SourceModifiedTicks,LastJobId=excluded.LastJobId
            """, new { job.LibraryId, job.Id, relative, key = root.Key(relative), parent = relative.Length == 0 ? null : root.Key(relative.Contains('/') ? relative[..relative.LastIndexOf('/')] : ""), ticks }, tx, cancellationToken: ct));
        tx.Commit();
    }

    private async Task TryIndexAsync(ComicJob job, LibraryOptions root, string relative, CancellationToken ct)
    {
        try { await IndexAsync(job, root, relative, ct); }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            logger.LogWarning(error, "Comic discovery failed for job {Job}", job.Id);
            await using var db = await database.OpenAsync(ct);
            await db.ExecuteAsync(new CommandDefinition("UPDATE ComicJobs SET Failed=Failed+1,FailureCode='comic_source_rejected' WHERE Id=@Id", job, cancellationToken: ct));
        }
    }

    private async Task IndexAsync(ComicJob job, LibraryOptions root, string relative, CancellationToken ct)
    {
        var source = SourcePaths.Resolve(root, relative);
        var directory = Directory.Exists(source);
        var pdf = !directory && ComicSources.IsPdf(source);
        var modified = File.GetLastWriteTimeUtc(source).Ticks;
        var size = directory ? 0 : new FileInfo(source).Length;
        string? fingerprint = "v1";
        if (directory)
        {
            // Hash only bounded directory metadata, never page contents. In-place image edits need
            // invalidation even when the directory's own timestamp does not change.
            using var hash = System.Security.Cryptography.IncrementalHash.CreateHash(System.Security.Cryptography.HashAlgorithmName.SHA256);
            var count = 0;
            foreach (var entry in new DirectoryInfo(source).EnumerateFileSystemInfos().Take(ComicSources.MaximumEntries + 1).OrderBy(x => x.Name, StringComparer.Ordinal))
            {
                ct.ThrowIfCancellationRequested();
                if (++count > ComicSources.MaximumEntries || entry.Attributes.HasFlag(FileAttributes.ReparsePoint)) throw new IOException();
                if (entry is not FileInfo file || (!ComicSources.IsImage(file.Name) && !file.Name.Equals("ComicInfo.xml", StringComparison.OrdinalIgnoreCase))) continue;
                hash.AppendData(System.Text.Encoding.UTF8.GetBytes(System.Text.Json.JsonSerializer.Serialize(new { file.Name, file.Length, Ticks = file.LastWriteTimeUtc.Ticks })));
            }
            fingerprint = Convert.ToHexString(hash.GetHashAndReset());
        }
        if (job.Automatic)
        {
            await using var lookup = await database.OpenAsync(ct);
            var existing = await lookup.QuerySingleOrDefaultAsync<ComicRow>(new CommandDefinition("SELECT * FROM Comics WHERE LibraryId=@LibraryId AND PathKey=@key",
                new { job.LibraryId, key = root.Key(relative) }, cancellationToken: ct));
            if (existing is not null && existing.SourceSize == size && existing.SourceModifiedTicks == modified && existing.SourceFingerprint == fingerprint)
            {
                await database.YieldToForegroundAsync(ct);
                await lookup.ExecuteAsync(new CommandDefinition("UPDATE Comics SET Availability='present',LastJobId=@Id WHERE Id=@comicId",
                    new { job.Id, comicId = existing.Id }, cancellationToken: ct));
                var comic = await library.GetAsync(existing.Id, ct);
                if (!comic.HasCover) await pages.PrepareAsync(comic, comic.CoverPage, "cover", ct);
                return;
            }
        }
        var inspection = pdf ? new ComicInspection(await PdfComics.InspectAsync(source, options, ct), null) : await ComicSources.InspectIsolatedAsync(source, directory, ct);
        var sources = inspection.Pages;
        // Never commit a successful fingerprint for a source that changed during inspection.
        if (!directory && (new FileInfo(source).Length != size || File.GetLastWriteTimeUtc(source).Ticks != modified)) throw new IOException("Comic changed during discovery.");
        await database.YieldToForegroundAsync(ct);
        await using var db = await database.OpenAsync(ct);
        using (var tx = db.BeginTransaction())
        {
            if (!await IsRunningAsync(db, job, ct, tx)) throw new OperationCanceledException();
            var id = await db.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO Comics(LibraryId,RelativePath,PathKey,Format,Title,PageCount,SourceSize,SourceModifiedTicks,SourceFingerprint,AddedAt,LastJobId)
                VALUES(@LibraryId,@relative,@key,@format,@title,@count,@size,@modified,@fingerprint,@now,@Id)
                ON CONFLICT(LibraryId,PathKey) DO UPDATE SET
                  PageCount=excluded.PageCount,SourceSize=excluded.SourceSize,SourceModifiedTicks=excluded.SourceModifiedTicks,
                  Revision=Comics.Revision+CASE WHEN Comics.SourceSize<>excluded.SourceSize OR Comics.SourceModifiedTicks<>excluded.SourceModifiedTicks OR COALESCE(Comics.SourceFingerprint,'')<>COALESCE(excluded.SourceFingerprint,'') THEN 1 ELSE 0 END,
                  SourceFingerprint=excluded.SourceFingerprint,Availability='present',LastJobId=excluded.LastJobId RETURNING Id;
                """, new { job.LibraryId, job.Id, relative, key = root.Key(relative), format = directory ? "folder" : pdf ? "pdf" : Path.GetExtension(relative).ToLowerInvariant() is ".cbz" or ".zip" ? "zip" : "rar", title = Path.GetFileNameWithoutExtension(relative.Length == 0 ? root.Name : relative), count = sources.Count, size, modified, fingerprint, now = DateTimeOffset.UtcNow.ToString("O") }, tx, cancellationToken: ct));
            await ImportMetadataAsync(db, tx, id, inspection.Metadata, sources.Count, Path.GetFileNameWithoutExtension(relative.Length == 0 ? root.Name : relative), ct);
            await db.ExecuteAsync(new CommandDefinition("DELETE FROM ComicPages WHERE ComicId=@id", new { id }, tx, cancellationToken: ct));
            await db.ExecuteAsync(new CommandDefinition("""
                INSERT INTO ComicPages(ComicId,PageIndex,EntryName,SizeBytes)
                  SELECT @id,CAST(key AS INTEGER),json_extract(value,'$.Name'),json_extract(value,'$.SizeBytes')
                  FROM json_each(@pages)
                """, new { id, pages = System.Text.Json.JsonSerializer.Serialize(sources) }, tx, cancellationToken: ct));
            await db.ExecuteAsync(new CommandDefinition("UPDATE ComicJobs SET Processed=Processed+1 WHERE Id=@Id", job, tx, cancellationToken: ct));
            tx.Commit();
            // Cover work uses the shared bounded decoder pool and task, after indexing commits.
            var comic = await library.GetAsync(id, ct);
            await pages.PrepareAsync(comic, comic.CoverPage, "cover", ct);
        }
    }
    private static async Task ImportMetadataAsync(Microsoft.Data.Sqlite.SqliteConnection db, Microsoft.Data.Sqlite.SqliteTransaction tx,
        long id, ComicMetadata? metadata, int pageCount, string fallbackTitle, CancellationToken ct)
    {
        if (metadata is null) return;
        var row = await db.QuerySingleAsync<ComicRow>(new CommandDefinition("SELECT * FROM Comics WHERE Id=@id", new { id }, tx, cancellationToken: ct));
        var previous = row.ImportedMetadata is null ? null : System.Text.Json.JsonSerializer.Deserialize<ComicMetadata>(row.ImportedMetadata);
        metadata = metadata with { Title = metadata.Title.Length == 0 ? fallbackTitle : metadata.Title, CoverPage = metadata.CoverPage < pageCount ? metadata.CoverPage : 0 };
        // On first import, fill empty fields/the filename title; thereafter only replace values we imported.
        string Merge(string value, string? old, string imported, string fallback = "") => value == (old ?? fallback) ? imported : value;
        var cover = row.CoverPage == (previous?.CoverPage ?? 0) ? metadata.CoverPage : Math.Min(row.CoverPage, pageCount - 1);
        await db.ExecuteAsync(new CommandDefinition("""
            UPDATE Comics SET Title=@title,Series=@series,Author=@author,Description=@description,CoverPage=@cover,
              Revision=Revision+CASE WHEN CoverPage<>@cover THEN 1 ELSE 0 END,ImportedMetadata=@snapshot WHERE Id=@id
            """, new
        {
            id,
            title = Merge(row.Title, previous?.Title, metadata.Title, fallbackTitle),
            series = Merge(row.Series, previous?.Series, metadata.Series),
            author = Merge(row.Author, previous?.Author, metadata.Author),
            description = Merge(row.Description, previous?.Description, metadata.Description),
            cover,
            snapshot = System.Text.Json.JsonSerializer.Serialize(metadata)
        }, tx, cancellationToken: ct));
        // Union tags, just like other metadata imports. Never remove application tags.
        var remaining = 100 - await db.ExecuteScalarAsync<int>(new CommandDefinition("SELECT COUNT(*) FROM ComicTags WHERE ComicId=@id", new { id }, tx, cancellationToken: ct));
        foreach (var name in metadata.Tags)
        {
            if (remaining <= 0) break;
            var normalized = Luma.Server.Features.Tags.TagText.Normalize(name);
            await db.ExecuteAsync(new CommandDefinition("INSERT INTO Tags(Name,NormalizedKey) VALUES(@Name,@Key) ON CONFLICT DO NOTHING", new { normalized.Name, normalized.Key }, tx, cancellationToken: ct));
            remaining -= await db.ExecuteAsync(new CommandDefinition("INSERT INTO ComicTags(ComicId,TagId) SELECT @id,Id FROM Tags WHERE NormalizedKey=@Key ON CONFLICT DO NOTHING", new { id, normalized.Key }, tx, cancellationToken: ct));
        }
    }

}
