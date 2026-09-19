using Dapper;
using Luma.Server.Data;
using Luma.Server.Http;

namespace Luma.Server.Features.Media;

public sealed record WatchUpdate(double PositionSeconds,double DurationSeconds,double WatchedSeconds);
public sealed record WatchState(long MediaId,double PositionSeconds,double DurationSeconds,double WatchedSeconds,string State,string UpdatedAt);

public static class PlaybackEndpoints
{
    public static void MapPlayback(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/media/{id:long}/progress",async(long id,Database database,CancellationToken ct)=> {
            await using var db=await database.OpenAsync(ct);
            if(!await db.ExecuteScalarAsync<bool>(new CommandDefinition("SELECT EXISTS(SELECT 1 FROM Media WHERE Id=@id AND MediaType='video')",new{id},cancellationToken:ct))) throw ApiRequestException.Missing();
            return TypedResults.Ok(await db.QuerySingleOrDefaultAsync<WatchState>(new CommandDefinition("SELECT * FROM WatchProgress WHERE MediaId=@id",new{id},cancellationToken:ct)) ?? new(id,0,0,0,"unwatched",""));
        }).WithName("GetWatchProgress");
        app.MapPut("/api/media/{id:long}/progress",async(long id,WatchUpdate request,Database database,CancellationToken ct)=> {
            if(!double.IsFinite(request.PositionSeconds) || !double.IsFinite(request.DurationSeconds) || !double.IsFinite(request.WatchedSeconds)
                || request.PositionSeconds<0 || request.DurationSeconds<=0 || request.PositionSeconds>request.DurationSeconds || request.WatchedSeconds is <0 or >30) throw ApiRequestException.Invalid();
            await using var db=await database.OpenAsync(ct);
            using var tx=db.BeginTransaction();
            if(!await db.ExecuteScalarAsync<bool>(new CommandDefinition("SELECT EXISTS(SELECT 1 FROM Media WHERE Id=@id AND MediaType='video')",new{id},tx,cancellationToken:ct))) throw ApiRequestException.Missing();
            var old=await db.QuerySingleOrDefaultAsync<WatchState>(new CommandDefinition("SELECT * FROM WatchProgress WHERE MediaId=@id",new{id},tx,cancellationToken:ct));
            var watched=(old?.WatchedSeconds??0)+request.WatchedSeconds;
            var state=old?.State=="completed" || watched>=Math.Min(30,request.DurationSeconds*0.8) && request.PositionSeconds>=request.DurationSeconds*0.95 ? "completed" : watched>=Math.Min(5,request.DurationSeconds*0.2)?"in_progress":"unwatched";
            var value=new WatchState(id,request.PositionSeconds,request.DurationSeconds,watched,state,DateTimeOffset.UtcNow.ToString("O"));
            await db.ExecuteAsync(new CommandDefinition("INSERT INTO WatchProgress VALUES(@MediaId,@PositionSeconds,@DurationSeconds,@WatchedSeconds,@State,@UpdatedAt) ON CONFLICT(MediaId) DO UPDATE SET PositionSeconds=excluded.PositionSeconds,DurationSeconds=excluded.DurationSeconds,WatchedSeconds=excluded.WatchedSeconds,State=excluded.State,UpdatedAt=excluded.UpdatedAt",value,tx,cancellationToken:ct));
            tx.Commit();
            return TypedResults.Ok(value);
        }).WithName("SetWatchProgress");
    }
}
