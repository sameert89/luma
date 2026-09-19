using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Tags;
using Luma.Server.Features.Indexing;
using Luma.Server.Http;
using Microsoft.Data.Sqlite;

namespace Luma.Server.Features.Status;

public sealed record BackgroundTask(string Id,string Kind,string State,string CreatedAt,long Processed,long Failed,long Pending,string? Scope = null);
public static class TaskEndpoints
{
    public static void MapTasks(this IEndpointRouteBuilder app)
    {
        // Every terminal task is finished: completed, cancelled, failed and interrupted alike. A
        // completed scan still preparing previews is shown as running, so it is not finished yet.
        app.MapPost("/api/tasks/clear-finished",async(Database database,CancellationToken ct)=> {
            await using var db=await database.OpenAsync(ct);
            using var tx=db.BeginTransaction();
            await db.ExecuteAsync(new CommandDefinition($"""
                UPDATE MetadataJobs SET QueueDismissed=1 WHERE QueueDismissed=0 AND {MetadataFinished};
                UPDATE Scans SET QueueDismissed=1 WHERE QueueDismissed=0 AND {ScanFinished};
                """,transaction:tx,cancellationToken:ct));
            tx.Commit();
            return TypedResults.NoContent();
        }).WithName("ClearFinishedBackgroundTasks");
        app.MapPost("/api/tasks/{id}/clear",async(string id,Database database,CancellationToken ct)=> {
            var (kind,key)=Parse(id);
            var (table,finished)=kind=="scan"?("Scans",ScanFinished):("MetadataJobs",MetadataFinished);
            await using var db=await database.OpenAsync(ct);
            if(!await db.ExecuteScalarAsync<bool>(new CommandDefinition($"SELECT EXISTS(SELECT 1 FROM {table} WHERE Id=@key)",new{key},cancellationToken:ct))) throw ApiRequestException.Missing();
            if(await db.ExecuteAsync(new CommandDefinition($"UPDATE {table} SET QueueDismissed=1 WHERE Id=@key AND {finished}",new{key},cancellationToken:ct))==0)
                throw new ApiRequestException(409,"conflict","Only finished tasks can be cleared. Cancel it first.");
            return TypedResults.NoContent();
        }).WithName("ClearBackgroundTask");
        app.MapPost("/api/tasks/{id}/cancel",async(string id,MetadataJobs jobs,CancellationToken ct)=> {
            var (kind,key)=Parse(id);
            if(kind=="scan") return Results.Redirect($"/api/scans/{key}/cancel",preserveMethod:true);
            await jobs.CancelAsync(key,ct);
            return Results.Accepted($"/api/jobs/{key}",new JobAccepted(key));
        }).WithName("CancelBackgroundTask");
        // Queue again always creates a new task; the old record stays terminal and leaves the list.
        app.MapPost("/api/tasks/{id}/queue",async(string id,Database database,MetadataJobs jobs,ScanWorker worker,CancellationToken ct)=> {
            var (kind,key)=Parse(id);
            if(kind=="metadata") return Results.Accepted(value:await jobs.QueueAgainAsync(key,ct));
            await using var db=await database.OpenAsync(ct);
            using var tx=db.BeginTransaction();
            var scan=await db.QuerySingleOrDefaultAsync<ScanRow>(new CommandDefinition("SELECT * FROM Scans WHERE Id=@key",new{key},tx,cancellationToken:ct)) ?? throw ApiRequestException.Missing();
            if(scan.State is "queued" or "running") throw new ApiRequestException(409,"conflict","This operation is already active.");
            // A worker still winding down the old scan would otherwise write alongside the new one.
            if(worker.IsActive(key) || await db.ExecuteScalarAsync<bool>(new CommandDefinition("SELECT EXISTS(SELECT 1 FROM ProcessingJobs WHERE ScanId=@key AND State IN ('pending','running'))",new{key},tx,cancellationToken:ct))) throw new ApiRequestException(409,"conflict","This operation is still stopping. Try again in a moment.");
            try {
                var next=await db.ExecuteScalarAsync<long?>(new CommandDefinition("INSERT INTO Scans(LibraryId,FolderId,Recursive,State,Force,RetryFailures,StartedAt,MetadataMode) SELECT @LibraryId,@FolderId,@Recursive,'queued',@Force,@RetryFailures,@now,@MetadataMode FROM Libraries WHERE Id=@LibraryId AND Enabled=1 RETURNING Id",new{scan.LibraryId,scan.FolderId,scan.Recursive,scan.Force,scan.RetryFailures,scan.MetadataMode,now=DateTimeOffset.UtcNow.ToString("O")},tx,cancellationToken:ct)) ?? throw ApiRequestException.Missing();
                await IndexingEndpoints.QueueMetadataAsync(db,tx,next,scan.LibraryId,scan.FolderId,scan.MetadataMode,ct,scan.Recursive);
                await db.ExecuteAsync(new CommandDefinition("UPDATE Scans SET QueueDismissed=1 WHERE Id=@key",new{key},tx,cancellationToken:ct));
                tx.Commit();
                return Results.Accepted($"/api/scans/{next}",new ScanAccepted(next));
            } catch(SqliteException error) when(error.SqliteErrorCode==19) { throw new ApiRequestException(409,"conflict","A scan for this library is already queued."); }
        }).WithName("QueueBackgroundTaskAgain");
        app.MapGet("/api/tasks",async(Database database,CancellationToken ct)=> {
            await using var db=await database.OpenAsync(ct);
            // On-demand preview work re-attaches to a library's latest completed scan, even one already
            // cleared from the queue; such a scan is listed again while that work runs, or it would be invisible.
            // Computed columns report no type when SQLite has no row to infer from (an empty or
            // freshly cleared queue), so rows map by property rather than by constructor.
            return TypedResults.Ok((await db.QueryAsync<TaskRow>(new CommandDefinition("""
                SELECT 'metadata-'||j.Id Id,j.Kind,CASE WHEN j.State='failed' AND j.FailureCode='interrupted' THEN 'interrupted' ELSE j.State END State,j.CreatedAt,j.Processed,j.Failed,0 Pending,
                  COALESCE(NULLIF(f.RelativePath,''),l.Name,(SELECT FileName FROM Media WHERE Id=json_extract(j.Request,'$.MediaIds[0]')),'Filtered library') Scope
                FROM (SELECT * FROM MetadataJobs WHERE QueueDismissed=0 ORDER BY Id DESC LIMIT 50) j
                LEFT JOIN Folders f ON f.Id=json_extract(j.Request,'$.Query.FolderId')
                LEFT JOIN Libraries l ON l.Id=json_extract(j.Request,'$.Query.LibraryId')
                UNION ALL
                SELECT 'scan-'||s.Id,'indexing',CASE WHEN s.State='completed' AND
                  EXISTS(SELECT 1 FROM ProcessingJobs WHERE ScanId=s.Id AND State IN ('pending','running')) THEN 'running' ELSE s.State END,
                  s.StartedAt,s.Discovered,
                  (SELECT COUNT(*) FROM ProcessingJobs WHERE ScanId=s.Id AND State='failed'),
                  CASE WHEN s.State IN ('queued','running','completed') THEN (SELECT COUNT(*) FROM ProcessingJobs WHERE ScanId=s.Id AND State IN ('pending','running')) ELSE 0 END,
                  COALESCE(NULLIF(f.RelativePath,''),l.Name)
                FROM (SELECT * FROM Scans WHERE QueueDismissed=0 OR State='completed' AND
                  EXISTS(SELECT 1 FROM ProcessingJobs WHERE ScanId=Scans.Id AND State IN ('pending','running')) ORDER BY Id DESC LIMIT 50) s
                LEFT JOIN Libraries l ON l.Id=s.LibraryId LEFT JOIN Folders f ON f.Id=s.FolderId
                ORDER BY CreatedAt DESC LIMIT 100
                """,cancellationToken:ct))).Select(x=>new BackgroundTask(x.Id,x.Kind,x.State,x.CreatedAt,x.Processed,x.Failed,x.Pending,x.Scope)).ToArray());
        }).WithName("GetBackgroundTasks");
    }
    private sealed class TaskRow
    {
        public string Id { get; set; } = "";
        public string Kind { get; set; } = "";
        public string State { get; set; } = "";
        public string CreatedAt { get; set; } = "";
        public long Processed { get; set; }
        public long Failed { get; set; }
        public long Pending { get; set; }
        public string? Scope { get; set; }
    }
    private const string MetadataFinished="State IN ('completed','cancelled','failed','expired')";
    private const string ScanFinished="(State IN ('cancelled','failed','interrupted') OR State='completed' AND NOT EXISTS(SELECT 1 FROM ProcessingJobs WHERE ScanId=Scans.Id AND State IN ('pending','running')))";
    private static (string Kind,long Id) Parse(string id)
    {
        var parts=id.Split('-');
        if(parts.Length!=2 || parts[0] is not ("scan" or "metadata") || !long.TryParse(parts[1],out var key) || key<=0) throw ApiRequestException.Invalid();
        return (parts[0],key);
    }
}
