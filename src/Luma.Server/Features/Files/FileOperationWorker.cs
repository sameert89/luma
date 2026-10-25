using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Indexing;
using Luma.Server.Http;
using Microsoft.Data.Sqlite;

namespace Luma.Server.Features.Files;

public sealed class FileOperationWorker(FileOperations operations, Database database,
    ILogger<FileOperationWorker> logger) : BackgroundService
{
    private string? cleanupAfter;
    private bool cleanupFinished;
    private string? recycleCleanupAfter;
    private bool recycleCleanupFinished;

    // Tests can stop execution at durable boundaries without guessing timing.
    internal Action<string>? Checkpoint { get; set; }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await RecoverAsync(stoppingToken);
        // Read-only installations have no mutation work to claim. Recovery still records
        // unresolved old operations, but ordinary browsing needs no extra writer polling.
        if (!operations.HasWritableLibraries) return;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var row = await ClaimAsync(stoppingToken);
                if (row is null) { await CleanupOldUploadsAsync(stoppingToken); await CleanupOldRecycleAsync(stoppingToken); await Task.Delay(500, stoppingToken); continue; }
                await ExecuteOperationAsync(row, recovering: false, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception error)
            {
                logger.LogError(error, "File operation worker could not progress");
                await Task.Delay(1000, stoppingToken);
            }
        }
    }

    // Admission journals visible-file changes during discovery; execution still waits
    // for its readers to finish. Queued scans yield to queued file operations.
    internal async Task<FileOperation?> ClaimAsync(CancellationToken ct)
    {
        await using var db = await operations.OpenJournalAsync(ct);
        return await db.QuerySingleOrDefaultAsync<FileOperation>(new CommandDefinition("""
            UPDATE FileOperations SET State='running' WHERE Id=(
              SELECT o.Id FROM FileOperations o WHERE o.State='queued'
              AND NOT EXISTS(SELECT 1 FROM Scans WHERE LibraryId=o.LibraryId AND State='running')
              AND NOT EXISTS(SELECT 1 FROM ComicJobs WHERE LibraryId=o.LibraryId AND State='running')
              AND NOT EXISTS(SELECT 1 FROM FileOperations WHERE LibraryId=o.LibraryId AND State='needsAttention')
              AND NOT EXISTS(SELECT 1 FROM FileOperations parent WHERE parent.ReplacementId=o.Id)
              ORDER BY o.CreatedAt LIMIT 1) AND State='queued' RETURNING *
            """, cancellationToken: ct));
    }

    // Retire historical empty upload directories in small batches while the queue is idle.
    // Never enumerate staging or remove paused/unfinished content.
    internal async Task CleanupOldUploadsAsync(CancellationToken ct)
    {
        if (cleanupFinished) return;
        await using var db = await database.OpenAsync(ct);
        var rows = (await db.QueryAsync<Luma.Server.Features.Uploads.UploadSession>(new CommandDefinition("""
            SELECT * FROM UploadSessions INDEXED BY IX_UploadSessions_Cleanup WHERE Id>@after
              AND State IN ('completed','cancelled') ORDER BY Id LIMIT 16
            """, new { after = cleanupAfter ?? "" }, cancellationToken: ct))).ToArray();
        foreach (var row in rows)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                var root = operations.WritableRoot(row.LibraryId);
                MutationPaths.RemoveEmptyStaging(root, MutationPaths.UploadDirectory, row.Id);
            }
            catch (ApiRequestException) { /* An unavailable mount must not block other libraries. */ }
        }
        if (rows.Length > 0) cleanupAfter = rows[^1].Id;
        cleanupFinished = rows.Length < 16;
    }

    // A crash after metadata commit can skip immediate cleanup. Revisit only
    // completed restore/purge journals; unknown and live recycle entries stay intact.
    internal async Task CleanupOldRecycleAsync(CancellationToken ct)
    {
        if (recycleCleanupFinished) return;
        await using var db = await database.OpenAsync(ct);
        var rows = (await db.QueryAsync<FileOperation>(new CommandDefinition("""
            SELECT * FROM FileOperations INDEXED BY IX_FileOperations_RecycleCleanup WHERE Id>@after
              AND State='completed' AND Kind IN ('restore','purge') ORDER BY Id LIMIT 16
            """, new { after = recycleCleanupAfter ?? "" }, cancellationToken: ct))).ToArray();
        foreach (var row in rows)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                var root = operations.WritableRoot(row.LibraryId);
                MutationPaths.RemoveEmptyStaging(root, MutationPaths.TrashDirectory, row.RecycleId!);
            }
            catch (ApiRequestException) { /* An unavailable mount must not block other libraries. */ }
        }
        if (rows.Length > 0) recycleCleanupAfter = rows[^1].Id;
        recycleCleanupFinished = rows.Length < 16;
    }

    internal async Task RecoverAsync(CancellationToken ct)
    {
        await using var db = await database.OpenAsync(ct);
        // Small pages avoid retaining every historical operation while recovering.
        string? after = null;
        while (true)
        {
            var rows = (await db.QueryAsync<FileOperation>(new CommandDefinition("""
                SELECT * FROM FileOperations WHERE State IN ('running','reserved','published','deleting','finalizing')
                AND (@after IS NULL OR Id>@after) ORDER BY Id LIMIT 32
                """, new { after }, cancellationToken: ct))).ToArray();
            if (rows.Length == 0) break;
            foreach (var row in rows) await ExecuteOperationAsync(row, recovering: true, ct);
            after = rows[^1].Id;
        }
    }

    internal async Task ExecuteOperationAsync(FileOperation row, bool recovering, CancellationToken ct)
    {
        try
        {
            if (row.RecoveryRequested)
            {
                row.State = row.RecoveryState ?? "running";
                recovering = true;
                await StateAsync(row, row.State, ct);
            }
            var root = operations.WritableRoot(row.LibraryId, requireAvailable: false);
            if (row.ReplacementId is not null)
            {
                var replacement = await operations.GetAsync(row.ReplacementId, ct);
                var replacementRecovering = replacement.State != "queued";
                if (replacement.State == "queued") await StateAsync(replacement, "running", ct);
                if (replacement.State != "completed")
                    await ExecuteOperationAsync(replacement, replacementRecovering, ct);
                if ((await operations.GetAsync(replacement.Id, ct)).State != "completed") throw Attention("replacement_incomplete");
                // Preserve the recycled item's identity and tags while releasing its public
                // path key. Its immutable snapshot still supports restoration elsewhere.
                await using var journal = await operations.OpenJournalAsync(ct);
                using var transaction = journal.BeginTransaction();
                var prefix = root.Key($".luma-trash/{replacement.Id}/");
                await journal.ExecuteAsync(new CommandDefinition("""
                    UPDATE Media SET PathKey=@prefix||PathKey WHERE Id IN (SELECT MediaId FROM OperationMedia WHERE OperationId=@Id)
                      AND substr(PathKey,1,length(@prefix))<>@prefix;
                    UPDATE Comics SET PathKey=@prefix||PathKey WHERE Id IN (SELECT ComicId FROM OperationComics WHERE OperationId=@Id)
                      AND substr(PathKey,1,length(@prefix))<>@prefix;
                    UPDATE Folders SET PathKey=@prefix||PathKey WHERE Id IN (SELECT FolderId FROM OperationFolders WHERE OperationId=@Id)
                      AND substr(PathKey,1,length(@prefix))<>@prefix;
                    """, new { replacement.Id, prefix }, transaction, cancellationToken: ct));
                transaction.Commit();
            }
            // Losing access is not deletion, and cannot trigger cleanup.
            _ = MutationPaths.Resolve(root, "", allowRoot: true);
            var category = row.Kind == "upload" ? MutationPaths.UploadDirectory : row.Kind is "recycle" or "restore" or "purge" ? MutationPaths.TrashDirectory : MutationPaths.OperationsDirectory;
            var staging = MutationPaths.Internal(root, category, row.UploadId ?? (row.Kind is "restore" or "purge" ? row.RecycleId : null) ?? row.Id);
            var source = row.Kind is "upload" or "restore" or "purge" ? staging : MutationPaths.Resolve(root, row.Source);
            var destination = row.Kind == "mkdir" ? row.Source : row.Destination;
            if (row.State == "running")
            {
                // A crash after reservation but before the state write has an owned staging path.
                // A public source alone cannot distinguish the original from its replacement.
                if (recovering && row.Kind is not ("copy" or "upload" or "restore" or "purge") && !Exists(staging))
                    throw Attention("interrupted_before_reservation");
                if (!Exists(staging))
                {
                    ct.ThrowIfCancellationRequested();
                    Directory.CreateDirectory(Path.GetDirectoryName(staging)!);
                    MutationPaths.Internal(root, category, row.Id);
                    if (row.Kind == "copy")
                    {
                        Verify(source, row);
                        var payload = MutationPaths.Internal(root, MutationPaths.OperationsDirectory, row.Id, "payload");
                        if (Directory.Exists(payload)) await DeleteOwnedDirectoryAsync(payload, ct);
                        else if (File.Exists(payload)) File.Delete(payload);
                        await CopyToStagingAsync(root, row, source, payload, ct);
                        Verify(source, row);
                        if (row.IsDirectory) Directory.Move(payload, staging);
                        else File.Move(payload, staging, overwrite: false);
                    }
                    else if (row.Kind == "mkdir") Directory.CreateDirectory(staging);
                    else
                    {
                        Verify(source, row);
                        if (row.IsDirectory) Directory.Move(source, staging);
                        else File.Move(source, staging, overwrite: false);
                    }
                }
                else if (!recovering && row.Kind is not ("upload" or "restore" or "purge")) throw Attention("staging_conflict");
                Checkpoint?.Invoke("reserved-filesystem");
                await StateAsync(row, "reserved", ct);
                Checkpoint?.Invoke("reserved-journal");
            }
            if (row.State == "reserved")
            {
                if (row.Kind is "delete" or "purge")
                {
                    // After this durable marker a restart may safely continue deleting only staging.
                    await StateAsync(row, "deleting", ct);
                }
                else if (row.Kind == "recycle")
                {
                    if (!Exists(staging)) throw Attention("staging_unavailable");
                    await StateAsync(row, "published", ct);
                }
                else
                {
                    if (!Exists(staging)) throw Attention("publication_uncertain");
                    FileOperations.EnsureDestination(root, destination!);
                    var target = MutationPaths.Resolve(root, destination!);
                    if (row.IsDirectory) Directory.Move(staging, target);
                    else File.Move(staging, target, overwrite: false);
                    Checkpoint?.Invoke("published-filesystem");
                    await StateAsync(row, "published", ct);
                }
            }
            if (row.State == "deleting")
            {
                if (Exists(staging))
                {
                    // Directory.Delete removes links themselves; never traverse a link explicitly.
                    if (row.IsDirectory) await DeleteOwnedDirectoryAsync(staging, ct);
                    else File.Delete(staging);
                }
                Checkpoint?.Invoke("deleted-filesystem");
                await StateAsync(row, "published", ct);
            }
            if (row.State is "published" or "finalizing")
            {
                if (row.Kind == "recycle" && !Exists(staging)) throw Attention("staging_unavailable");
                if (row.Kind is "upload" or "copy" or "move" or "restore" or "mkdir")
                {
                    var target = MutationPaths.Resolve(root, destination!);
                    if (!Exists(target)) throw Attention("destination_unavailable");
                    if (row.Kind != "mkdir") Verify(target, row);
                }
                await StateAsync(row, "finalizing", ct);
                Checkpoint?.Invoke("before-metadata");
                await ReconcileAsync(row, root, ct);
                CleanupStaging(root, row);
                Checkpoint?.Invoke("completed");
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ApiRequestException or SqliteException)
        {
            logger.LogWarning(error, "File operation {Operation} requires attention", row.Id);
            await using var db = await operations.OpenJournalAsync(CancellationToken.None);
            var code = error is ApiRequestException problem ? problem.Code : "filesystem_or_database_unavailable";
            await db.ExecuteAsync(new CommandDefinition("UPDATE FileOperations SET State='needsAttention',RecoveryState=@State,RecoveryRequested=0,FailureCode=@code WHERE Id=@Id", new { row.Id, row.State, code }));
        }
    }

    private async Task StateAsync(FileOperation row, string state, CancellationToken ct)
    {
        await using var db = await operations.OpenJournalAsync(ct);
        await db.ExecuteAsync(new CommandDefinition("UPDATE FileOperations SET State=@state,RecoveryRequested=0 WHERE Id=@Id", new { row.Id, state }, cancellationToken: ct));
        row.State = state;
        row.RecoveryRequested = false;
    }

    private async Task ReconcileAsync(FileOperation row, LibraryOptions root, CancellationToken ct)
    {
        // Index only the newly published path, never its siblings. Replaying this is idempotent.
        if (row.Kind is "copy" or "upload")
            await ScanWorker.IndexPublishedPathAsync(database, root, row.Destination!, ct, importMetadata: row.Kind == "upload");
        await using var db = await operations.OpenJournalAsync(ct);
        using var tx = db.BeginTransaction();
        if (await db.ExecuteScalarAsync<string>(new CommandDefinition("SELECT State FROM FileOperations WHERE Id=@Id", row, tx, cancellationToken: ct)) == "completed") return;
        var snapshot = row.Kind is "restore" or "purge" ? row.RecycleId ?? row.Id : row.Id;
        if (row.Kind is "recycle" or "delete" or "purge")
        {
            await db.ExecuteAsync(new CommandDefinition("""
                UPDATE Comics SET Availability='missing' WHERE Id IN (SELECT ComicId FROM OperationComics WHERE OperationId=@snapshot);
                UPDATE Media SET Availability='missing' WHERE Id IN (SELECT MediaId FROM OperationMedia WHERE OperationId=@snapshot);
                UPDATE Folders SET Recycled=1 WHERE Id IN (SELECT FolderId FROM OperationFolders WHERE OperationId=@snapshot);
                UPDATE ProcessingJobs SET State='waiting',Claim=NULL,LeaseUntil=NULL WHERE MediaId IN
                  (SELECT MediaId FROM OperationMedia WHERE OperationId=@snapshot) AND State IN ('pending','running');
                """, new { snapshot }, tx, cancellationToken: ct));
        }
        else if (row.Kind is "move" or "restore")
        {
            var target = row.Destination!;
            var parentPath = target.Contains('/') ? target[..target.LastIndexOf('/')] : "";
            var parentId = await EnsureFolderAsync(db, tx, root, parentPath, ct);
            // Snapshot paths remain immutable so reconciliation is idempotent.
            await db.ExecuteAsync(new CommandDefinition("""
                UPDATE Comics SET RelativePath=@target||substr((SELECT OriginalPath FROM OperationComics WHERE OperationId=@snapshot AND ComicId=Comics.Id),length(@Source)+1),
                  PathKey=CASE WHEN substr(PathKey,1,length(@recycledPrefix))=@recycledPrefix
                    THEN @targetKey||substr(PathKey,length(@recycledPrefix)+length(@sourceKey)+1)
                    WHEN RelativePath=@target||substr((SELECT OriginalPath FROM OperationComics WHERE OperationId=@snapshot AND ComicId=Comics.Id),length(@Source)+1)
                    THEN PathKey ELSE @targetKey||substr(PathKey,length(@sourceKey)+1) END,
                  Availability=(SELECT OriginalAvailability FROM OperationComics WHERE OperationId=@snapshot AND ComicId=Comics.Id)
                WHERE Id IN (SELECT ComicId FROM OperationComics WHERE OperationId=@snapshot);
                UPDATE Media SET RelativePath=@target||substr((SELECT OriginalPath FROM OperationMedia WHERE OperationId=@snapshot AND MediaId=Media.Id),length(@Source)+1),
                  PathKey=CASE WHEN substr(PathKey,1,length(@recycledPrefix))=@recycledPrefix
                    THEN @targetKey||substr(PathKey,length(@recycledPrefix)+length(@sourceKey)+1)
                    WHEN RelativePath=@target||substr((SELECT OriginalPath FROM OperationMedia WHERE OperationId=@snapshot AND MediaId=Media.Id),length(@Source)+1)
                    THEN PathKey ELSE @targetKey||substr(PathKey,length(@sourceKey)+1) END,
                  Availability=(SELECT OriginalAvailability FROM OperationMedia WHERE OperationId=@snapshot AND MediaId=Media.Id)
                WHERE Id IN (SELECT MediaId FROM OperationMedia WHERE OperationId=@snapshot);
                UPDATE Folders SET RelativePath=@target||substr((SELECT OriginalPath FROM OperationFolders WHERE OperationId=@snapshot AND FolderId=Folders.Id),length(@Source)+1),
                  PathKey=CASE WHEN substr(PathKey,1,length(@recycledPrefix))=@recycledPrefix
                    THEN @targetKey||substr(PathKey,length(@recycledPrefix)+length(@sourceKey)+1)
                    WHEN RelativePath=@target||substr((SELECT OriginalPath FROM OperationFolders WHERE OperationId=@snapshot AND FolderId=Folders.Id),length(@Source)+1)
                    THEN PathKey ELSE @targetKey||substr(PathKey,length(@sourceKey)+1) END,Recycled=0
                WHERE Id IN (SELECT FolderId FROM OperationFolders WHERE OperationId=@snapshot);
                UPDATE Folders SET ParentId=@parentId WHERE LibraryId=@LibraryId AND PathKey=@targetKey;
                DELETE FROM FolderAncestry WHERE DescendantId IN (SELECT FolderId FROM OperationFolders WHERE OperationId=@snapshot)
                  AND AncestorId NOT IN (SELECT FolderId FROM OperationFolders WHERE OperationId=@snapshot);
                INSERT OR IGNORE INTO FolderAncestry SELECT p.AncestorId,f.FolderId FROM FolderAncestry p,OperationFolders f
                  WHERE p.DescendantId=@parentId AND f.OperationId=@snapshot;
                """, new { row.LibraryId, row.Source, target, targetKey = root.Key(target), sourceKey = root.Key(row.Source), snapshot, parentId, recycledPrefix = root.Key($".luma-trash/{snapshot}/") }, tx, cancellationToken: ct));
            if (!row.IsDirectory)
                await db.ExecuteAsync(new CommandDefinition("UPDATE Media SET FileName=@name,FolderId=@parentId WHERE Id IN (SELECT MediaId FROM OperationMedia WHERE OperationId=@snapshot)", new { name = Path.GetFileName(target), parentId, snapshot }, tx, cancellationToken: ct));
        }
        else if (row.Kind == "copy")
        {
            await db.ExecuteAsync(new CommandDefinition("""
                INSERT OR IGNORE INTO MediaTags(MediaId,TagId)
                  SELECT destination.Id,t.TagId FROM OperationMedia snapshot
                  JOIN Media source ON source.Id=snapshot.MediaId
                  JOIN MediaTags t ON t.MediaId=snapshot.MediaId
                  JOIN Media destination ON destination.LibraryId=@LibraryId
                    AND destination.PathKey=@targetKey||substr(source.PathKey,length(@sourceKey)+1)
                  WHERE snapshot.OperationId=@Id;
                """, new { row.Id, row.LibraryId, sourceKey = root.Key(row.Source), targetKey = root.Key(row.Destination!) }, tx, cancellationToken: ct));
        }
        else if (row.Kind == "mkdir")
        {
            var folderId = await EnsureFolderAsync(db, tx, root, row.Source, ct);
            await db.ExecuteAsync(new CommandDefinition("UPDATE Folders SET DirectIndexedAt=@now,SourceModifiedTicks=@ticks WHERE Id=@folderId",
                new { folderId, now = DateTimeOffset.UtcNow.ToString("O"), ticks = Directory.GetLastWriteTimeUtc(MutationPaths.Resolve(root, row.Source)).Ticks }, tx, cancellationToken: ct));
        }
        else if (row.Kind == "upload")
        {
            await db.ExecuteAsync(new CommandDefinition("UPDATE UploadSessions SET State='completed',UpdatedAt=@now WHERE Id=@UploadId",
                new { row.UploadId, now = DateTimeOffset.UtcNow.ToString("O") }, tx, cancellationToken: ct));
        }
        if (row.Kind is "restore" or "purge")
            await db.ExecuteAsync(new CommandDefinition("UPDATE FileOperations SET Restored=1 WHERE Id=@RecycleId", row, tx, cancellationToken: ct));
        await db.ExecuteAsync(new CommandDefinition("UPDATE FileOperations SET State='completed',FinishedAt=@now,FailureCode=NULL WHERE Id=@Id", new { row.Id, now = DateTimeOffset.UtcNow.ToString("O") }, tx, cancellationToken: ct));
        foreach (var path in new[] { row.Source, row.Destination }.OfType<string>())
        {
            var parent = path.Contains('/') ? path[..path.LastIndexOf('/')] : "";
            var directory = MutationPaths.Resolve(root, parent, allowRoot: true);
            if (Directory.Exists(directory))
                await db.ExecuteAsync(new CommandDefinition("UPDATE Folders SET SourceModifiedTicks=@ticks WHERE LibraryId=@Id AND PathKey=@key",
                    new { root.Id, key = root.Key(parent), ticks = Directory.GetLastWriteTimeUtc(directory).Ticks }, tx, cancellationToken: ct));
        }
        tx.Commit();
        row.State = "completed";
    }

    private static void CleanupStaging(LibraryOptions root, FileOperation row)
    {
        if (row.Kind == "recycle") return; // The recycle bin owns this content until restored or purged.
        var category = row.Kind == "upload" ? MutationPaths.UploadDirectory
            : row.Kind is "restore" or "purge" ? MutationPaths.TrashDirectory : MutationPaths.OperationsDirectory;
        MutationPaths.RemoveEmptyStaging(root, category, row.UploadId ?? row.RecycleId ?? row.Id);
    }

    internal static async Task<long> EnsureFolderAsync(SqliteConnection db, SqliteTransaction tx, LibraryOptions root, string path, CancellationToken ct)
    {
        var key = root.Key(path);
        var existing = await db.QuerySingleOrDefaultAsync<long?>(new CommandDefinition("SELECT Id FROM Folders WHERE LibraryId=@Id AND PathKey=@key", new { root.Id, key }, tx, cancellationToken: ct));
        if (existing.HasValue) return existing.Value;
        long? parent = path.Length == 0 ? null : await EnsureFolderAsync(db, tx, root, path.Contains('/') ? path[..path.LastIndexOf('/')] : "", ct);
        var id = await db.ExecuteScalarAsync<long>(new CommandDefinition("INSERT INTO Folders(LibraryId,ParentId,RelativePath,PathKey) VALUES(@Id,@parent,@path,@key) RETURNING Id", new { root.Id, parent, path, key }, tx, cancellationToken: ct));
        await db.ExecuteAsync(new CommandDefinition("INSERT INTO FolderAncestry VALUES(@id,@id); INSERT INTO FolderAncestry SELECT AncestorId,@id FROM FolderAncestry WHERE DescendantId=@parent", new { id, parent }, tx, cancellationToken: ct));
        return id;
    }


    private static async Task CopyToStagingAsync(LibraryOptions root, FileOperation row, string source, string staging, CancellationToken ct)
    {
        async Task CopyFileAsync(string from, string to)
        {
            if (File.GetAttributes(from).HasFlag(FileAttributes.ReparsePoint)) throw Attention("unsafe_path");
            var length = new FileInfo(from).Length;
            var modified = File.GetLastWriteTimeUtc(from);
            await using (var input = new FileStream(from, FileMode.Open, FileAccess.Read, FileShare.Read, 128 * 1024, useAsync: true))
            await using (var output = new FileStream(to, FileMode.CreateNew, FileAccess.Write, FileShare.None, 128 * 1024, useAsync: true))
            {
                await input.CopyToAsync(output, ct);
                await output.FlushAsync(ct);
                output.Flush(flushToDisk: true);
            }
            if (new FileInfo(from).Length != length || File.GetLastWriteTimeUtc(from) != modified) throw Attention("source_changed");
            File.SetLastWriteTimeUtc(to, modified);
        }
        if (!row.IsDirectory) { await CopyFileAsync(source, staging); return; }
        Directory.CreateDirectory(staging);
        foreach (var entry in SourceTraversal.Enumerate(source, recursive: true, skipLinks: false))
        {
            ct.ThrowIfCancellationRequested();
            var relative = Path.GetRelativePath(source, entry.FullName);
            _ = MutationPaths.Resolve(root, row.Source + '/' + relative.Replace(Path.DirectorySeparatorChar, '/'));
            var target = Path.Combine(staging, relative);
            if (entry.Attributes.HasFlag(FileAttributes.Directory)) Directory.CreateDirectory(target);
            else await CopyFileAsync(entry.FullName, target);
        }
        Directory.SetLastWriteTimeUtc(staging, new DateTime(row.SourceModifiedTicks, DateTimeKind.Utc));
    }

    private static async Task DeleteOwnedDirectoryAsync(string path, CancellationToken ct)
    {
        var stack = new Stack<(string Path, IEnumerator<FileSystemInfo> Entries)>();
        stack.Push((path, new DirectoryInfo(path).EnumerateFileSystemInfos().GetEnumerator()));
        var processed = 0;
        try
        {
            while (stack.TryPeek(out var level))
            {
                ct.ThrowIfCancellationRequested();
                if (!level.Entries.MoveNext())
                {
                    stack.Pop().Entries.Dispose();
                    Directory.Delete(level.Path);
                    continue;
                }
                var entry = level.Entries.Current;
                var directory = entry.Attributes.HasFlag(FileAttributes.Directory);
                if (directory && !entry.Attributes.HasFlag(FileAttributes.ReparsePoint))
                {
                    if (stack.Count >= 128) throw new IOException("Directory depth exceeded.");
                    stack.Push((entry.FullName, new DirectoryInfo(entry.FullName).EnumerateFileSystemInfos().GetEnumerator()));
                }
                else if (directory) Directory.Delete(entry.FullName);
                else File.Delete(entry.FullName);
                if (++processed % 32 == 0) await Task.Yield();
            }
        }
        finally { foreach (var level in stack) level.Entries.Dispose(); }
    }

    private static bool Exists(string path) => File.Exists(path) || Directory.Exists(path);
    private static void Verify(string path, FileOperation row)
    {
        var attributes = File.GetAttributes(path);
        if (attributes.HasFlag(FileAttributes.ReparsePoint) || attributes.HasFlag(FileAttributes.Directory) != row.IsDirectory ||
            (!row.IsDirectory && new FileInfo(path).Length != row.SourceSize) || File.GetLastWriteTimeUtc(path).Ticks != row.SourceModifiedTicks)
            throw Attention("source_changed");
    }
    private static ApiRequestException Attention(string code) => new(409, code, "Operation evidence is ambiguous. Inspect its source, destination and staging before taking further action.");
}
