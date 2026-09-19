using Dapper;
using Luma.Server.Data;
using System.Text.Json;

namespace Luma.Server.Features.Indexing;

public sealed class SourceVerificationPreference(Database database)
{
    private const string Key = "sourceVerificationEnabled";
    private readonly SemaphoreSlim gate = new(1, 1);
    private volatile bool enabled;
    private volatile bool initialized;

    public bool Enabled => enabled;

    public async Task InitializeAsync(CancellationToken ct)
    {
        if (initialized) return;
        await gate.WaitAsync(ct);
        try
        {
            if (initialized) return;
            await using var db = await database.OpenAsync(ct);
            enabled = await db.QuerySingleOrDefaultAsync<string>(new CommandDefinition(
                "SELECT Value FROM ApplicationState WHERE Key=@Key", new { Key }, cancellationToken: ct)) == "1";
            initialized = true;
        }
        finally { gate.Release(); }
    }

    public async Task SetEnabledAsync(bool value, CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            await using var db = await database.OpenAsync(ct);
            await db.ExecuteAsync(new CommandDefinition("""
                INSERT INTO ApplicationState(Key,Value) VALUES(@Key,@Value)
                ON CONFLICT(Key) DO UPDATE SET Value=excluded.Value
                """, new { Key, Value = value ? "1" : "0" }, cancellationToken: ct));
            enabled = value;
            initialized = true;
        }
        finally { gate.Release(); }
    }
}

// Checks existing indexed paths in bounded batches; never enumerates directories.
public sealed class SourcePresenceWorker(Database database, IndexingOptions options, SourceVerificationPreference preference,
    ILogger<SourcePresenceWorker> logger) : BackgroundService
{
    private long cursor;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (options.Libraries.Count == 0) return;
        await preference.InitializeAsync(stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromSeconds(options.SourceVerificationIntervalSeconds), stoppingToken);
            if (!preference.Enabled) continue;
            try { await CheckBatchAsync(stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception error) { logger.LogWarning(error, "Source presence check will retry"); }
        }
    }

    public async Task CheckBatchAsync(CancellationToken ct)
    {
        await using var db = await database.OpenAsync(ct);
        var rows = (await db.QueryAsync<PresenceRow>(new CommandDefinition("""
            SELECT m.Id,m.LibraryId,m.RelativePath,m.SourceRevision,m.LastSeenScanId,
              (m.Availability='present' AND EXISTS(SELECT 1 FROM Libraries l WHERE l.Id=m.LibraryId AND l.Enabled=1)
              AND NOT EXISTS(SELECT 1 FROM Scans s WHERE s.LibraryId=m.LibraryId AND s.State IN ('queued','running'))) AS Eligible
            FROM Media m WHERE m.Id>@cursor
            ORDER BY m.Id LIMIT 100
            """, new { cursor }, cancellationToken: ct))).AsList();
        var missing = new List<PresenceRow>();
        foreach (var row in rows)
        {
            ct.ThrowIfCancellationRequested();
            if (row.Eligible == 0) continue;
            var root = options.Libraries.Find(x => x.Id == row.LibraryId);
            if (root is null) continue;
            try { SourcePaths.Resolve(root, row.RelativePath); }
            catch (Exception error) when (error is FileNotFoundException or DirectoryNotFoundException)
            {
                // An unplugged/inaccessible root is not evidence that its files were deleted.
                try { SourcePaths.Check(root, root.Path); }
                catch (Exception rootError) when (rootError is IOException or UnauthorizedAccessException) { continue; }
                missing.Add(row);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
        }
        if (missing.Count > 0)
        {
            await database.YieldToForegroundAsync(ct);
            using var tx = db.BeginTransaction();
            await db.ExecuteAsync(new CommandDefinition("""
                UPDATE Media SET Availability='missing'
                WHERE Id IN (SELECT json_extract(value,'$.Id') FROM json_each(@missing))
                  AND EXISTS(SELECT 1 FROM json_each(@missing) j WHERE json_extract(j.value,'$.Id')=Media.Id
                    AND json_extract(j.value,'$.SourceRevision')=Media.SourceRevision
                    AND json_extract(j.value,'$.LastSeenScanId')=Media.LastSeenScanId)
                  AND NOT EXISTS(SELECT 1 FROM Scans WHERE LibraryId=Media.LibraryId AND State IN ('queued','running'));
                UPDATE ProcessingJobs SET State='waiting'
                WHERE MediaId IN (SELECT json_extract(value,'$.Id') FROM json_each(@missing)) AND State='pending'
                  AND EXISTS(SELECT 1 FROM Media WHERE Id=ProcessingJobs.MediaId AND Availability='missing');
                """, new { missing = JsonSerializer.Serialize(missing) }, tx, cancellationToken: ct));
            tx.Commit();
        }
        cursor = rows.Count == 100 ? rows[^1].Id : 0;
    }

    // Empty SQLite results report computed columns as byte[]; property mapping avoids constructor type matching.
    private sealed record PresenceRow
    {
        public long Id { get; init; }
        public long LibraryId { get; init; }
        public string RelativePath { get; init; } = "";
        public long SourceRevision { get; init; }
        public long LastSeenScanId { get; init; }
        public long Eligible { get; init; }
    }
}
