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
    public static void MapTasks(this WebApplication app)
    {
        app.MapPost("/api/tasks/clear-finished",async(Database database,CancellationToken ct)=> {
            await using var db=await database.OpenAsync(ct);
            using var tx=db.BeginTransaction();
            await db.ExecuteAsync(new CommandDefinition("""
                UPDATE MetadataJobs SET QueueDismissed=1 WHERE QueueDismissed=0
                  AND State IN ('completed','cancelled','failed','expired');
                UPDATE Scans SET QueueDismissed=1 WHERE QueueDismissed=0
                  AND State IN ('completed','cancelled','failed','interrupted')
                  AND NOT EXISTS(SELECT 1 FROM ProcessingJobs WHERE ScanId=Scans.Id AND State='running')
                  AND (State<>'completed' OR NOT EXISTS(SELECT 1 FROM ProcessingJobs WHERE ScanId=Scans.Id AND State='pending'));
                """,transaction:tx,cancellationToken:ct));
            tx.Commit();
            return TypedResults.NoContent();
        }).WithName("ClearFinishedBackgroundTasks");
        app.MapPost("/api/tasks/{id}/cancel",async(string id,MetadataJobs jobs,CancellationToken ct)=> {
            var (kind,key)=Parse(id);
            if(kind=="scan") return Results.Redirect($"/api/scans/{key}/cancel",preserveMethod:true);
            await jobs.CancelAsync(key,ct);
            return Results.Accepted($"/api/jobs/{key}",new JobAccepted(key));
        }).WithName("CancelBackgroundTask");
        app.MapPost("/api/tasks/{id}/queue",async(string id,Database database,MetadataJobs jobs,CancellationToken ct)=> {
            var (kind,key)=Parse(id);
            if(kind=="metadata") return Results.Accepted(value:await jobs.QueueAgainAsync(key,ct));
            await using var db=await database.OpenAsync(ct);
            using var tx=db.BeginTransaction();
            var scan=await db.QuerySingleOrDefaultAsync<ScanRow>(new CommandDefinition("SELECT * FROM Scans WHERE Id=@key",new{key},tx,cancellationToken:ct)) ?? throw ApiRequestException.Missing();
            if(scan.State is "queued" or "running" || await db.ExecuteScalarAsync<bool>(new CommandDefinition("SELECT EXISTS(SELECT 1 FROM ProcessingJobs WHERE ScanId=@key AND State IN ('pending','running'))",new{key},tx,cancellationToken:ct))) throw new ApiRequestException(409,"conflict","This operation is already active.");
            try {
                var next=await db.ExecuteScalarAsync<long?>(new CommandDefinition("INSERT INTO Scans(LibraryId,FolderId,State,Force,RetryFailures,StartedAt,MetadataMode) SELECT @LibraryId,@FolderId,'queued',@Force,@RetryFailures,@now,@MetadataMode FROM Libraries WHERE Id=@LibraryId AND Enabled=1 RETURNING Id",new{scan.LibraryId,scan.FolderId,scan.Force,scan.RetryFailures,scan.MetadataMode,now=DateTimeOffset.UtcNow.ToString("O")},tx,cancellationToken:ct)) ?? throw ApiRequestException.Missing();
                await IndexingEndpoints.QueueMetadataAsync(db,tx,next,scan.LibraryId,scan.FolderId,scan.MetadataMode,ct);
                tx.Commit();
                return Results.Accepted($"/api/scans/{next}",new ScanAccepted(next));
            } catch(SqliteException error) when(error.SqliteErrorCode==19) { throw new ApiRequestException(409,"conflict","A scan for this library is already queued."); }
        }).WithName("QueueBackgroundTaskAgain");
        app.MapGet("/api/tasks",async(Database database,CancellationToken ct)=> {
            await using var db=await database.OpenAsync(ct);
            return TypedResults.Ok((await db.QueryAsync<BackgroundTask>(new CommandDefinition("""
                SELECT 'metadata-'||j.Id Id,j.Kind,j.State,j.CreatedAt,j.Processed,j.Failed,0 Pending,
                  COALESCE(NULLIF(f.RelativePath,''),l.Name,(SELECT FileName FROM Media WHERE Id=json_extract(j.Request,'$.MediaIds[0]')),'Filtered library') Scope
                FROM (SELECT * FROM MetadataJobs WHERE QueueDismissed=0 ORDER BY Id DESC LIMIT 50) j
                LEFT JOIN Folders f ON f.Id=json_extract(j.Request,'$.Query.FolderId')
                LEFT JOIN Libraries l ON l.Id=json_extract(j.Request,'$.Query.LibraryId')
                UNION ALL
                SELECT 'scan-'||s.Id,'indexing',CASE WHEN s.State='completed' AND
                  EXISTS(SELECT 1 FROM ProcessingJobs WHERE ScanId=s.Id AND State IN ('pending','running')) THEN 'running' ELSE s.State END,
                  s.StartedAt,s.Discovered,
                  (SELECT COUNT(*) FROM ProcessingJobs WHERE ScanId=s.Id AND State='failed'),
                  (SELECT COUNT(*) FROM ProcessingJobs WHERE ScanId=s.Id AND State IN ('pending','running')),
                  COALESCE(NULLIF(f.RelativePath,''),l.Name)
                FROM (SELECT * FROM Scans WHERE QueueDismissed=0 ORDER BY Id DESC LIMIT 50) s
                LEFT JOIN Libraries l ON l.Id=s.LibraryId LEFT JOIN Folders f ON f.Id=s.FolderId
                ORDER BY CreatedAt DESC LIMIT 100
                """,cancellationToken:ct))).ToArray());
        }).WithName("GetBackgroundTasks");
    }
    private static (string Kind,long Id) Parse(string id)
    {
        var parts=id.Split('-');
        if(parts.Length!=2 || parts[0] is not ("scan" or "metadata") || !long.TryParse(parts[1],out var key) || key<=0) throw ApiRequestException.Invalid();
        return (parts[0],key);
    }
}
