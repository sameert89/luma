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
            if (job.Source is not null && !job.Recursive)
                await IndexAsync(job, root, job.Source, ct);
            else
            {
                var discoveryRoot = SourcePaths.Resolve(root, job.Source ?? "");
                if (job.ImageFolders && SourceTraversal.Enumerate(discoveryRoot, recursive: false).Any(x => x is FileInfo && ComicSources.IsImage(x.Name)))
                    await IndexAsync(job, root, job.Source ?? "", ct);
                foreach (var entry in SourceTraversal.Enumerate(discoveryRoot))
                {
                    ct.ThrowIfCancellationRequested();
                    if (entry is FileInfo ? !ComicSources.IsArchive(entry.Name) : !job.ImageFolders) continue;
                    if (entry is DirectoryInfo folder && !SourceTraversal.Enumerate(folder.FullName, recursive: false).Any(x => x is FileInfo && ComicSources.IsImage(x.Name))) continue;
                    await using (var stateDb = await database.OpenAsync(ct))
                        if (await stateDb.ExecuteScalarAsync<string>(new CommandDefinition("SELECT State FROM ComicJobs WHERE Id=@Id", job, cancellationToken: ct)) != "running") return;
                    try { await IndexAsync(job, root, Path.GetRelativePath(root.Path, entry.FullName).Replace(Path.DirectorySeparatorChar, '/'), ct); }
                    catch (Exception error) when (error is not OperationCanceledException || !ct.IsCancellationRequested)
                    {
                        logger.LogWarning(error, "Comic discovery failed for job {Job}", job.Id);
                        await using var failedDb = await database.OpenAsync(ct);
                        await failedDb.ExecuteAsync(new CommandDefinition("UPDATE ComicJobs SET Failed=Failed+1,FailureCode='comic_source_rejected' WHERE Id=@Id", job, cancellationToken: ct));
                    }
                }
            }
            await using var db = await database.OpenAsync(ct);
            await db.ExecuteAsync(new CommandDefinition("UPDATE ComicJobs SET State='completed' WHERE Id=@Id AND State='running'", job, cancellationToken: ct));
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception error)
        {
            logger.LogWarning(error, "Comic job {Job} failed", job.Id);
            await using var db = await database.OpenAsync(ct);
            await db.ExecuteAsync(new CommandDefinition("UPDATE ComicJobs SET State='failed',FailureCode='comic_source_unavailable' WHERE Id=@Id AND State='running'", job, cancellationToken: ct));
        }
    }
    private async Task IndexAsync(ComicJob job, LibraryOptions root, string relative, CancellationToken ct)
    {
        var source = SourcePaths.Resolve(root, relative);
        var directory = Directory.Exists(source);
        var sources = await ComicSources.InspectIsolatedAsync(source, directory, ct);
        var modified = File.GetLastWriteTimeUtc(source).Ticks;
        var size = directory ? 0 : new FileInfo(source).Length;
        await database.YieldToForegroundAsync(ct);
        await using var db = await database.OpenAsync(ct);
        using (var tx = db.BeginTransaction())
        {
            var id = await db.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO Comics(LibraryId,RelativePath,PathKey,Format,Title,PageCount,SourceSize,SourceModifiedTicks,AddedAt,LastJobId)
                VALUES(@LibraryId,@relative,@key,@format,@title,@count,@size,@modified,@now,@Id)
                ON CONFLICT(LibraryId,PathKey) DO UPDATE SET
                  PageCount=excluded.PageCount,SourceSize=excluded.SourceSize,SourceModifiedTicks=excluded.SourceModifiedTicks,
                  Revision=Comics.Revision+CASE WHEN Comics.SourceSize<>excluded.SourceSize OR Comics.SourceModifiedTicks<>excluded.SourceModifiedTicks THEN 1 ELSE 0 END,
                  Availability='present',LastJobId=excluded.LastJobId RETURNING Id;
                """, new { job.LibraryId, job.Id, relative, key = root.Key(relative), format = directory ? "folder" : Path.GetExtension(relative).ToLowerInvariant() is ".cbz" or ".zip" ? "zip" : "rar", title = Path.GetFileNameWithoutExtension(relative.Length == 0 ? root.Name : relative), count = sources.Count, size, modified, now = DateTimeOffset.UtcNow.ToString("O") }, tx, cancellationToken: ct));
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
}
