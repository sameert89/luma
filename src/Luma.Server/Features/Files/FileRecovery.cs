using Dapper;
using Luma.Server.Features.Indexing;
using Luma.Server.Http;

namespace Luma.Server.Features.Files;

public sealed record FileRecoveryRequest(string Action, bool Confirmed, string? ExpectedFailureCode, string? Destination = null);
public sealed record FileRecoveryEvidence(FileOperation Operation, string StagingPath, bool SourceExists, bool SourceMatches,
    bool StagingExists, bool DestinationExists, bool DestinationMatches, IReadOnlyList<string> Actions);

public sealed class FileRecovery(FileOperations operations)
{
    public async Task<FileRecoveryEvidence> InspectAsync(string id, CancellationToken ct)
    {
        var row = await operations.GetAsync(id, ct);
        return Inspect(row, operations.WritableRoot(row.LibraryId));
    }

    private static FileRecoveryEvidence Inspect(FileOperation row, LibraryOptions root)
    {
        var category = row.Kind == "upload" ? MutationPaths.UploadDirectory : row.Kind is "recycle" or "restore" or "purge" ? MutationPaths.TrashDirectory : MutationPaths.OperationsDirectory;
        var staging = MutationPaths.Internal(root, category, row.UploadId ?? row.RecycleId ?? row.Id);
        var source = MutationPaths.Resolve(root, row.Source);
        var destination = row.Kind == "mkdir" ? source : row.Destination is null ? null : MutationPaths.Resolve(root, row.Destination);
        var staged = Exists(staging);
        var sourceExists = Exists(source);
        var destinationExists = destination is not null && Exists(destination);
        var sourceMatches = sourceExists && Matches(source, row);
        var destinationMatches = destinationExists && Matches(destination!, row);
        var actions = new List<string>();
        if (row.State == "needsAttention")
        {
            var phase = row.RecoveryState;
            var retry = phase switch
            {
                "running" or null => staged,
                "reserved" => staged && (row.Kind is "delete" or "purge" or "recycle" || !destinationExists),
                "deleting" => true,
                "published" or "finalizing" => row.Kind switch
                {
                    "delete" or "purge" => true,
                    "recycle" => staged,
                    _ => !staged && destinationMatches
                },
                _ => false
            };
            if (retry) actions.Add("retry");
            if (phase == "running" && !staged && row.Kind is "mkdir" or "move" or "delete" or "recycle")
            {
                if ((row.Kind == "mkdir" && !sourceExists) || (sourceExists && !destinationExists)) actions.Add("cancel");
                if ((row.Kind == "mkdir" && !sourceExists) || (sourceMatches && !destinationExists)) actions.Add("restart");
            }
            // A missing publication marker is never inferred automatically. Explicit confirmation
            // still requires matching indexed size/timestamp/type and the absence of owned staging.
            if ((phase == "reserved" || phase is null && row.FailureCode == "publication_uncertain") && !staged && destinationMatches &&
                row.Kind is "move" or "restore" or "upload" or "mkdir") actions.Add("confirmPublished");
        }
        return new(row, Path.GetRelativePath(root.Path, staging).Replace(Path.DirectorySeparatorChar, '/'),
            sourceExists, sourceMatches, staged, destinationExists, destinationMatches, actions);
    }

    public async Task<FileOperationAccepted> ResolveAsync(string id, FileRecoveryRequest request, CancellationToken ct)
    {
        if (!request.Confirmed) throw ApiRequestException.Invalid("Review the operation evidence before confirming recovery.");
        await using var db = await operations.OpenJournalAsync(ct);
        using var tx = db.BeginTransaction();
        var row = await db.QuerySingleOrDefaultAsync<FileOperation>(new CommandDefinition("SELECT * FROM FileOperations WHERE Id=@id", new { id }, tx, cancellationToken: ct)) ?? throw ApiRequestException.Missing();
        var root = operations.WritableRoot(row.LibraryId);
        if (row.State != "needsAttention" || request.ExpectedFailureCode != row.FailureCode)
            throw new ApiRequestException(409, "recovery_changed", "This operation changed. Reload its evidence before continuing.");
        if (request.Destination is not null)
        {
            if (request.Action != "retry" || row.RecoveryState != "reserved" || row.Kind is not ("move" or "restore" or "upload")) throw ApiRequestException.Invalid();
            var target = MutationPaths.Normalize(request.Destination);
            if (root.Key(target).StartsWith(root.Key(row.Source) + '/', StringComparison.Ordinal) || row.Kind == "move" && root.Key(target) == root.Key(row.Source)) throw ApiRequestException.Invalid();
            FileOperations.EnsureDestination(root, target);
            if (root.Key(target) != root.Key(row.Source) && await db.ExecuteScalarAsync<bool>(new CommandDefinition("""
                SELECT EXISTS(SELECT 1 FROM Media WHERE LibraryId=@LibraryId AND (PathKey=@key OR substr(PathKey,1,length(@key)+1)=@key||'/'))
                  OR EXISTS(SELECT 1 FROM Folders WHERE LibraryId=@LibraryId AND (PathKey=@key OR substr(PathKey,1,length(@key)+1)=@key||'/'))
                  OR EXISTS(SELECT 1 FROM Comics WHERE LibraryId=@LibraryId AND (PathKey=@key OR substr(PathKey,1,length(@key)+1)=@key||'/'))
                """, new { row.LibraryId, key = root.Key(target) }, tx, cancellationToken: ct)))
                throw new ApiRequestException(409, "indexed_destination_exists", "Choose a destination without retained library metadata.");
            var uploads = await db.QueryAsync<string>(new CommandDefinition("SELECT Target FROM UploadSessions WHERE LibraryId=@LibraryId AND Id<>COALESCE(@UploadId,'') AND State IN ('waitingForClient','paused','finalizing')", row, tx, cancellationToken: ct));
            if (uploads.Any(path => root.Key(path) == root.Key(target))) throw new ApiRequestException(409, "library_busy", "Another upload reserves this destination.");
            row.Destination = target;
        }
        if (!Inspect(row, root).Actions.Contains(request.Action))
            throw new ApiRequestException(409, "recovery_unsafe", "The current evidence does not support this recovery action.");
        var phase = request.Action switch
        {
            "confirmPublished" => "published",
            "restart" => "running",
            _ => row.RecoveryState ?? "running"
        };
        await db.ExecuteAsync(new CommandDefinition("""
            UPDATE FileOperations SET State=@state,RecoveryState=@phase,RecoveryRequested=@retry,Destination=@Destination,
              FinishedAt=CASE WHEN @state='cancelled' THEN @now ELSE FinishedAt END
            WHERE Id=@Id AND State='needsAttention';
            """, new
        {
            row.Id,
            row.Destination,
            phase,
            state = request.Action == "cancel" ? "cancelled" : "queued",
            retry = request.Action == "cancel" ? 0 : 1,
            now = DateTimeOffset.UtcNow.ToString("O")
        }, tx, cancellationToken: ct));
        // Restart is renewed operator intent for an unchanged current public source; it may
        // reserve that source once. Ordinary retry always uses conservative crash recovery.
        if (request.Action == "restart")
            await db.ExecuteAsync(new CommandDefinition("UPDATE FileOperations SET RecoveryRequested=0 WHERE Id=@Id", row, tx, cancellationToken: ct));
        if (row.UploadId is not null && request.Destination is not null)
            await db.ExecuteAsync(new CommandDefinition("UPDATE UploadSessions SET Target=@Destination WHERE Id=@UploadId", row, tx, cancellationToken: ct));
        tx.Commit();
        return new(row.Id);
    }

    private static bool Exists(string path)
    {
        try { _ = File.GetAttributes(path); return true; }
        catch (FileNotFoundException) { return false; }
        catch (DirectoryNotFoundException) { return false; }
    }
    private static bool Matches(string path, FileOperation row)
    {
        var attributes = File.GetAttributes(path);
        return !attributes.HasFlag(FileAttributes.ReparsePoint) && attributes.HasFlag(FileAttributes.Directory) == row.IsDirectory &&
            (row.Kind == "mkdir" || (row.IsDirectory || new FileInfo(path).Length == row.SourceSize) && File.GetLastWriteTimeUtc(path).Ticks == row.SourceModifiedTicks);
    }
}
