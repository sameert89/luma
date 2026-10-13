using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Indexing;
using Luma.Server.Http;
using Microsoft.Data.Sqlite;

namespace Luma.Server.Features.Files;

public sealed class FileOperationWorker(FileOperations operations, Database database,
    ILogger<FileOperationWorker> logger) : BackgroundService
{
    // Tests can stop execution at durable boundaries without guessing timing.
    internal Action<string>? Checkpoint { get; set; }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await RecoverAsync(stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var db = await operations.OpenJournalAsync(stoppingToken);
                var row = await db.QuerySingleOrDefaultAsync<FileOperation>(new CommandDefinition("""
                    UPDATE FileOperations SET State='running' WHERE Id=(
                      SELECT o.Id FROM FileOperations o WHERE o.State='queued'
                      AND NOT EXISTS(SELECT 1 FROM Scans WHERE LibraryId=o.LibraryId AND State='running')
                      ORDER BY o.CreatedAt LIMIT 1) AND State='queued' RETURNING *
                    """, cancellationToken: stoppingToken));
                if (row is null) { await Task.Delay(500, stoppingToken); continue; }
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
            var root = operations.WritableRoot(row.LibraryId);
            // Losing access is not deletion, and cannot trigger cleanup.
            _ = MutationPaths.Resolve(root, "", allowRoot: true);
            var category = row.Kind == "upload" ? MutationPaths.UploadDirectory : row.Kind is "recycle" or "restore" or "purge" ? MutationPaths.TrashDirectory : MutationPaths.OperationsDirectory;
            var staging = MutationPaths.Internal(root, category, row.UploadId ?? row.RecycleId ?? row.Id);
            var source = row.Kind is "upload" or "restore" or "purge" ? staging : MutationPaths.Resolve(root, row.Source);
            var destination = row.Kind == "mkdir" ? row.Source : row.Destination;
            if (row.State == "running")
            {
                // A crash after reservation but before the state write has an owned staging path.
                // A public source alone cannot distinguish the original from its replacement.
                if (recovering && row.Kind is not ("upload" or "restore" or "purge") && !Exists(staging))
                    throw Attention("interrupted_before_reservation");
                if (!Exists(staging))
                {
                    ct.ThrowIfCancellationRequested();
                    Directory.CreateDirectory(Path.GetDirectoryName(staging)!);
                    MutationPaths.Internal(root, category, row.Id);
                    if (row.Kind == "mkdir") Directory.CreateDirectory(staging);
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
                if (row.Kind is "upload" or "move" or "restore" or "mkdir")
                {
                    var target = MutationPaths.Resolve(root, destination!);
                    if (!Exists(target)) throw Attention("destination_unavailable");
                    if (row.Kind != "mkdir") Verify(target, row);
                }
                await StateAsync(row, "finalizing", ct);
                Checkpoint?.Invoke("before-metadata");
                await ReconcileAsync(row, root, ct);
                Checkpoint?.Invoke("completed");
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ApiRequestException or SqliteException)
        {
            logger.LogWarning(error, "File operation {Operation} requires attention", row.Id);
            await using var db = await operations.OpenJournalAsync(CancellationToken.None);
            var code = error is ApiRequestException problem ? problem.Code : "filesystem_or_database_unavailable";
            await db.ExecuteAsync(new CommandDefinition("UPDATE FileOperations SET State='needsAttention',FailureCode=@code WHERE Id=@Id", new { row.Id, code }));
        }
    }

    private async Task StateAsync(FileOperation row, string state, CancellationToken ct)
    {
        await using var db = await operations.OpenJournalAsync(ct);
        await db.ExecuteAsync(new CommandDefinition("UPDATE FileOperations SET State=@state WHERE Id=@Id", new { row.Id, state }, cancellationToken: ct));
        row.State = state;
    }

    private async Task ReconcileAsync(FileOperation row, LibraryOptions root, CancellationToken ct)
    {
        await using var db = await operations.OpenJournalAsync(ct);
        using var tx = db.BeginTransaction();
        if (await db.ExecuteScalarAsync<string>(new CommandDefinition("SELECT State FROM FileOperations WHERE Id=@Id", row, tx, cancellationToken: ct)) == "completed") return;
        var snapshot = row.RecycleId ?? row.Id;
        if (row.Kind is "recycle" or "delete" or "purge")
        {
            await db.ExecuteAsync(new CommandDefinition("""
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
                UPDATE Media SET RelativePath=@target||substr((SELECT OriginalPath FROM OperationMedia WHERE OperationId=@snapshot AND MediaId=Media.Id),length(@Source)+1),
                  PathKey=@targetKey||substr(PathKey,length(@sourceKey)+1),
                  Availability=(SELECT OriginalAvailability FROM OperationMedia WHERE OperationId=@snapshot AND MediaId=Media.Id)
                WHERE Id IN (SELECT MediaId FROM OperationMedia WHERE OperationId=@snapshot);
                UPDATE Folders SET RelativePath=@target||substr((SELECT OriginalPath FROM OperationFolders WHERE OperationId=@snapshot AND FolderId=Folders.Id),length(@Source)+1),
                  PathKey=@targetKey||substr(PathKey,length(@sourceKey)+1),Recycled=0
                WHERE Id IN (SELECT FolderId FROM OperationFolders WHERE OperationId=@snapshot);
                UPDATE Folders SET ParentId=@parentId WHERE LibraryId=@LibraryId AND PathKey=@targetKey;
                DELETE FROM FolderAncestry WHERE DescendantId IN (SELECT FolderId FROM OperationFolders WHERE OperationId=@snapshot)
                  AND AncestorId NOT IN (SELECT FolderId FROM OperationFolders WHERE OperationId=@snapshot);
                INSERT OR IGNORE INTO FolderAncestry SELECT p.AncestorId,f.FolderId FROM FolderAncestry p,OperationFolders f
                  WHERE p.DescendantId=@parentId AND f.OperationId=@snapshot;
                """, new { row.LibraryId, row.Source, target, targetKey = root.Key(target), sourceKey = root.Key(row.Source), snapshot, parentId }, tx, cancellationToken: ct));
            if (!row.IsDirectory)
                await db.ExecuteAsync(new CommandDefinition("UPDATE Media SET FileName=@name,FolderId=@parentId WHERE Id IN (SELECT MediaId FROM OperationMedia WHERE OperationId=@snapshot)", new { name = Path.GetFileName(target), parentId, snapshot }, tx, cancellationToken: ct));
        }
        else if (row.Kind == "mkdir") await EnsureFolderAsync(db, tx, root, row.Source, ct);
        else if (row.Kind == "upload")
        {
            var parentPath = row.Destination!.Contains('/') ? row.Destination[..row.Destination.LastIndexOf('/')] : "";
            var folderId = await EnsureFolderAsync(db, tx, root, parentPath, ct);
            // Existing scan worker discovers the safely published original; no scan in browse handlers.
            await db.ExecuteAsync(new CommandDefinition("""
                INSERT INTO Scans(LibraryId,FolderId,State,StartedAt,MetadataMode)
                  SELECT @LibraryId,@folderId,'queued',@now,MetadataMode FROM Libraries WHERE Id=@LibraryId
                    AND NOT EXISTS(SELECT 1 FROM Scans WHERE LibraryId=@LibraryId AND State IN ('queued','running'));
                UPDATE UploadSessions SET State='completed',UpdatedAt=@now WHERE Id=@UploadId;
                """, new { row.LibraryId, row.UploadId, folderId, now = DateTimeOffset.UtcNow.ToString("O") }, tx, cancellationToken: ct));
        }
        if (row.Kind is "restore" or "purge")
            await db.ExecuteAsync(new CommandDefinition("UPDATE FileOperations SET Restored=1 WHERE Id=@RecycleId", row, tx, cancellationToken: ct));
        await db.ExecuteAsync(new CommandDefinition("UPDATE FileOperations SET State='completed',FinishedAt=@now,FailureCode=NULL WHERE Id=@Id", new { row.Id, now = DateTimeOffset.UtcNow.ToString("O") }, tx, cancellationToken: ct));
        tx.Commit();
        row.State = "completed";
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
