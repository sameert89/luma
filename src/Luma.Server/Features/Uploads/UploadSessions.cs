using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Files;
using Luma.Server.Http;

namespace Luma.Server.Features.Uploads;

public sealed record UploadRequest(long LibraryId, string Target, long SizeBytes, string? RequestId = null, bool ReplaceExisting = false);
public sealed class UploadSession
{
    public string Id { get; set; } = "";
    public long LibraryId { get; set; }
    public string Target { get; set; } = "";
    public long SizeBytes { get; set; }
    public long CommittedOffset { get; set; }
    public string State { get; set; } = "waitingForClient";
    public string CreatedAt { get; set; } = "";
    public string UpdatedAt { get; set; } = "";
    public string? OperationId { get; set; }
}

public sealed class UploadSessions(Database database, FileOperations operations, IConfiguration configuration)
{
    public const int ChunkBytes = 8 * 1024 * 1024;
    private readonly SemaphoreSlim creation = new(1);
    // Fixed-size stripes bound lock memory across a long-lived server's entire upload history.
    private readonly SemaphoreSlim[] stripes = Enumerable.Range(0, 32).Select(_ => new SemaphoreSlim(1)).ToArray();
    private readonly SemaphoreSlim transferSlots = new(Math.Clamp(configuration.GetValue("Luma:Uploads:Concurrency", 2), 1, 4));
    private readonly long maximumFile = configuration.GetValue("Luma:Uploads:MaxFileBytes", 1024L * 1024 * 1024 * 1024);
    private readonly long stagingQuota = configuration.GetValue("Luma:Uploads:StagingQuotaBytes", 1024L * 1024 * 1024 * 1024);
    private SemaphoreSlim Stripe(string id) => stripes[(int)((uint)StringComparer.Ordinal.GetHashCode(id) % (uint)stripes.Length)];

    public async Task<UploadSession> CreateAsync(UploadRequest request, CancellationToken ct)
    {
        var root = operations.WritableRoot(request.LibraryId);
        var target = MutationPaths.Normalize(request.Target);
        if (request.SizeBytes < 0 || request.SizeBytes > maximumFile) throw new ApiRequestException(413, "upload_size_limit", "The upload exceeds the configured file-size limit.");
        if (request.RequestId is not null && !Guid.TryParseExact(request.RequestId, "N", out _)) throw ApiRequestException.Invalid();
        await creation.WaitAsync(ct);
        try
        {
            await using var db = await operations.OpenJournalAsync(ct);
            using var tx = db.BeginTransaction();
            if (request.RequestId is not null)
            {
                var previous = await db.QuerySingleOrDefaultAsync<UploadSession>(new CommandDefinition("SELECT * FROM UploadSessions WHERE Id=@RequestId", request, tx, cancellationToken: ct));
                if (previous is not null)
                {
                    if (previous.LibraryId != root.Id || previous.Target != target || previous.SizeBytes != request.SizeBytes)
                        throw new ApiRequestException(409, "upload_request_mismatch", "This upload request ID already belongs to a different file.");
                    return previous;
                }
            }
            var (count, reserved) = await db.QuerySingleAsync<(long Count, long Reserved)>(new CommandDefinition(
                "SELECT COUNT(*),COALESCE(SUM(SizeBytes),0) FROM UploadSessions WHERE State IN ('waitingForClient','paused','finalizing')", transaction: tx, cancellationToken: ct));
            if (count >= 128 || request.SizeBytes > stagingQuota - reserved) throw new ApiRequestException(409, "upload_capacity", "The upload session or staging-space limit has been reached.");
            var active = (await db.QueryAsync<FileOperation>(new CommandDefinition($"SELECT * FROM FileOperations WHERE LibraryId=@LibraryId AND State IN ({FileOperations.ActiveStates}) LIMIT 501", request, tx, cancellationToken: ct))).ToArray();
            if (active.Any(operation => operation.State == "needsAttention"))
                throw new ApiRequestException(409, "library_busy", "Resolve the operation needing attention before uploading to this library.");
            if (active.Any(operation => new[] { operation.Source, operation.Destination }.OfType<string>().Any(path => FileOperations.PathsOverlap(root, path, target))))
                throw new ApiRequestException(409, "path_busy", "A queued operation already uses this upload destination. Wait for it to finish.");
            var activeTargets = await db.QueryAsync<string>(new CommandDefinition("SELECT Target FROM UploadSessions WHERE LibraryId=@LibraryId AND State IN ('waitingForClient','paused','finalizing')", request, tx, cancellationToken: ct));
            // Admission caps this list at 128. Apply the configured root's Unicode case policy,
            // rather than SQLite's ASCII-only upper/collation behavior.
            if (activeTargets.Any(existing => FileOperations.PathsOverlap(root, existing, target)))
                throw new ApiRequestException(409, "library_busy", "An upload already reserves this destination.");
            var targetPath = MutationPaths.Resolve(root, target);
            if (request.ReplaceExisting && Directory.Exists(targetPath))
                throw new ApiRequestException(409, "destination_type_conflict", "A file cannot replace a folder. Skip this item or choose a different destination.");
            FileOperations.EnsureDestination(root, target, allowExisting: request.ReplaceExisting);
            var now = DateTimeOffset.UtcNow.ToString("O");
            var session = new UploadSession { Id = request.RequestId ?? Guid.NewGuid().ToString("N"), LibraryId = root.Id, Target = target, SizeBytes = request.SizeBytes, CreatedAt = now, UpdatedAt = now };
            await db.ExecuteAsync(new CommandDefinition("INSERT INTO UploadSessions(Id,LibraryId,Target,SizeBytes,CreatedAt,UpdatedAt) VALUES(@Id,@LibraryId,@Target,@SizeBytes,@CreatedAt,@UpdatedAt)", session, tx, cancellationToken: ct));
            tx.Commit();
            // File creation can be retried lazily. A durable offset of zero never assumes it exists.
            return session;
        }
        finally { creation.Release(); }
    }

    public async Task<UploadSession> GetAsync(string id, CancellationToken ct)
    {
        if (!Guid.TryParseExact(id, "N", out _)) throw ApiRequestException.Invalid();
        await using var db = await database.OpenAsync(ct);
        return await db.QuerySingleOrDefaultAsync<UploadSession>(new CommandDefinition("SELECT * FROM UploadSessions WHERE Id=@id", new { id }, cancellationToken: ct)) ?? throw ApiRequestException.Missing();
    }

    public async Task<UploadSession> AppendAsync(string id, long offset, Stream input, long length, CancellationToken ct)
    {
        if (length is < 1 or > ChunkBytes) throw new ApiRequestException(413, "chunk_size_limit", "Upload chunks must contain between 1 byte and 8 MiB.");
        await transferSlots.WaitAsync(ct);
        var gate = Stripe(id);
        var locked = false;
        try
        {
            await gate.WaitAsync(ct); locked = true;
            var session = await GetAsync(id, ct);
            var root = operations.WritableRoot(session.LibraryId);
            if (session.State != "waitingForClient") throw new ApiRequestException(409, "upload_not_active", "Resume this upload before transferring bytes.");
            if (offset != session.CommittedOffset || length > session.SizeBytes - offset)
                throw new ApiRequestException(409, "upload_offset_mismatch", "Query the server offset before retrying this chunk.");
            var path = MutationPaths.Internal(root, MutationPaths.UploadDirectory, id);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            MutationPaths.Internal(root, MutationPaths.UploadDirectory, id);
            await using var output = new FileStream(path, FileMode.OpenOrCreate, FileAccess.Write, FileShare.None, 64 * 1024, FileOptions.Asynchronous);
            if (output.Length < offset) throw new ApiRequestException(409, "upload_staging_incomplete", "Upload staging is shorter than its durable checkpoint; inspect the session before continuing.");
            // Discard a tail left by an interrupted request, never the committed prefix.
            output.SetLength(offset); output.Position = offset;
            var buffer = new byte[64 * 1024];
            long received = 0;
            try
            {
                while (received < length)
                {
                    var read = await input.ReadAsync(buffer.AsMemory(0, (int)Math.Min(buffer.Length, length - received)), ct);
                    if (read == 0) throw ApiRequestException.Invalid("The upload chunk ended before its declared length.");
                    await output.WriteAsync(buffer.AsMemory(0, read), ct);
                    received += read;
                }
                await output.FlushAsync(ct);
                output.Flush(flushToDisk: true);
                await using var db = await operations.OpenJournalAsync(ct);
                await db.ExecuteAsync(new CommandDefinition("UPDATE UploadSessions SET CommittedOffset=@next,UpdatedAt=@now WHERE Id=@id AND CommittedOffset=@offset", new { id, offset, next = offset + received, now = DateTimeOffset.UtcNow.ToString("O") }, cancellationToken: ct));
                session.CommittedOffset += received;
                return session;
            }
            catch { throw; }
        }
        finally { if (locked) gate.Release(); transferSlots.Release(); }
    }

    public async Task<UploadSession> ChangeStateAsync(string id, string action, CancellationToken ct)
    {
        var gate = Stripe(id);
        await gate.WaitAsync(ct);
        try
        {
            var session = await GetAsync(id, ct);
            var root = operations.WritableRoot(session.LibraryId);
            if (action == "cancel" && session.State == "cancelled") return session;
            if (session.State is not ("waitingForClient" or "paused")) throw new ApiRequestException(409, "upload_not_active", "The upload is no longer waiting for data.");
            var state = action switch { "pause" => "paused", "resume" => "waitingForClient", "cancel" => "cancelled", _ => throw ApiRequestException.Invalid() };
            if (state == "cancelled")
            {
                var path = MutationPaths.Internal(root, MutationPaths.UploadDirectory, id);
                try { File.Delete(path); }
                catch (DirectoryNotFoundException) { /* No staging was created, or it was already removed. */ }
            }
            // Release the durable reservation only after staging deletion succeeds. A crash
            // before this checkpoint leaves a cancellable session, never untracked staged bytes.
            await using var db = await operations.OpenJournalAsync(ct);
            await db.ExecuteAsync(new CommandDefinition("UPDATE UploadSessions SET State=@state,UpdatedAt=@now WHERE Id=@id", new { id, state, now = DateTimeOffset.UtcNow.ToString("O") }, cancellationToken: ct));
            session.State = state;
            return session;
        }
        finally { gate.Release(); }
    }

    public async Task<UploadSession> FinalizeAsync(string id, CancellationToken ct, bool replaceExisting = false)
    {
        var gate = Stripe(id);
        await gate.WaitAsync(ct);
        try
        {
            var session = await GetAsync(id, ct);
            if (session.State is "finalizing" or "completed") return session;
            if (session.State != "waitingForClient" || session.CommittedOffset != session.SizeBytes)
                throw new ApiRequestException(409, "upload_incomplete", "Finish uploading every byte before publication.");
            var root = operations.WritableRoot(session.LibraryId);
            var path = MutationPaths.Internal(root, MutationPaths.UploadDirectory, id);
            if (session.SizeBytes == 0)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                MutationPaths.Internal(root, MutationPaths.UploadDirectory, id);
                using var empty = new FileStream(path, FileMode.OpenOrCreate, FileAccess.Write, FileShare.None);
                empty.Flush(true);
            }
            if (!File.Exists(path) || new FileInfo(path).Length != session.SizeBytes) throw new ApiRequestException(409, "upload_staging_incomplete", "The uploaded file size does not match the durable session.");
            var targetPath = MutationPaths.Resolve(root, session.Target);
            if (replaceExisting && Directory.Exists(targetPath))
                throw new ApiRequestException(409, "destination_type_conflict", "A file cannot replace a folder. Skip this item or choose a different destination.");
            FileOperations.EnsureDestination(root, session.Target, allowExisting: replaceExisting);
            await using var db = await operations.OpenJournalAsync(ct);
            using var tx = db.BeginTransaction();
            var active = (await db.QueryAsync<FileOperation>(new CommandDefinition($"SELECT * FROM FileOperations WHERE LibraryId=@LibraryId AND State IN ({FileOperations.ActiveStates}) LIMIT 501", session, tx, cancellationToken: ct))).ToArray();
            if (active.Length >= 500) throw new ApiRequestException(409, "queue_full", "Wait for queued file operations to finish before publishing more uploads.");
            if (active.Any(operation => operation.State == "needsAttention"))
                throw new ApiRequestException(409, "library_busy", "Resolve the operation needing attention before publishing to this library.");
            if (active.Any(operation => new[] { operation.Source, operation.Destination }.OfType<string>().Any(candidate => FileOperations.PathsOverlap(root, candidate, session.Target))))
                throw new ApiRequestException(409, "path_busy", "A queued operation already uses this upload destination. Wait for it to finish.");
            string? replacementId = null;
            if (replaceExisting && File.Exists(targetPath))
            {
                if (active.Length >= 499) throw new ApiRequestException(409, "queue_full", "Wait for queued file operations to finish before replacing more items.");
                replacementId = await FileOperations.ReserveReplacementAsync(db, tx, root, session.Target, isDirectory: false, ct);
            }
            var operationId = Guid.NewGuid().ToString("N");
            await db.ExecuteAsync(new CommandDefinition("""
                INSERT INTO FileOperations(Id,LibraryId,Kind,Source,Destination,UploadId,RecycleId,IsDirectory,SourceSize,SourceModifiedTicks,CreatedAt)
                  VALUES(@operationId,@LibraryId,'upload',@Target,@Target,@Id,@replacementId,0,@SizeBytes,@modified,@now);
                UPDATE UploadSessions SET State='finalizing',OperationId=@operationId,UpdatedAt=@now WHERE Id=@Id;
                """, new { session.Id, session.LibraryId, session.Target, session.SizeBytes, operationId, replacementId, modified = File.GetLastWriteTimeUtc(path).Ticks, now = DateTimeOffset.UtcNow.ToString("O") }, tx, cancellationToken: ct));
            tx.Commit();
            session.State = "finalizing"; session.OperationId = operationId;
            return session;
        }
        finally { gate.Release(); }
    }
}
