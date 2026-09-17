using System.Security.Cryptography;
using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Indexing;
using Luma.Server.Http;

namespace Luma.Server.Features.Media;

public sealed class RandomImage(Database database,CacheContent cache)
{
    public async Task<IResult> ServeAsync(MediaQuery query,HttpContext context,CancellationToken ct)
    {
        context.Response.Headers.CacheControl="no-store";
        if(query.MediaType == "video" || query.Cursor is not null) throw ApiRequestException.Invalid("Random content requires images and does not accept page cursors.");
        query=query with {MediaType="image"};
        var (predicate,p)=query.Predicate();
        p.Add("pivot",BitConverter.ToInt64(RandomNumberGenerator.GetBytes(8)) & long.MaxValue);
        p.Add("encoder",IndexingOptions.EncoderVersion);
        await using var db=await database.OpenAsync(ct);
        using var deadline=CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(2));
        using var interrupt=deadline.Token.Register(()=>SQLitePCL.raw.sqlite3_interrupt(db.Handle));
        try {
            if(query.FolderId is { } folder) {
                var library=await db.QuerySingleOrDefaultAsync<long?>(new CommandDefinition("SELECT LibraryId FROM Folders WHERE Id=@folder",new{folder},cancellationToken:deadline.Token));
                if(library is null) throw ApiRequestException.Missing();
                if(query.LibraryId is { } root && root!=library) throw ApiRequestException.Invalid();
            }
            var ready=" AND EXISTS(SELECT 1 FROM CacheEntries c WHERE c.MediaId=m.Id AND c.SourceRevision=m.SourceRevision AND c.EncoderVersion=@encoder AND c.Variant='preview' AND c.State='ready')";
            var row=await db.QuerySingleOrDefaultAsync<MediaRow>(new CommandDefinition($"SELECT m.Id,m.SourceRevision FROM Media m WHERE {predicate} {ready} AND m.RandomKey>=@pivot ORDER BY m.RandomKey,m.Id LIMIT 1",p,cancellationToken:deadline.Token))
                ?? await db.QuerySingleOrDefaultAsync<MediaRow>(new CommandDefinition($"SELECT m.Id,m.SourceRevision FROM Media m WHERE {predicate} {ready} AND m.RandomKey<@pivot ORDER BY m.RandomKey,m.Id LIMIT 1",p,cancellationToken:deadline.Token));
            if(row is null) {
                var exists=await db.ExecuteScalarAsync<bool>(new CommandDefinition($"SELECT EXISTS(SELECT 1 FROM Media m WHERE {predicate})",p,cancellationToken:deadline.Token));
                if(!exists) throw ApiRequestException.Missing();
                throw new ApiRequestException(503,"cache_unavailable","No matching cached preview is ready.");
            }
            return await cache.ServeAsync(row.Id,row.SourceRevision,"preview",IndexingOptions.EncoderVersion,context,ct,true);
        } catch(Exception error) when(deadline.IsCancellationRequested && !ct.IsCancellationRequested && error is Microsoft.Data.Sqlite.SqliteException or OperationCanceledException) {
            throw new ApiRequestException(503,"query_timeout","Try narrowing the filters.");
        }
    }
}
