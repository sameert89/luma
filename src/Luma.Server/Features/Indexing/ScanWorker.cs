using System.Collections.Concurrent;
using System.Threading.Channels;
using Dapper;
using Luma.Server.Data;
using Microsoft.Data.Sqlite;

namespace Luma.Server.Features.Indexing;

public sealed class ScanWorker(Database database, IndexingOptions options, ILogger<ScanWorker> logger) : BackgroundService
{
    private readonly ConcurrentDictionary<long, CancellationTokenSource> active = new();
    private readonly Dictionary<long, Channel<long>> folderPriority = options.Libraries.ToDictionary(x => x.Id,
        _ => Channel.CreateBounded<long>(new BoundedChannelOptions(options.QueueCapacity)
        { SingleReader = true, FullMode = BoundedChannelFullMode.Wait }));

    public void PrioritizeFolder(long libraryId, long folderId)
    {
        if (folderPriority.TryGetValue(libraryId, out var queue)) queue.Writer.TryWrite(folderId);
    }
    public void Cancel(long id) { if (active.TryGetValue(id, out var source)) source.Cancel(); }

    protected override Task ExecuteAsync(CancellationToken stoppingToken) =>
        options.Libraries.Count == 0 ? Task.CompletedTask : Task.WhenAll(Enumerable.Range(0, options.DiscoveryWorkers).Select(_ => RunAsync(stoppingToken)));

    private async Task RunAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await using var db = await database.OpenAsync(ct);
                var scan = await db.QuerySingleOrDefaultAsync<ScanRow>(new CommandDefinition("""
                    UPDATE Scans SET State='running' WHERE Id=(SELECT s.Id FROM Scans s JOIN Libraries l ON l.Id=s.LibraryId
                    WHERE s.State='queued' AND l.Enabled=1 ORDER BY s.Id LIMIT 1) AND State='queued' RETURNING *
                    """, cancellationToken: ct));
                if (scan is null) { await Task.Delay(1000, ct); continue; }
                using var cancel = CancellationTokenSource.CreateLinkedTokenSource(ct);
                active[scan.Id] = cancel;
                try
                {
                    // Cover cancellation between the claim and registration.
                    if (await db.ExecuteScalarAsync<string>(new CommandDefinition("SELECT State FROM Scans WHERE Id=@Id", scan, cancellationToken: ct)) != "running") continue;
                    await ScanAsync(scan, options.Libraries.Single(x => x.Id == scan.LibraryId), cancel.Token);
                }
                catch (OperationCanceledException) when (cancel.IsCancellationRequested)
                {
                    await FinishFailedAsync(scan.Id, ct.IsCancellationRequested ? "interrupted" : "cancelled", "interrupted", CancellationToken.None);
                }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException)
                {
                    await FinishFailedAsync(scan.Id, "failed", "source_unavailable", ct);
                }
                catch (SqliteException error) when (error.SqliteErrorCode is 5 or 6)
                {
                    await Task.Delay(TimeSpan.FromSeconds(5), ct);
                    await FinishFailedAsync(scan.Id, "interrupted", "database_busy", ct);
                    await db.ExecuteAsync(new CommandDefinition("""
                        INSERT INTO Scans(LibraryId,FolderId,State,Force,RetryFailures,StartedAt)
                        SELECT @LibraryId,@FolderId,'queued',@Force,@RetryFailures,@now
                        WHERE NOT EXISTS(SELECT 1 FROM Scans WHERE LibraryId=@LibraryId AND State IN ('queued','running'))
                        """, new { scan.LibraryId, scan.FolderId, scan.Force, scan.RetryFailures, now = DateTimeOffset.UtcNow.ToString("O") }, cancellationToken: ct));
                }
                catch (Exception error)
                {
                    logger.LogError(error, "Scan {ScanId} failed", scan.Id);
                    await FinishFailedAsync(scan.Id, "failed", "indexing_failed", ct);
                }
                finally { active.TryRemove(scan.Id, out _); }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            catch (SqliteException error) when (error.SqliteErrorCode is 5 or 6)
            {
                await Task.Delay(TimeSpan.FromSeconds(5), ct);
            }
            catch (Exception error)
            {
                logger.LogError(error, "Index discovery failed; durable state will be recovered on restart");
                await Task.Delay(TimeSpan.FromSeconds(5), ct);
            }
        }
    }

    private async Task FinishFailedAsync(long id, string state, string code, CancellationToken ct)
    {
        await using var db = await database.OpenAsync(ct);
        await db.ExecuteAsync(new CommandDefinition("""
            UPDATE Scans SET State=@state,FailureCode=@code,FinishedAt=@now WHERE Id=@id AND State='running';
            UPDATE ProcessingJobs SET State='waiting' WHERE ScanId=@id AND State='pending';
            UPDATE Libraries SET Availability='unavailable' WHERE Id=(SELECT LibraryId FROM Scans WHERE Id=@id AND FolderId IS NULL) AND @state='failed';
            """, new { id, state, code, now = DateTimeOffset.UtcNow.ToString("O") }, cancellationToken: ct));
    }

    public async Task ScanAsync(ScanRow scan, LibraryOptions root, CancellationToken ct)
    {
        await using var lookup = await database.OpenAsync(ct);
        var relativeFolder = scan.FolderId is { } folderId
            ? await lookup.QuerySingleAsync<string>(new CommandDefinition("SELECT RelativePath FROM Folders WHERE Id=@folderId AND LibraryId=@LibraryId", new { folderId, scan.LibraryId }, cancellationToken: ct)) : "";
        // Hidden folders are excluded from indexing: their entry is still seen, but not descended into.
        var hidden = (await lookup.QueryAsync<string>(new CommandDefinition("SELECT PathKey FROM Folders WHERE LibraryId=@LibraryId AND Hidden=1",
            scan, cancellationToken: ct))).ToHashSet(StringComparer.Ordinal);
        var channel = Channel.CreateBounded<DiscoveredEntry>(new BoundedChannelOptions(options.QueueCapacity)
        { SingleWriter = true, SingleReader = true, FullMode = BoundedChannelFullMode.Wait });
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var producer = Task.Run(async () =>
        {
            try
            {
                SourcePaths.Check(root, root.Path);
                // Access errors are not ignored: any traversal error prohibits missing reconciliation.
                var directoryPath = relativeFolder.Length == 0 ? root.Path : SourcePaths.Resolve(root, relativeFolder);
                await channel.Writer.WriteAsync(new DiscoveredEntry(relativeFolder, true, 0, ""), linked.Token);
                foreach (var entry in SourceTraversal.Enumerate(directoryPath, recursive: scan.FolderId is null, skipDirectory: hidden.Count == 0 ? null
                    : path => hidden.Contains(root.Key(Path.GetRelativePath(root.Path, path).Replace(Path.DirectorySeparatorChar, '/')))))
                {
                    linked.Token.ThrowIfCancellationRequested();
                    var relative = Path.GetRelativePath(root.Path, entry.FullName).Replace(Path.DirectorySeparatorChar, '/');
                    var directory = entry.Attributes.HasFlag(FileAttributes.Directory);
                    await channel.Writer.WriteAsync(new DiscoveredEntry(relative, directory,
                        directory ? 0 : ((FileInfo)entry).Length, entry.LastWriteTimeUtc.ToString("O")), linked.Token);
                }
                channel.Writer.TryComplete();
            }
            catch (Exception error) { channel.Writer.TryComplete(error); throw; }
        }, linked.Token);
        try
        {
            await using var db = await database.OpenAsync(ct);
            while (await channel.Reader.WaitToReadAsync(ct))
            {
                if (scan.FolderId is null && folderPriority.TryGetValue(root.Id, out var priority)
                    && priority.Reader.TryRead(out var requestedFolder))
                    await DiscoverPriorityFolderAsync(db, scan, root, requestedFolder, ct);
                using (var batch = db.BeginTransaction())
                {
                    var folders = new Dictionary<string, long>();
                    var started = System.Diagnostics.Stopwatch.StartNew();
                    for (var count = 0; count < 32 && channel.Reader.TryRead(out var entry); count++)
                    {
                        await PersistEntryAsync(db, batch, folders, scan, root, entry, ct);
                        if (started.ElapsedMilliseconds >= 25) break;
                    }
                    batch.Commit();
                }
                // Give processing and interactive writes a chance between discovery batches.
                await Task.Delay(1, ct);
            }
            await producer;
            SourcePaths.Check(root, root.Path);
            using var tx = db.BeginTransaction();
            var owned = await db.ExecuteAsync(new CommandDefinition("""
                UPDATE Scans SET State='completed',FinishedAt=@now WHERE Id=@Id AND State='running'
                """, new { scan.Id, now = DateTimeOffset.UtcNow.ToString("O") }, tx, cancellationToken: ct));
            if (owned == 1)
                await db.ExecuteAsync(new CommandDefinition("""
                    UPDATE Media SET Availability='missing' WHERE LibraryId=@LibraryId AND LastSeenScanId<>@Id
                      AND (@FolderId IS NULL OR FolderId=@FolderId)
                      AND FolderId NOT IN (SELECT a.DescendantId FROM Folders h JOIN FolderAncestry a ON a.AncestorId=h.Id WHERE h.LibraryId=@LibraryId AND h.Hidden=1);
                    UPDATE ProcessingJobs SET State='waiting' WHERE State='pending' AND MediaId IN
                      (SELECT Id FROM Media WHERE LibraryId=@LibraryId AND Availability='missing');
                    UPDATE Libraries SET Availability='available' WHERE Id=@LibraryId;
                    UPDATE Folders SET DirectIndexedAt=strftime('%Y-%m-%dT%H:%M:%fZ','now')
                      WHERE LibraryId=@LibraryId AND ((@FolderId IS NULL AND LastSeenScanId=@Id) OR Id=@FolderId);
                    """, scan, tx, cancellationToken: ct));
            tx.Commit();
        }
        finally
        {
            await linked.CancelAsync();
            try { await producer; } catch (Exception) when (linked.IsCancellationRequested) { }
        }
    }

    private static async Task DiscoverPriorityFolderAsync(SqliteConnection db, ScanRow scan, LibraryOptions root, long folderId, CancellationToken ct)
    {
        var relative = await db.QuerySingleOrDefaultAsync<string>(new CommandDefinition(
            "SELECT RelativePath FROM Folders WHERE Id=@folderId AND LibraryId=@LibraryId AND DirectIndexedAt IS NULL",
            new { folderId, scan.LibraryId }, cancellationToken: ct));
        if (relative is null) return;
        try
        {
            var path = relative.Length == 0 ? root.Path : SourcePaths.Resolve(root, relative);
            using var entries = SourceTraversal.Enumerate(path, recursive: false).GetEnumerator();
            var more = true;
            while (more)
            {
                ct.ThrowIfCancellationRequested();
                var discovered = new List<DiscoveredEntry>(32);
                for (var count = 0; count < 32; count++)
                {
                    ct.ThrowIfCancellationRequested();
                    if (!entries.MoveNext()) { more = false; break; }
                    var entry = entries.Current;
                    var directory = entry.Attributes.HasFlag(FileAttributes.Directory);
                    discovered.Add(new DiscoveredEntry(
                        Path.GetRelativePath(root.Path, entry.FullName).Replace(Path.DirectorySeparatorChar, '/'), directory,
                        directory ? 0 : ((FileInfo)entry).Length, entry.LastWriteTimeUtc.ToString("O")));
                }
                using (var tx = db.BeginTransaction())
                {
                    var folders = new Dictionary<string, long>();
                    foreach (var entry in discovered)
                        await PersistEntryAsync(db, tx, folders, scan, root, entry, ct, priority: true);
                    tx.Commit();
                }
                await Task.Delay(1, ct);
            }
            SourcePaths.Check(root, path);
            await db.ExecuteAsync(new CommandDefinition("UPDATE Folders SET DirectIndexedAt=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE Id=@folderId",
                new { folderId }, cancellationToken: ct));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            // Advisory discovery does not reconcile missing media; the owning full traversal handles source failures.
        }
    }

    private static async Task PersistEntryAsync(SqliteConnection db, SqliteTransaction tx, Dictionary<string, long> folders, ScanRow scan, LibraryOptions root, DiscoveredEntry entry, CancellationToken ct, bool priority = false)
    {
        if (entry.Directory)
            await EnsureFolderAsync(db, tx, root, entry.RelativePath, scan.Id, ct, folders);
        else if (!MediaFormats.TryGet(entry.RelativePath, out var format))
            await db.ExecuteAsync(new CommandDefinition("UPDATE Scans SET Skipped=Skipped+1 WHERE Id=@Id", scan, tx, cancellationToken: ct));
        else
        {
            var folderPath = entry.RelativePath.Contains('/') ? entry.RelativePath[..entry.RelativePath.LastIndexOf('/')] : "";
            var folderId = await EnsureFolderAsync(db, tx, root, folderPath, scan.Id, ct, folders);
            var key = root.Key(entry.RelativePath);
            var now = DateTimeOffset.UtcNow.ToString("O");
            var mediaId = await db.ExecuteScalarAsync<long?>(new CommandDefinition("""
                INSERT INTO Media(LibraryId,FolderId,RelativePath,PathKey,FileName,MediaType,MimeType,Extension,SizeBytes,ModifiedAt,IndexedAt,EffectiveDate,LastSeenScanId)
                VALUES(@rootId,@folderId,@RelativePath,@key,@name,@type,@mime,@extension,@Size,@ModifiedAt,@now,@ModifiedAt,@scanId)
                ON CONFLICT(LibraryId,PathKey) DO UPDATE SET
                  SourceRevision=Media.SourceRevision + CASE WHEN (@force AND Media.LastSeenScanId<>@scanId) OR Media.SizeBytes<>excluded.SizeBytes OR Media.ModifiedAt<>excluded.ModifiedAt THEN 1 ELSE 0 END,
                  Width=CASE WHEN (@force AND Media.LastSeenScanId<>@scanId) OR Media.SizeBytes<>excluded.SizeBytes OR Media.ModifiedAt<>excluded.ModifiedAt THEN NULL ELSE Media.Width END,
                  Height=CASE WHEN (@force AND Media.LastSeenScanId<>@scanId) OR Media.SizeBytes<>excluded.SizeBytes OR Media.ModifiedAt<>excluded.ModifiedAt THEN NULL ELSE Media.Height END,
                  CapturedAt=CASE WHEN (@force AND Media.LastSeenScanId<>@scanId) OR Media.SizeBytes<>excluded.SizeBytes OR Media.ModifiedAt<>excluded.ModifiedAt THEN NULL ELSE Media.CapturedAt END,
                  DurationMs=CASE WHEN (@force AND Media.LastSeenScanId<>@scanId) OR Media.SizeBytes<>excluded.SizeBytes OR Media.ModifiedAt<>excluded.ModifiedAt THEN NULL ELSE Media.DurationMs END,
                  EffectiveDate=CASE WHEN (@force AND Media.LastSeenScanId<>@scanId) OR Media.SizeBytes<>excluded.SizeBytes OR Media.ModifiedAt<>excluded.ModifiedAt THEN excluded.ModifiedAt ELSE Media.EffectiveDate END,
                  ProcessingStatus=CASE WHEN (@force AND Media.LastSeenScanId<>@scanId) OR Media.SizeBytes<>excluded.SizeBytes OR Media.ModifiedAt<>excluded.ModifiedAt THEN 'pending' ELSE Media.ProcessingStatus END,
                  SizeBytes=excluded.SizeBytes,ModifiedAt=excluded.ModifiedAt,RelativePath=excluded.RelativePath,FileName=excluded.FileName,
                  FolderId=excluded.FolderId,Availability='present',LastSeenScanId=excluded.LastSeenScanId
                WHERE Media.LastSeenScanId<>@scanId OR Media.SizeBytes<>excluded.SizeBytes
                  OR Media.ModifiedAt<>excluded.ModifiedAt OR Media.Availability<>'present'
                RETURNING Id;
                """, new { rootId = root.Id, folderId, entry.RelativePath, key, name = Path.GetFileName(entry.RelativePath),
                    type = format.Type, mime = format.Mime, extension = Path.GetExtension(entry.RelativePath).ToLowerInvariant(),
                    entry.Size, entry.ModifiedAt, now, scanId = scan.Id, force = scan.Force }, tx, cancellationToken: ct));
            if (mediaId is null) return;
            await db.ExecuteAsync(new CommandDefinition("""
                UPDATE ProcessingJobs SET State='obsolete',Claim=NULL WHERE MediaId=@mediaId
                  AND (SourceRevision<>(SELECT SourceRevision FROM Media WHERE Id=@mediaId) OR EncoderVersion<>@version);
                INSERT INTO ProcessingJobs(MediaId,SourceRevision,EncoderVersion,ScanId,MediaType,NextAttemptAt)
                  SELECT Id,SourceRevision,@version,@scanId,MediaType,@next FROM Media WHERE Id=@mediaId
                ON CONFLICT(MediaId,SourceRevision,EncoderVersion) DO UPDATE SET
                  ScanId=excluded.ScanId,
                  State=CASE WHEN ProcessingJobs.State='waiting' OR (@retry AND ProcessingJobs.State='failed') THEN 'pending' ELSE ProcessingJobs.State END,
                  Attempts=CASE WHEN @retry THEN 0 ELSE ProcessingJobs.Attempts END,
                  NextAttemptAt=CASE WHEN @retry OR ProcessingJobs.State='waiting' THEN @next
                    WHEN @priority AND ProcessingJobs.State='pending' AND ProcessingJobs.NextAttemptAt>@next THEN @next
                    ELSE ProcessingJobs.NextAttemptAt END;
                UPDATE Scans SET Discovered=Discovered+1 WHERE Id=@scanId;
                """, new { mediaId, version = IndexingOptions.EncoderVersion, scanId = scan.Id,
                    next = priority ? DateTimeOffset.UtcNow.AddYears(-1).ToString("O") : now, priority, retry = scan.RetryFailures }, tx, cancellationToken: ct));
        }
    }

    private static async Task<long> EnsureFolderAsync(SqliteConnection db, SqliteTransaction tx, LibraryOptions root, string path, long scanId, CancellationToken ct, Dictionary<string, long> folders)
    {
        var key = root.Key(path);
        if (folders.TryGetValue(key, out var cached)) return cached;
        var existing = await db.QuerySingleOrDefaultAsync<long?>(new CommandDefinition(
            "SELECT Id FROM Folders WHERE LibraryId=@Id AND PathKey=@key", new { root.Id, key }, tx, cancellationToken: ct));
        if (existing is { } id)
        {
            await db.ExecuteAsync(new CommandDefinition("UPDATE Folders SET LastSeenScanId=@scanId,RelativePath=@path WHERE Id=@id", new { scanId, path, id }, tx, cancellationToken: ct));
            folders[key] = id;
            return id;
        }
        long? parentId = path == "" ? null : await EnsureFolderAsync(db, tx, root,
            path.Contains('/') ? path[..path.LastIndexOf('/')] : "", scanId, ct, folders);
        var newId = await db.ExecuteScalarAsync<long>(new CommandDefinition("""
            INSERT INTO Folders(LibraryId,ParentId,RelativePath,PathKey,LastSeenScanId) VALUES(@Id,@parentId,@path,@key,@scanId) RETURNING Id
            """, new { root.Id, parentId, path, key, scanId }, tx, cancellationToken: ct));
        await db.ExecuteAsync(new CommandDefinition("""
            INSERT INTO FolderAncestry VALUES(@newId,@newId);
            INSERT INTO FolderAncestry SELECT AncestorId,@newId FROM FolderAncestry WHERE DescendantId=@parentId;
            """, new { newId, parentId }, tx, cancellationToken: ct));
        folders[key] = newId;
        return newId;
    }
    private sealed record DiscoveredEntry(string RelativePath, bool Directory, long Size, string ModifiedAt);
}

public static class SourcePaths
{
    public static string Resolve(LibraryOptions root, string relativePath)
    {
        var path = Path.GetFullPath(Path.Combine(root.Path, relativePath));
        Check(root, path);
        return path;
    }
    public static void Check(LibraryOptions root, string path)
    {
        var relative = Path.GetRelativePath(root.Path, path);
        if (Path.IsPathRooted(relative) || relative == ".." || relative.StartsWith(".." + Path.DirectorySeparatorChar))
            throw new IOException("Source outside root.");
        var current = root.Path;
        for (var directory = new DirectoryInfo(current); directory is not null; directory = directory.Parent)
            if ((File.GetAttributes(directory.FullName) & FileAttributes.ReparsePoint) != 0) throw new IOException("Source link.");
        foreach (var segment in relative.Split(Path.DirectorySeparatorChar))
        {
            if (segment == ".") continue;
            current = Path.Combine(current, segment);
            if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new IOException("Source link.");
        }
    }
}

public sealed record MediaFormat(string Type, string Mime);
public static class MediaFormats
{
    public static bool TryGet(string path, out MediaFormat format)
    {
        format = Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".jpg" or ".jpeg" => new("image", "image/jpeg"), ".png" => new("image", "image/png"),
            ".webp" => new("image", "image/webp"), ".gif" => new("image", "image/gif"),
            ".bmp" => new("image", "image/bmp"), ".tif" or ".tiff" => new("image", "image/tiff"),
            ".mp4" or ".m4v" => new("video", "video/mp4"), ".mov" => new("video", "video/quicktime"),
            ".mkv" => new("video", "video/x-matroska"), ".webm" => new("video", "video/webm"),
            ".avi" => new("video", "video/x-msvideo"), _ => null!
        };
        return format is not null;
    }
}
