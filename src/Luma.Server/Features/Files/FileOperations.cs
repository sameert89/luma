using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Indexing;
using Luma.Server.Http;
using Microsoft.Data.Sqlite;

namespace Luma.Server.Features.Files;

// Intent and outcome share SQLite with the existing task projection. Only one worker changes
// originals; the source is reserved in an operation-owned path before publication or deletion.
public sealed class FileOperations(Database database, IndexingOptions options)
{
    internal bool HasWritableLibraries => options.Libraries.Any(root => root.Writable);
    internal const string ActiveStates = "'queued','running','reserved','deleting','published','finalizing','needsAttention'";
    public LibraryOptions WritableRoot(long id)
    {
        var root = options.Libraries.Find(x => x.Id == id) ?? throw ApiRequestException.Missing();
        if (!root.Writable) throw new ApiRequestException(403, "read_only_library", "This library is read-only.");
        return root;
    }

    public async Task<FileOperationAccepted> QueueAsync(FileOperationRequest request, CancellationToken ct)
    {
        var root = WritableRoot(request.LibraryId);
        if (request.Kind is not ("mkdir" or "move" or "recycle" or "delete" or "restore" or "purge")) throw ApiRequestException.Invalid();
        var source = MutationPaths.Normalize(request.Source);
        var destination = request.Destination is null ? null : MutationPaths.Normalize(request.Destination);
        if (request.Kind == "move" && (destination is null || root.Key(source) == root.Key(destination) || root.Key(destination).StartsWith(root.Key(source) + '/', StringComparison.Ordinal)))
            throw ApiRequestException.Invalid("Choose a distinct destination outside the source subtree.");
        var operation = new FileOperation
        {
            Id = Guid.NewGuid().ToString("N"),
            LibraryId = root.Id,
            Kind = request.Kind,
            Source = source,
            Destination = destination,
            RecycleId = request.RecycleId,
            CreatedAt = DateTimeOffset.UtcNow.ToString("O")
        };
        await using var db = await OpenJournalAsync(ct);
        using var tx = db.BeginTransaction();
        if (await db.ExecuteScalarAsync<bool>(new CommandDefinition($"""
            SELECT EXISTS(SELECT 1 FROM FileOperations WHERE LibraryId=@Id AND State IN ({ActiveStates}))
              OR EXISTS(SELECT 1 FROM Scans WHERE LibraryId=@Id AND State IN ('queued','running'))
              OR EXISTS(SELECT 1 FROM UploadSessions WHERE LibraryId=@Id AND State IN ('waitingForClient','paused','finalizing'))
            """, root, tx, cancellationToken: ct)))
            throw new ApiRequestException(409, "library_busy", "Finish indexing or the active file operation before changing this library.");
        if (request.Kind is "restore" or "purge")
        {
            if (!Guid.TryParseExact(request.RecycleId, "N", out _)) throw ApiRequestException.Invalid();
            var recycled = await db.QuerySingleOrDefaultAsync<FileOperation>(new CommandDefinition(
                "SELECT * FROM FileOperations WHERE Id=@RecycleId AND LibraryId=@LibraryId AND Kind='recycle' AND State='completed' AND Restored=0",
                operation, tx, cancellationToken: ct)) ?? throw ApiRequestException.Missing();
            operation.Source = recycled.Source;
            operation.Destination = request.Kind == "restore" ? destination ?? recycled.Source : null;
            operation.IsDirectory = recycled.IsDirectory;
            operation.SourceSize = recycled.SourceSize;
            operation.SourceModifiedTicks = recycled.SourceModifiedTicks;
        }
        else if (request.Kind != "mkdir")
        {
            var path = MutationPaths.Resolve(root, source);
            var attributes = File.GetAttributes(path);
            operation.IsDirectory = attributes.HasFlag(FileAttributes.Directory);
            operation.SourceSize = operation.IsDirectory ? 0 : new FileInfo(path).Length;
            operation.SourceModifiedTicks = File.GetLastWriteTimeUtc(path).Ticks;
        }
        else
        {
            operation.IsDirectory = true;
            EnsureDestination(root, source);
        }
        if (operation.Destination is not null)
        {
            EnsureDestination(root, operation.Destination);
            if (await db.ExecuteScalarAsync<bool>(new CommandDefinition("""
                SELECT EXISTS(SELECT 1 FROM Media WHERE LibraryId=@LibraryId AND (PathKey=@key OR substr(PathKey,1,length(@key)+1)=@key||'/'))
                  OR EXISTS(SELECT 1 FROM Folders WHERE LibraryId=@LibraryId AND (PathKey=@key OR substr(PathKey,1,length(@key)+1)=@key||'/'))
                """, new { operation.LibraryId, key = root.Key(operation.Destination) }, tx, cancellationToken: ct)) &&
                root.Key(operation.Destination) != root.Key(operation.Source))
                throw new ApiRequestException(409, "indexed_destination_exists", "The destination has retained library metadata. Choose a different name.");
        }
        await db.ExecuteAsync(new CommandDefinition("""
            INSERT INTO FileOperations(Id,LibraryId,Kind,Source,Destination,RecycleId,IsDirectory,SourceSize,SourceModifiedTicks,CreatedAt)
            VALUES(@Id,@LibraryId,@Kind,@Source,@Destination,@RecycleId,@IsDirectory,@SourceSize,@SourceModifiedTicks,@CreatedAt);
            """, operation, tx, cancellationToken: ct));
        if (operation.Kind is "move" or "recycle" or "delete")
        {
            // SQL prefix matching avoids loading a large subtree into application memory.
            await db.ExecuteAsync(new CommandDefinition("""
                INSERT INTO OperationMedia SELECT @Id,Id,RelativePath,Availability FROM Media
                  WHERE LibraryId=@LibraryId AND (PathKey=@key OR substr(PathKey,1,length(@key)+1)=@key||'/');
                INSERT INTO OperationFolders SELECT @Id,Id,RelativePath FROM Folders
                  WHERE LibraryId=@LibraryId AND (PathKey=@key OR substr(PathKey,1,length(@key)+1)=@key||'/');
                """, new { operation.Id, operation.LibraryId, key = root.Key(source) }, tx, cancellationToken: ct));
        }
        tx.Commit();
        return new(operation.Id);
    }

    internal async Task<SqliteConnection> OpenJournalAsync(CancellationToken ct)
    {
        var db = await database.OpenAsync(ct);
        try
        {
            // The intent must survive power loss before any filesystem mutation begins.
            await db.ExecuteAsync(new CommandDefinition("PRAGMA synchronous=FULL", cancellationToken: ct));
            return db;
        }
        catch { await db.DisposeAsync(); throw; }
    }

    internal static void EnsureDestination(LibraryOptions root, string relative)
    {
        var path = MutationPaths.Resolve(root, relative);
        if (File.Exists(path) || Directory.Exists(path)) throw new ApiRequestException(409, "destination_exists", "The destination already exists. Choose a different name.");
        var parent = Path.GetDirectoryName(path)!;
        if (!Directory.Exists(parent)) throw ApiRequestException.Invalid("The destination folder does not exist.");
    }

    public async Task<FileOperation> GetAsync(string id, CancellationToken ct)
    {
        await using var db = await database.OpenAsync(ct);
        return await db.QuerySingleOrDefaultAsync<FileOperation>(new CommandDefinition("SELECT * FROM FileOperations WHERE Id=@id", new { id }, cancellationToken: ct)) ?? throw ApiRequestException.Missing();
    }

    public async Task<IReadOnlyList<FileOperation>> TrashAsync(long libraryId, string? before, CancellationToken ct)
    {
        WritableRoot(libraryId);
        await using var db = await database.OpenAsync(ct);
        return (await db.QueryAsync<FileOperation>(new CommandDefinition("""
            SELECT * FROM FileOperations WHERE LibraryId=@libraryId AND Kind='recycle' AND Restored=0 AND State='completed'
              AND (@before IS NULL OR CreatedAt<@before) ORDER BY CreatedAt DESC LIMIT 100
            """, new { libraryId, before }, cancellationToken: ct))).ToArray();
    }

    public async Task CancelAsync(string id, CancellationToken ct)
    {
        await using var db = await OpenJournalAsync(ct);
        if (await db.ExecuteAsync(new CommandDefinition("UPDATE FileOperations SET State='cancelled',FinishedAt=@now WHERE Id=@id AND State='queued'", new { id, now = DateTimeOffset.UtcNow.ToString("O") }, cancellationToken: ct)) == 0)
            throw new ApiRequestException(409, "operation_started", "Only an operation that has not started can be cancelled.");
    }
}
