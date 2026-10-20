using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Indexing;
using Luma.Server.Http;
using Microsoft.Data.Sqlite;

namespace Luma.Server.Features.Files;

// Intent and outcome share SQLite with the existing task projection. Only one worker changes
// originals; the source is reserved in an operation-owned path before publication or deletion.
public sealed class FileOperations(Database database, IndexingOptions options, FileWriteAvailability? availability = null)
{
    internal bool HasWritableLibraries => options.Libraries.Any(root => root.Writable);
    internal const string ActiveStates = "'queued','running','reserved','deleting','published','finalizing','needsAttention'";
    public LibraryOptions WritableRoot(long id, bool requireAvailable = true)
    {
        var root = options.Libraries.Find(x => x.Id == id) ?? throw ApiRequestException.Missing();
        if (!root.Writable) throw new ApiRequestException(403, "read_only_library", "This library is read-only.");
        if (requireAvailable) availability?.RequireWritable(id);
        return root;
    }

    public async Task<FileOperationAccepted> QueueAsync(FileOperationRequest request, CancellationToken ct)
    {
        var root = WritableRoot(request.LibraryId);
        if (request.Kind is not ("mkdir" or "copy" or "move" or "recycle" or "delete" or "restore" or "purge")) throw ApiRequestException.Invalid();
        var source = MutationPaths.Normalize(request.Source);
        var destination = request.Destination is null ? null : MutationPaths.Normalize(request.Destination);
        if (request.Kind is "move" or "copy" && (destination is null || root.Key(source) == root.Key(destination) || root.Key(destination).StartsWith(root.Key(source) + '/', StringComparison.Ordinal) || root.Key(source).StartsWith(root.Key(destination) + '/', StringComparison.Ordinal)))
            throw ApiRequestException.Invalid("Source and destination must be distinct and must not contain one another.");
        if (request.ReplaceExisting && request.Kind is not ("move" or "copy")) throw ApiRequestException.Invalid();
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
            SELECT EXISTS(SELECT 1 FROM FileOperations WHERE LibraryId=@Id AND State='needsAttention')
              OR EXISTS(SELECT 1 FROM Scans WHERE LibraryId=@Id AND State IN ('queued','running'))
              OR EXISTS(SELECT 1 FROM ComicJobs WHERE LibraryId=@Id AND State IN ('queued','running'))
            """, root, tx, cancellationToken: ct)))
            throw new ApiRequestException(409, "library_busy", "Finish indexing or resolve the operation needing attention before changing this library.");
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
            if (Directory.Exists(MutationPaths.Resolve(root, source)))
                throw new ApiRequestException(409, "directory_exists", "The destination folder already exists.");
            EnsureDestination(root, source);
        }
        var active = (await db.QueryAsync<FileOperation>(new CommandDefinition($"SELECT * FROM FileOperations WHERE LibraryId=@Id AND State IN ({ActiveStates}) LIMIT 501", root, tx, cancellationToken: ct))).ToArray();
        if (active.Length >= 500) throw new ApiRequestException(409, "queue_full", "Wait for queued file operations to finish before adding more.");
        static bool Overlaps(string a, string b) => a == b || a.StartsWith(b + '/', StringComparison.Ordinal) || b.StartsWith(a + '/', StringComparison.Ordinal);
        var paths = new[] { operation.Source, operation.Destination }.OfType<string>().Select(root.Key).ToArray();
        if (active.Any(other => new[] { other.Source, other.Destination }.OfType<string>().Any(path => paths.Any(candidate => Overlaps(candidate, root.Key(path))))))
            throw new ApiRequestException(409, "path_busy", "A queued operation already uses this file or destination. Wait for it to finish.");
        var uploads = await db.QueryAsync<string>(new CommandDefinition("SELECT Target FROM UploadSessions WHERE LibraryId=@Id AND State IN ('waitingForClient','paused','finalizing') LIMIT 129", root, tx, cancellationToken: ct));
        if (uploads.Any(target => paths.Any(path => PathsOverlap(root, path, target))))
            throw new ApiRequestException(409, "path_busy", "An upload already reserves this file or destination. Wait for it to finish.");
        var checkedDestination = operation.Kind == "mkdir" ? operation.Source : operation.Destination;
        if (checkedDestination is not null)
        {
            var targetPath = MutationPaths.Resolve(root, checkedDestination);
            var replacing = request.ReplaceExisting && (File.Exists(targetPath) || Directory.Exists(targetPath));
            EnsureDestination(root, checkedDestination, allowExisting: replacing);
            if (replacing)
            {
                if (active.Length >= 499) throw new ApiRequestException(409, "queue_full", "Wait for queued file operations to finish before replacing more items.");
                operation.RecycleId = await ReserveReplacementAsync(db, tx, root, checkedDestination, operation.IsDirectory, ct);
            }
            if (!replacing && await db.ExecuteScalarAsync<bool>(new CommandDefinition("""
                SELECT EXISTS(SELECT 1 FROM Media WHERE LibraryId=@LibraryId AND PathKey=@key UNION ALL SELECT 1 FROM Media WHERE LibraryId=@LibraryId AND PathKey>=@key||'/' AND PathKey<@key||'0')
                  OR EXISTS(SELECT 1 FROM Folders WHERE LibraryId=@LibraryId AND PathKey=@key UNION ALL SELECT 1 FROM Folders WHERE LibraryId=@LibraryId AND PathKey>=@key||'/' AND PathKey<@key||'0')
                  OR EXISTS(SELECT 1 FROM Comics WHERE LibraryId=@LibraryId AND PathKey=@key UNION ALL SELECT 1 FROM Comics WHERE LibraryId=@LibraryId AND PathKey>=@key||'/' AND PathKey<@key||'0')
                """, new { operation.LibraryId, key = root.Key(checkedDestination) }, tx, cancellationToken: ct)) &&
                (operation.Kind == "mkdir" || root.Key(checkedDestination) != root.Key(operation.Source)))
                throw new ApiRequestException(409, "indexed_destination_exists", "The destination has retained library metadata. Choose a different name.");
        }
        await db.ExecuteAsync(new CommandDefinition("""
            INSERT INTO FileOperations(Id,LibraryId,Kind,Source,Destination,RecycleId,IsDirectory,SourceSize,SourceModifiedTicks,CreatedAt)
            VALUES(@Id,@LibraryId,@Kind,@Source,@Destination,@RecycleId,@IsDirectory,@SourceSize,@SourceModifiedTicks,@CreatedAt);
            """, operation, tx, cancellationToken: ct));
        if (operation.Kind is "copy" or "move" or "recycle" or "delete")
        {
            await CaptureAsync(db, tx, root, operation, ct);
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

    internal static async Task CaptureAsync(SqliteConnection db, SqliteTransaction tx, LibraryOptions root, FileOperation operation, CancellationToken ct)
    {
        // SQL prefix matching avoids loading a large subtree into application memory.
        await db.ExecuteAsync(new CommandDefinition("""
            INSERT INTO OperationMedia SELECT @Id,Id,RelativePath,Availability FROM Media WHERE LibraryId=@LibraryId AND PathKey=@key
              UNION ALL SELECT @Id,Id,RelativePath,Availability FROM Media WHERE LibraryId=@LibraryId AND PathKey>=@key||'/' AND PathKey<@key||'0';
            INSERT INTO OperationComics SELECT @Id,Id,RelativePath,Availability FROM Comics WHERE LibraryId=@LibraryId AND PathKey=@key
              UNION ALL SELECT @Id,Id,RelativePath,Availability FROM Comics WHERE LibraryId=@LibraryId AND PathKey>=@key||'/' AND PathKey<@key||'0';
            INSERT INTO OperationFolders SELECT @Id,Id,RelativePath FROM Folders WHERE LibraryId=@LibraryId AND PathKey=@key
              UNION ALL SELECT @Id,Id,RelativePath FROM Folders WHERE LibraryId=@LibraryId AND PathKey>=@key||'/' AND PathKey<@key||'0';
            """, new { operation.Id, operation.LibraryId, key = root.Key(operation.Source) }, tx, cancellationToken: ct));
    }

    internal static async Task<string> ReserveReplacementAsync(SqliteConnection db, SqliteTransaction tx, LibraryOptions root, string target, bool isDirectory, CancellationToken ct)
    {
        var path = MutationPaths.Resolve(root, target);
        if (Directory.Exists(path) != isDirectory)
            throw new ApiRequestException(409, "destination_type_conflict", "Files and folders cannot replace one another. Skip this item or choose a different destination.");
        var replacement = new FileOperation
        {
            Id = Guid.NewGuid().ToString("N"),
            LibraryId = root.Id,
            Kind = "recycle",
            Source = target,
            IsDirectory = isDirectory,
            SourceSize = isDirectory ? 0 : new FileInfo(path).Length,
            SourceModifiedTicks = File.GetLastWriteTimeUtc(path).Ticks,
            CreatedAt = DateTimeOffset.UtcNow.ToString("O")
        };
        await db.ExecuteAsync(new CommandDefinition("""
            INSERT INTO FileOperations(Id,LibraryId,Kind,Source,IsDirectory,SourceSize,SourceModifiedTicks,CreatedAt)
            VALUES(@Id,@LibraryId,@Kind,@Source,@IsDirectory,@SourceSize,@SourceModifiedTicks,@CreatedAt);
            """, replacement, tx, cancellationToken: ct));
        await CaptureAsync(db, tx, root, replacement, ct);
        return replacement.Id;
    }

    internal static bool PathsOverlap(LibraryOptions root, string first, string second)
    {
        var a = root.Key(first);
        var b = root.Key(second);
        return a == b || a.StartsWith(b + '/', StringComparison.Ordinal) || b.StartsWith(a + '/', StringComparison.Ordinal);
    }

    internal static void EnsureDestination(LibraryOptions root, string relative, bool allowExisting = false)
    {
        var path = MutationPaths.Resolve(root, relative);
        if (!allowExisting && (File.Exists(path) || Directory.Exists(path))) throw new ApiRequestException(409, "destination_exists", "The destination already exists. Choose a different name.");
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
        WritableRoot(libraryId, requireAvailable: false);
        await using var db = await database.OpenAsync(ct);
        return (await db.QueryAsync<FileOperation>(new CommandDefinition("""
            SELECT * FROM FileOperations WHERE LibraryId=@libraryId AND Kind='recycle' AND Restored=0 AND State='completed'
              AND (@before IS NULL OR CreatedAt<@before) ORDER BY CreatedAt DESC LIMIT 100
            """, new { libraryId, before }, cancellationToken: ct))).ToArray();
    }

    public async Task CancelAsync(string id, CancellationToken ct)
    {
        await using var db = await OpenJournalAsync(ct);
        using var tx = db.BeginTransaction();
        var replacement = await db.ExecuteScalarAsync<string?>(new CommandDefinition("SELECT RecycleId FROM FileOperations WHERE Id=@id AND State='queued' AND Kind IN ('copy','move','upload')", new { id }, tx, cancellationToken: ct));
        if (await db.ExecuteAsync(new CommandDefinition("UPDATE FileOperations SET State='cancelled',FinishedAt=@now WHERE Id=@id AND State='queued'", new { id, now = DateTimeOffset.UtcNow.ToString("O") }, tx, cancellationToken: ct)) == 0)
            throw new ApiRequestException(409, "operation_started", "Only an operation that has not started can be cancelled.");
        if (replacement is not null)
            await db.ExecuteAsync(new CommandDefinition("UPDATE FileOperations SET State='cancelled',FinishedAt=@now WHERE Id=@replacement AND State='queued'", new { replacement, now = DateTimeOffset.UtcNow.ToString("O") }, tx, cancellationToken: ct));
        tx.Commit();
    }
}
