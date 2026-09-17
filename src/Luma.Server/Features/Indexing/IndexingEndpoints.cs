using Dapper;
using Luma.Server.Data;
using Luma.Server.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Data.Sqlite;

namespace Luma.Server.Features.Indexing;

public sealed record StartScanRequest(bool Force = false, bool RetryFailures = false);
public sealed record ScanAccepted(long Id);
public sealed record ScanFailure(long Id, long? MediaId, string Code, string OccurredAt);
public sealed record ScanProgress(long Id, long LibraryId, string State, long Discovered, long Skipped,
    string StartedAt, string? FinishedAt, string? FailureCode, long Pending, long Processing, long Ready, long Failed,
    IReadOnlyList<ScanFailure> Failures, long? NextFailureId);
public sealed record IndexingLibrary(long Id, string Name, string Availability, long? LatestScanId);
public sealed record IndexingStatus(IReadOnlyList<IndexingLibrary> Libraries, bool CachePressure, long CacheBytes,
    int DiscoveryWorkers, int ProcessingWorkers, int ImageWorkers, int VideoWorkers, int QueueCapacity);

public static class IndexingEndpoints
{
    public static void MapIndexing(this WebApplication app)
    {
        app.MapPost("/api/folders/{id:long}/index", async Task<Results<Accepted<ScanAccepted>, NoContent, ProblemHttpResult>>
            (long id, Database database, ScanWorker worker, HttpContext context, CancellationToken ct) =>
        {
            await using var db = await database.OpenAsync(ct);
            using var tx = db.BeginTransaction();
            var folder = await db.QuerySingleOrDefaultAsync<FolderIndexRow>(new CommandDefinition("""
                SELECT f.LibraryId,f.DirectIndexedAt FROM Folders f JOIN Libraries l ON l.Id=f.LibraryId
                WHERE f.Id=@id AND l.Enabled=1
                """, new { id }, tx, cancellationToken: ct));
            if (folder is null) return Problem(404, context);
            if (folder.DirectIndexedAt is not null && !await db.ExecuteScalarAsync<bool>(new CommandDefinition("""
                SELECT EXISTS(SELECT 1 FROM Media m WHERE m.FolderId=@id AND m.Availability='present' AND m.ProcessingStatus='pending'
                  AND NOT EXISTS(SELECT 1 FROM ProcessingJobs j JOIN Scans s ON s.Id=j.ScanId
                    WHERE j.MediaId=m.Id AND j.SourceRevision=m.SourceRevision AND j.EncoderVersion=@version
                      AND j.State IN ('pending','running') AND s.State IN ('running','completed')))
                """, new { id, version = IndexingOptions.EncoderVersion }, tx, cancellationToken: ct))) return TypedResults.NoContent();
            if (await db.ExecuteScalarAsync<bool>(new CommandDefinition("SELECT EXISTS(SELECT 1 FROM Scans WHERE LibraryId=@LibraryId AND FolderId IS NULL AND State IN ('queued','running'))", folder, tx, cancellationToken: ct)))
            {
                worker.PrioritizeFolder(folder.LibraryId, id);
                return Problem(409, context);
            }
            if (await db.ExecuteScalarAsync<bool>(new CommandDefinition("SELECT EXISTS(SELECT 1 FROM Scans WHERE LibraryId=@LibraryId AND State IN ('queued','running'))", folder, tx, cancellationToken: ct))) return Problem(409, context);
            var scanId = await db.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO Scans(LibraryId,FolderId,State,StartedAt) VALUES(@LibraryId,@id,'queued',@now) RETURNING Id
                """, new { folder.LibraryId, id, now = DateTimeOffset.UtcNow.ToString("O") }, tx, cancellationToken: ct));
            tx.Commit();
            return TypedResults.Accepted($"/api/scans/{scanId}", new ScanAccepted(scanId));
        }).WithName("IndexFolder").Produces<ApiProblem>(404, "application/problem+json").Produces<ApiProblem>(409, "application/problem+json");
        app.MapGet("/api/indexing", async (Database database, IndexingOptions options, MediaProcessing.GeneratedCache cache, CancellationToken ct) =>
        {
            await using var db = await database.OpenAsync(ct);
            var roots = (await db.QueryAsync<LibraryRow>(new CommandDefinition("""
                SELECT Id,Name,Availability,(SELECT MAX(Id) FROM Scans WHERE LibraryId=Libraries.Id) LatestScanId
                FROM Libraries WHERE Enabled=1 ORDER BY Id
                """, cancellationToken: ct))).Select(x => new IndexingLibrary(x.Id, x.Name, x.Availability, x.LatestScanId)).ToArray();
            var bytes = await db.ExecuteScalarAsync<long>(new CommandDefinition("SELECT SizeBytes FROM CacheAccounting WHERE Id=1", cancellationToken: ct));
            return TypedResults.Ok(new IndexingStatus(roots, cache.UnderPressure, bytes, options.DiscoveryWorkers,
                options.ProcessingWorkers, options.ImageWorkers, options.VideoWorkers, options.QueueCapacity));
        }).WithName("GetIndexingStatus");

        app.MapPost("/api/libraries/{id:long}/scans", async Task<Results<Accepted<ScanAccepted>, ProblemHttpResult>>
            (long id, StartScanRequest request, Database database, HttpContext context, CancellationToken ct) =>
        {
            await using var db = await database.OpenAsync(ct);
            try
            {
                var scanId = await db.QuerySingleOrDefaultAsync<long?>(new CommandDefinition("""
                    INSERT INTO Scans(LibraryId,State,Force,RetryFailures,StartedAt)
                    SELECT Id,'queued',@Force,@RetryFailures,@now FROM Libraries WHERE Id=@id AND Enabled=1 RETURNING Id
                    """, new { id, request.Force, request.RetryFailures, now = DateTimeOffset.UtcNow.ToString("O") }, cancellationToken: ct));
                return scanId is null ? Problem(404, context) : TypedResults.Accepted($"/api/scans/{scanId}", new ScanAccepted(scanId.Value));
            }
            catch (SqliteException error) when (error.SqliteErrorCode == 19) { return Problem(409, context); }
        }).WithName("StartScan").Produces<ApiProblem>(400, "application/problem+json")
            .Produces<ApiProblem>(404, "application/problem+json").Produces<ApiProblem>(409, "application/problem+json");

        app.MapGet("/api/scans/{id:long}", async Task<Results<Ok<ScanProgress>, ProblemHttpResult>>
            (long id, long? afterFailureId, Database database, HttpContext context, CancellationToken ct) =>
        {
            if (afterFailureId < 0) return Problem(400, context);
            await using var db = await database.OpenAsync(ct);
            var scan = await db.QuerySingleOrDefaultAsync<ScanRow>(new CommandDefinition("SELECT * FROM Scans WHERE Id=@id", new { id }, cancellationToken: ct));
            if (scan is null) return Problem(404, context);
            var counts = (await db.QueryAsync<JobCount>(new CommandDefinition(
                "SELECT State,COUNT(*) Count FROM ProcessingJobs WHERE ScanId=@id GROUP BY State", new { id }, cancellationToken: ct)))
                .ToDictionary(x => x.State, x => x.Count);
            var failures = (await db.QueryAsync<ScanFailure>(new CommandDefinition("""
                SELECT Id,MediaId,Code,OccurredAt FROM ProcessingFailures WHERE ScanId=@id AND Id>@after ORDER BY Id LIMIT 101
                """, new { id, after = afterFailureId ?? 0 }, cancellationToken: ct))).ToArray();
            return TypedResults.Ok(new ScanProgress(scan.Id, scan.LibraryId, scan.State, scan.Discovered, scan.Skipped,
                scan.StartedAt, scan.FinishedAt, scan.FailureCode, counts.GetValueOrDefault("pending") + counts.GetValueOrDefault("waiting"),
                counts.GetValueOrDefault("running"), counts.GetValueOrDefault("ready"), counts.GetValueOrDefault("failed"),
                failures.Take(100).ToArray(), failures.Length > 100 ? failures[99].Id : null));
        }).WithName("GetScan").Produces<ApiProblem>(400, "application/problem+json").Produces<ApiProblem>(404, "application/problem+json");

        app.MapPost("/api/scans/{id:long}/cancel", async Task<Results<Accepted<ScanAccepted>, ProblemHttpResult>>
            (long id, Database database, ScanWorker worker, HttpContext context, CancellationToken ct) =>
        {
            await using var db = await database.OpenAsync(ct);
            if (!await db.ExecuteScalarAsync<bool>(new CommandDefinition("SELECT EXISTS(SELECT 1 FROM Scans WHERE Id=@id)", new { id }, cancellationToken: ct)))
                return Problem(404, context);
            await db.ExecuteAsync(new CommandDefinition("""
                UPDATE Scans SET State='cancelled',FinishedAt=@now WHERE Id=@id AND
                  (State IN ('queued','running') OR (State='completed' AND EXISTS
                    (SELECT 1 FROM ProcessingJobs WHERE ScanId=@id AND State IN ('pending','running'))));
                UPDATE ProcessingJobs SET State='waiting' WHERE ScanId=@id AND State='pending'
                  AND EXISTS(SELECT 1 FROM Scans WHERE Id=@id AND State='cancelled');
                """, new { id, now = DateTimeOffset.UtcNow.ToString("O") }, cancellationToken: ct));
            worker.Cancel(id);
            return TypedResults.Accepted($"/api/scans/{id}", new ScanAccepted(id));
        }).WithName("CancelScan").Produces<ApiProblem>(404, "application/problem+json");
    }

    private static ProblemHttpResult Problem(int status, HttpContext context) =>
        TypedResults.Problem(statusCode: status, extensions: ApiErrors.Extensions(status, context));
    private sealed class JobCount
    {
        public string State { get; set; } = "";
        public long Count { get; set; }
    }
    private sealed class FolderIndexRow
    {
        public long LibraryId { get; set; }
        public string? DirectIndexedAt { get; set; }
    }
    private sealed class LibraryRow
    {
        public long Id { get; set; }
        public string Name { get; set; } = "";
        public string Availability { get; set; } = "";
        public long? LatestScanId { get; set; }
    }
}

public sealed class ScanRow
{
    public long? FolderId { get; set; }
    public long Id { get; set; }
    public long LibraryId { get; set; }
    public string State { get; set; } = "";
    public bool Force { get; set; }
    public bool RetryFailures { get; set; }
    public long Discovered { get; set; }
    public long Skipped { get; set; }
    public string StartedAt { get; set; } = "";
    public string? FinishedAt { get; set; }
    public string? FailureCode { get; set; }
}
