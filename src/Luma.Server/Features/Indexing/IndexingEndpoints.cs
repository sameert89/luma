using Dapper;
using System.Text.Json;
using Luma.Server.Features.Tags;
using Luma.Server.Features.Media;
using Luma.Server.Data;
using Luma.Server.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Data.Sqlite;

namespace Luma.Server.Features.Indexing;

public sealed record StartScanRequest(bool Force = false, bool RetryFailures = false,string MetadataMode = "embedded");
public sealed record ScanAccepted(long Id);
public sealed record ScanFailure(long Id, long? MediaId, string Code, string OccurredAt);
public sealed record ScanProgress(long Id, long LibraryId, string State, long Discovered, long Skipped,
    string StartedAt, string? FinishedAt, string? FailureCode, long Pending, long Processing, long Ready, long Failed,
    IReadOnlyList<ScanFailure> Failures, long? NextFailureId);
public sealed record IndexingLibrary(long Id, string Name, string Availability, long? LatestScanId);
public sealed record IndexingStatus(IReadOnlyList<IndexingLibrary> Libraries, bool CachePressure, long CacheBytes,
    int DiscoveryWorkers, int ProcessingWorkers, int ImageWorkers, int VideoWorkers, int QueueCapacity);
public sealed record SourceVerificationSetting(bool Enabled);

public static class IndexingEndpoints
{
    public static void MapIndexing(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/settings/source-verification", async (SourceVerificationPreference preference, CancellationToken ct) =>
        {
            await preference.InitializeAsync(ct);
            return TypedResults.Ok(new SourceVerificationSetting(preference.Enabled));
        }).WithName("GetSourceVerificationSetting");
        app.MapPut("/api/settings/source-verification", async (SourceVerificationSetting request,
            SourceVerificationPreference preference, CancellationToken ct) =>
        {
            await preference.SetEnabledAsync(request.Enabled, ct);
            return TypedResults.NoContent();
        }).WithName("SetSourceVerificationSetting");

        app.MapPost("/api/folders/{id:long}/index", async Task<Results<Accepted<ScanAccepted>, NoContent, ProblemHttpResult>>
            (long id, Database database, ScanWorker worker, HttpContext context, CancellationToken ct) =>
        {
            await using var db = await database.OpenAsync(ct);
            using var tx = db.BeginTransaction();
            var folder = await db.QuerySingleOrDefaultAsync<FolderIndexRow>(new CommandDefinition("""
                SELECT f.LibraryId,f.DirectIndexedAt,l.MetadataMode FROM Folders f JOIN Libraries l ON l.Id=f.LibraryId
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
                INSERT INTO Scans(LibraryId,FolderId,State,StartedAt,MetadataMode) VALUES(@LibraryId,@id,'queued',@now,@MetadataMode) RETURNING Id
                """, new { folder.LibraryId, folder.MetadataMode, id, now = DateTimeOffset.UtcNow.ToString("O") }, tx, cancellationToken: ct));
            await QueueMetadataAsync(db,tx,scanId,folder.LibraryId,id,folder.MetadataMode,ct);
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
            if(request.MetadataMode is not ("none" or "embedded" or "xmp")) return Problem(400,context);
            await using var db = await database.OpenAsync(ct);
            var scanId = await StartScanAsync(db, id, null, request, ct);
            return scanId is null ? Problem(404, context) : TypedResults.Accepted($"/api/scans/{scanId}", new ScanAccepted(scanId.Value));
        }).WithName("StartScan").Produces<ApiProblem>(400, "application/problem+json")
            .Produces<ApiProblem>(404, "application/problem+json").Produces<ApiProblem>(409, "application/problem+json");

        // Rescan from a folder's menu: the folder and everything beneath it. A library's root
        // folder is the library, so rescanning it is a full library scan.
        app.MapPost("/api/folders/{id:long}/scans", async Task<Results<Accepted<ScanAccepted>, ProblemHttpResult>>
            (long id, StartScanRequest request, Database database, HttpContext context, CancellationToken ct) =>
        {
            if(request.MetadataMode is not ("none" or "embedded" or "xmp")) return Problem(400,context);
            await using var db = await database.OpenAsync(ct);
            var folder = await db.QuerySingleOrDefaultAsync<FolderScanRow>(new CommandDefinition(
                "SELECT LibraryId,ParentId FROM Folders WHERE Id=@id", new { id }, cancellationToken: ct));
            if (folder is null) return Problem(404, context);
            var scanId = await StartScanAsync(db, folder.LibraryId, folder.ParentId is null ? null : id, request, ct);
            return scanId is null ? Problem(404, context) : TypedResults.Accepted($"/api/scans/{scanId}", new ScanAccepted(scanId.Value));
        }).WithName("RescanFolder").Produces<ApiProblem>(400, "application/problem+json")
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
            (long id, Database database, ScanWorker worker, MetadataJobs metadataJobs, HttpContext context, CancellationToken ct) =>
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
            var metadataIds=await db.QueryAsync<long>(new CommandDefinition("SELECT Id FROM MetadataJobs WHERE ScanId=@id AND State IN ('queued','running') AND EXISTS(SELECT 1 FROM Scans WHERE Id=@id AND State='cancelled')",new{id},cancellationToken:ct));
            foreach(var metadataId in metadataIds) await metadataJobs.CancelAsync(metadataId,ct);
            return TypedResults.Accepted($"/api/scans/{id}", new ScanAccepted(id));
        }).WithName("CancelScan").Produces<ApiProblem>(404, "application/problem+json");
    }

    // A library scan (folderId null) or a recursive folder rescan; null when the library is not enabled.
    private static async Task<long?> StartScanAsync(SqliteConnection db, long libraryId, long? folderId, StartScanRequest request, CancellationToken ct)
    {
        try
        {
            using var tx=db.BeginTransaction();
            var scanId = await db.QuerySingleOrDefaultAsync<long?>(new CommandDefinition("""
                INSERT INTO Scans(LibraryId,FolderId,Recursive,State,Force,RetryFailures,StartedAt,MetadataMode)
                SELECT Id,@folderId,@recursive,'queued',@Force,@RetryFailures,@now,@MetadataMode FROM Libraries WHERE Id=@libraryId AND Enabled=1 RETURNING Id
                """, new { libraryId, folderId, recursive = folderId is not null, request.Force, request.RetryFailures, request.MetadataMode, now = DateTimeOffset.UtcNow.ToString("O") },tx, cancellationToken: ct));
            if(scanId is { } accepted) {
                // The library remembers the choice for startup and folder-demand scans.
                await db.ExecuteAsync(new CommandDefinition("UPDATE Libraries SET MetadataMode=@MetadataMode WHERE Id=@libraryId",new{libraryId,request.MetadataMode},tx,cancellationToken:ct));
                await QueueMetadataAsync(db,tx,accepted,libraryId,folderId,request.MetadataMode,ct,recursive:true);
            }
            tx.Commit();
            return scanId;
        }
        catch (SqliteException error) when (error.SqliteErrorCode == 19) { throw new ApiRequestException(409,"conflict","A scan for this library is already running. Cancel it or wait for it to finish."); }
    }

    internal static async Task QueueMetadataAsync(SqliteConnection db,SqliteTransaction tx,long scanId,long libraryId,long? folderId,string mode,CancellationToken ct,bool recursive=false)
    {
        if(mode=="none") return;
        if(await db.ExecuteScalarAsync<int>(new CommandDefinition("SELECT COUNT(*) FROM MetadataJobs WHERE State IN ('queued','running')",transaction:tx,cancellationToken:ct))>=16) throw new ApiRequestException(429,"rate_limited","The metadata job queue is full.");
        var request=new MetadataJobRequest(Query:new MediaQuery{LibraryId=libraryId,FolderId=folderId,Recursive=folderId is null || recursive},IncludeSidecars:mode=="xmp",Automatic:true,ScanId:scanId);
        await db.ExecuteAsync(new CommandDefinition("INSERT INTO MetadataJobs(Kind,State,Request,CreatedAt,ScanId) VALUES('import','queued',@request,@now,@scanId); UPDATE Scans SET MetadataQueued=1 WHERE Id=@scanId",new{scanId,request=JsonSerializer.Serialize(request with {Query=request.Query!.Normalize()}),now=DateTimeOffset.UtcNow.ToString("O")},tx,cancellationToken:ct));
    }

    private static ProblemHttpResult Problem(int status, HttpContext context) =>
        TypedResults.Problem(statusCode: status, extensions: ApiErrors.Extensions(status, context));
    private sealed class JobCount
    {
        public string State { get; set; } = "";
        public long Count { get; set; }
    }
    private sealed class FolderScanRow
    {
        public long LibraryId { get; set; }
        public long? ParentId { get; set; }
    }
    private sealed class FolderIndexRow
    {
        public long LibraryId { get; set; }
        public string MetadataMode { get; set; } = "embedded";
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
    public bool Recursive { get; set; }
    public long Id { get; set; }
    public long LibraryId { get; set; }
    public string State { get; set; } = "";
    public string MetadataMode { get; set; } = "none";
    public bool Force { get; set; }
    public bool RetryFailures { get; set; }
    public long Discovered { get; set; }
    public long Skipped { get; set; }
    public string StartedAt { get; set; } = "";
    public string? FinishedAt { get; set; }
    public string? FailureCode { get; set; }
}
