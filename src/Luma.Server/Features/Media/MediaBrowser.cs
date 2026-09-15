using System.Text.Json;
using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Indexing;
using Luma.Server.Http;
using Microsoft.Data.Sqlite;

namespace Luma.Server.Features.Media;

public sealed class MediaBrowser(Database database,CursorSigner cursors)
{
    public async Task<MediaPage> ListAsync(MediaQuery query,CancellationToken ct)
    {
        await using var db=await database.OpenAsync(ct);
        using var deadline=CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(2));
        using var interrupt=deadline.Token.Register(()=>SQLitePCL.raw.sqlite3_interrupt(db.Handle));
        try
        {
            using var tx=db.BeginTransaction(deferred:true);
            if(query.FolderId is { } folder)
            {
                var library=await db.QuerySingleOrDefaultAsync<long?>(new CommandDefinition("SELECT LibraryId FROM Folders WHERE Id=@folder",new {folder},tx,cancellationToken:deadline.Token));
                if(library is null) throw ApiRequestException.Missing();
                if(query.LibraryId is { } root && library!=root) throw ApiRequestException.Invalid("The folder belongs to another library.");
            }
            var (predicate,p)=query.Predicate();
            var fingerprint=query.Fingerprint();
            var position=query.Cursor is null ? null : cursors.Decode(query.Cursor,fingerprint);
            var backward=position?.Backward==true;
            var ascending=(query.Order=="asc") != backward;
            if(position is not null)
            {
                predicate+=$" AND (m.ModifiedTicks,m.Id) {(ascending ? ">" : "<")} (@ticks,@id)";
                p.Add("ticks",position.Ticks); p.Add("id",position.Id);
            }
            p.Add("limit",query.Limit!.Value+1);
            var order=ascending ? "ASC" : "DESC";
            var rows=(await db.QueryAsync<MediaRow>(new CommandDefinition($"SELECT m.* FROM Media m WHERE {predicate} ORDER BY m.ModifiedTicks {order},m.Id {order} LIMIT @limit",p,tx,cancellationToken:deadline.Token))).ToList();
            var more=rows.Count>query.Limit;
            if(more) rows.RemoveAt(rows.Count-1);
            if(backward) rows.Reverse();
            var items=await SummariesAsync(db,tx,rows,deadline.Token);
            tx.Commit();
            if(rows.Count==0) return new(items,null,null);
            return new(items,
                (backward ? position is not null : more) ? cursors.Encode(fingerprint,rows[^1].ModifiedTicks,rows[^1].Id,false) : null,
                (backward ? more : position is not null) ? cursors.Encode(fingerprint,rows[0].ModifiedTicks,rows[0].Id,true) : null);
        }
        catch(Exception error) when(deadline.IsCancellationRequested && !ct.IsCancellationRequested && error is SqliteException or OperationCanceledException)
        { throw new ApiRequestException(503,"query_timeout","This search took too long. Try narrowing the filters."); }
    }

    public async Task<MediaSummary> DetailAsync(long id,CancellationToken ct)
    {
        await using var db=await database.OpenAsync(ct);
        using var tx=db.BeginTransaction(deferred:true);
        var row=await db.QuerySingleOrDefaultAsync<MediaRow>(new CommandDefinition("SELECT * FROM Media WHERE Id=@id",new{id},tx,cancellationToken:ct)) ?? throw ApiRequestException.Missing();
        var result=await SummariesAsync(db,tx,[row],ct);
        tx.Commit();
        return result[0];
    }
    public async Task<MediaNeighbors> NeighborsAsync(long id,MediaQuery query,CancellationToken ct)
    {
        await using var db=await database.OpenAsync(ct);
        var row=await db.QuerySingleOrDefaultAsync<MediaRow>(new CommandDefinition("SELECT Id,ModifiedTicks FROM Media WHERE Id=@id",new{id},cancellationToken:ct)) ?? throw ApiRequestException.Missing();
        var previous=await ListAsync(query with {Limit=1,Cursor=cursors.Encode(query.Fingerprint(),row.ModifiedTicks,id,true)},ct);
        var next=await ListAsync(query with {Limit=1,Cursor=cursors.Encode(query.Fingerprint(),row.ModifiedTicks,id,false)},ct);
        return new(previous.Items.FirstOrDefault(),next.Items.FirstOrDefault());
    }
    private static async Task<IReadOnlyList<MediaSummary>> SummariesAsync(SqliteConnection db,SqliteTransaction tx,IReadOnlyList<MediaRow> rows,CancellationToken ct)
    {
        if(rows.Count==0) return [];
        var ids=JsonSerializer.Serialize(rows.Select(x=>x.Id));
        var tags=(await db.QueryAsync<TagRow>(new CommandDefinition("""
            SELECT mt.MediaId,t.Id,t.Name FROM MediaTags mt JOIN Tags t ON t.Id=mt.TagId
            WHERE mt.MediaId IN (SELECT value FROM json_each(@ids)) ORDER BY t.NormalizedKey,t.Id
            """,new{ids},tx,cancellationToken:ct))).ToLookup(x=>x.MediaId);
        var cache=(await db.QueryAsync<CacheRow>(new CommandDefinition("""
            SELECT c.MediaId,c.Variant,c.State,c.Width,c.Height FROM CacheEntries c JOIN Media m ON m.Id=c.MediaId
            WHERE c.MediaId IN (SELECT value FROM json_each(@ids)) AND c.SourceRevision=m.SourceRevision AND c.EncoderVersion=@version
            """,new{ids,version=IndexingOptions.EncoderVersion},tx,cancellationToken:ct))).ToLookup(x=>x.MediaId);
        return rows.Select(row=>
        {
            CacheRepresentation Variant(string variant)
            {
                var entry=cache[row.Id].FirstOrDefault(x=>x.Variant==variant);
                return new($"/api/media/{row.Id}/cache/{row.SourceRevision}/{variant}?v={IndexingOptions.EncoderVersion}",entry?.State??"pending",entry?.Width,entry?.Height);
            }
            return new MediaSummary(row.Id,row.LibraryId,row.FolderId,row.FileName,row.MediaType,row.Extension,row.SizeBytes,row.Width,row.Height,row.DurationMs,
                row.ModifiedAt,row.EffectiveDate,row.CapturedAt,row.Preference,row.Availability,Variant("thumbnail"),Variant(row.MediaType=="image"?"preview":"poster"),
                tags[row.Id].Select(x=>new TagSummary(x.Id,x.Name)).ToArray());
        }).ToArray();
    }
    private sealed class TagRow {public long MediaId{get;set;} public long Id{get;set;} public string Name{get;set;}="";}
    private sealed class CacheRow {public long MediaId{get;set;} public string Variant{get;set;}=""; public string State{get;set;}=""; public int Width{get;set;} public int Height{get;set;}}
}
