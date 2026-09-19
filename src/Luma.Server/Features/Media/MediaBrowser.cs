using System.Text.Json;
using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Indexing;
using Luma.Server.Http;
using Microsoft.Data.Sqlite;

namespace Luma.Server.Features.Media;

public sealed class MediaBrowser(Database database,CursorSigner cursors)
{
    public async Task PrioritizeAsync(MediaPriorityRequest request,CancellationToken ct)
    {
        if(request.Ids is null) throw ApiRequestException.Invalid("Visible media priority accepts 1 to 200 positive media IDs.");
        var ids=request.Ids.Where(x=>x>0).Distinct().Take(200).ToArray();
        if(request.Ids.Count>200 || ids.Length!=request.Ids.Count) throw ApiRequestException.Invalid("Visible media priority accepts 1 to 200 positive media IDs.");
        if(ids.Length==0) throw ApiRequestException.Invalid("Visible media priority accepts 1 to 200 positive media IDs.");
        await using var db=await database.OpenAsync(ct);
        await PrioritizeAsync(db,ids,request.Previews,ct);
    }

    // Previews: also prepare the large image preview, which indexing leaves until someone opens the image.
    // Regenerate: the recorded preview failed to serve, so replace it even though its row says ready.
    internal static async Task PrioritizeAsync(SqliteConnection db,IReadOnlyList<long> ids,bool previews,CancellationToken ct,bool regenerate=false)
    {
        // The queue orders by NextAttemptAt: stamping each request position separately makes
        // preparation follow the order the caller listed, instead of falling back to media ID.
        // Newer visible requests precede older requests, so opening a viewer can jump ahead of gallery work.
        var head=DateTimeOffset.FromUnixTimeMilliseconds(-DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        var json=JsonSerializer.Serialize(ids.Select((id,position)=>new{id,at=head.AddTicks(position).ToString("O")}));
        using var tx=db.BeginTransaction();
        // Media discovered by a cancelled or interrupted scan has no runnable owner, so it would
        // stay unprepared until that folder is revisited. Adopt it into a scan that can run it.
        await db.ExecuteAsync(new CommandDefinition("""
            UPDATE ProcessingJobs SET ScanId=(SELECT MAX(s.Id) FROM Scans s JOIN Media m ON m.Id=ProcessingJobs.MediaId
              WHERE s.LibraryId=m.LibraryId AND s.State IN ('running','completed'))
            WHERE MediaId IN (SELECT json_extract(value,'$.id') FROM json_each(@json))
              AND EncoderVersion=@version
              AND (State IN ('pending','waiting') OR (@previews AND State='ready' AND MediaType='image'))
              AND NOT EXISTS (SELECT 1 FROM Scans s WHERE s.Id=ProcessingJobs.ScanId AND s.State IN ('running','completed'))
              AND EXISTS (SELECT 1 FROM Scans s JOIN Media m ON m.Id=ProcessingJobs.MediaId
                WHERE s.LibraryId=m.LibraryId AND s.State IN ('running','completed'));
            """,new{json,previews,version=IndexingOptions.EncoderVersion},tx,cancellationToken:ct));
        await db.ExecuteAsync(new CommandDefinition("""
            UPDATE ProcessingJobs SET State='pending',FailureCode=NULL,Claim=NULL,LeaseUntil=NULL,
              NextAttemptAt=(SELECT json_extract(value,'$.at') FROM json_each(@json)
                WHERE json_extract(value,'$.id')=ProcessingJobs.MediaId)
            WHERE MediaId IN (SELECT json_extract(value,'$.id') FROM json_each(@json))
              AND EncoderVersion=@version
              AND State IN ('pending','waiting')
              AND EXISTS (SELECT 1 FROM Media m JOIN Libraries l ON l.Id=m.LibraryId JOIN Scans s ON s.Id=ProcessingJobs.ScanId
                WHERE m.Id=ProcessingJobs.MediaId AND m.SourceRevision=ProcessingJobs.SourceRevision
                  AND m.Availability='present' AND l.Enabled=1 AND s.State IN ('running','completed'));
            """,new{json,version=IndexingOptions.EncoderVersion},tx,cancellationToken:ct));
        // A running job keeps its claim; it returns to pending on publish because WantPreview is set.
        if(previews) await db.ExecuteAsync(new CommandDefinition("""
            UPDATE ProcessingJobs SET WantPreview=1,
              State=CASE WHEN State='running' THEN 'running' ELSE 'pending' END,
              Attempts=CASE WHEN State='ready' THEN 0 ELSE Attempts END,
              NextAttemptAt=(SELECT json_extract(value,'$.at') FROM json_each(@json)
                WHERE json_extract(value,'$.id')=ProcessingJobs.MediaId)
            WHERE MediaId IN (SELECT json_extract(value,'$.id') FROM json_each(@json))
              AND EncoderVersion=@version AND MediaType='image'
              AND State IN ('pending','ready','running')
              AND (@regenerate OR NOT EXISTS (SELECT 1 FROM CacheEntries c WHERE c.MediaId=ProcessingJobs.MediaId AND c.SourceRevision=ProcessingJobs.SourceRevision
                AND c.EncoderVersion=ProcessingJobs.EncoderVersion AND c.Variant='preview' AND c.State='ready'))
              AND EXISTS (SELECT 1 FROM Media m JOIN Libraries l ON l.Id=m.LibraryId JOIN Scans s ON s.Id=ProcessingJobs.ScanId
                WHERE m.Id=ProcessingJobs.MediaId AND m.SourceRevision=ProcessingJobs.SourceRevision
                  AND m.Availability='present' AND l.Enabled=1 AND s.State IN ('running','completed'));
            """,new{json,regenerate,version=IndexingOptions.EncoderVersion},tx,cancellationToken:ct));
        tx.Commit();
    }

    public async Task<MediaPage> ListAsync(MediaQuery query,CancellationToken ct)
    {
        if(query.GroupBy=="tag") throw ApiRequestException.Invalid("Browse tag collections using /api/collections/tag-groups, then select a tag.");
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
            var ordering=new MediaOrdering(query);
            if(position is not null) predicate+=" AND "+ordering.Seek(position,p,backward);
            p.Add("limit",query.Limit!.Value+1);
            List<MediaRow> rows;
            if(query.Sort == "shuffle")
            {
                rows=[];
                var grouped=query.GroupBy!="none";
                var tuple=position?.Tuple;
                var segmentIndex=grouped?1:0;
                long? group=grouped && tuple is not null ? long.Parse(tuple[0],System.Globalization.CultureInfo.InvariantCulture) : null;
                var segment=tuple is not null ? int.Parse(tuple[segmentIndex],System.Globalization.CultureInfo.InvariantCulture) : backward?1:0;
                var direction=backward?"DESC":"ASC";
                var firstGroup=true;
                while(rows.Count<query.Limit.Value+1)
                {
                    if(grouped && (!firstGroup || group is null)) {
                        var (groupPredicate,groupParameters)=query.Predicate();
                        if(group is not null) {
                            groupPredicate += $" AND {ordering.GroupExpression} {(backward?"<":">")} @group";
                            groupParameters.Add("group",group);
                        }
                        group=await db.QuerySingleOrDefaultAsync<long?>(new CommandDefinition($"SELECT {ordering.GroupExpression} FROM Media m WHERE {groupPredicate} ORDER BY {ordering.GroupExpression} {direction} LIMIT 1",groupParameters,tx,cancellationToken:deadline.Token));
                        if(group is null) break;
                        segment=backward?1:0;
                    }
                    for(var part=segment;part>=0 && part<=1 && rows.Count<query.Limit.Value+1;part+=backward?-1:1)
                    {
                        var (basePredicate,parameters)=query.Predicate();
                        parameters.Add("pivot",ordering.Pivot);
                        parameters.Add("limit",query.Limit.Value+1-rows.Count);
                        basePredicate += part==0 ? " AND m.RandomKey>=@pivot" : " AND m.RandomKey<@pivot";
                        if(grouped) {basePredicate+=$" AND {ordering.GroupExpression}=@group";parameters.Add("group",group);}
                        if(position is not null && firstGroup && part==segment) {
                            parameters.Add("key",long.Parse(tuple![segmentIndex+1],System.Globalization.CultureInfo.InvariantCulture));
                            parameters.Add("id",position.Id);
                            basePredicate += $" AND (m.RandomKey,m.Id) {(backward?"<":">")} (@key,@id)";
                        }
                        rows.AddRange(await db.QueryAsync<MediaRow>(new CommandDefinition($"SELECT m.* FROM Media m WHERE {basePredicate} ORDER BY m.RandomKey {direction},m.Id {direction} LIMIT @limit",parameters,tx,cancellationToken:deadline.Token)));
                    }
                    if(!grouped) break;
                    firstGroup=false;
                }
            }
            else if(query.GroupBy!="none")
            {
                rows=[];
                long? group=position?.Tuple is { } tuple?long.Parse(tuple[0],System.Globalization.CultureInfo.InvariantCulture):null;
                var firstGroup=true;
                while(rows.Count<query.Limit.Value+1) {
                    if(!firstGroup || group is null) {
                        var (groupPredicate,groupParameters)=query.Predicate();
                        if(group is not null) {groupPredicate+=$" AND {ordering.GroupExpression} {(backward?"<":">")} @group";groupParameters.Add("group",group);}
                        group=await db.QuerySingleOrDefaultAsync<long?>(new CommandDefinition($"SELECT {ordering.GroupExpression} FROM Media m WHERE {groupPredicate} ORDER BY {ordering.GroupExpression} {(backward?"DESC":"ASC")} LIMIT 1",groupParameters,tx,cancellationToken:deadline.Token));
                        if(group is null) break;
                    }
                    var (withinPredicate,parameters)=query.Predicate();
                    withinPredicate+=$" AND {ordering.GroupExpression}=@group";
                    parameters.Add("group",group);
                    parameters.Add("limit",query.Limit.Value+1-rows.Count);
                    if(query.Sort=="type") {
                        rows.AddRange(await TypeRowsAsync(db,tx,query,withinPredicate,parameters,firstGroup?position:null,backward,query.Limit.Value+1-rows.Count,deadline.Token));
                        firstGroup=false;
                        continue;
                    }
                    var ascending=(query.Order=="asc")!=backward;
                    if(position is not null && firstGroup) {
                        object key=query.Sort is "name" or "type"?position.Tuple![1]:long.Parse(position.Tuple![1],System.Globalization.CultureInfo.InvariantCulture);
                        parameters.Add("key",key);parameters.Add("id",position.Id);
                        withinPredicate+=$" AND ({ordering.KeyExpression},m.Id) {(ascending?">":"<")} (@key,@id)";
                    }
                    var direction=ascending?"ASC":"DESC";
                    rows.AddRange(await db.QueryAsync<MediaRow>(new CommandDefinition($"SELECT m.* FROM Media m WHERE {withinPredicate} ORDER BY {ordering.KeyExpression} {direction},m.Id {direction} LIMIT @limit",parameters,tx,cancellationToken:deadline.Token)));
                    firstGroup=false;
                }
            }
            else if(query.Sort=="type") {
                var (typePredicate,parameters)=query.Predicate();
                rows=await TypeRowsAsync(db,tx,query,typePredicate,parameters,position,backward,query.Limit.Value+1,deadline.Token);
            }
            else rows=(await db.QueryAsync<MediaRow>(new CommandDefinition($"SELECT m.* FROM Media m WHERE {predicate} ORDER BY {ordering.Order(backward)} LIMIT @limit",p,tx,cancellationToken:deadline.Token))).ToList();
            var more=rows.Count>query.Limit;
            if(more) rows.RemoveAt(rows.Count-1);
            if(backward) rows.Reverse();
            var folderLabels=query.GroupBy=="folder" ? (await db.QueryAsync<GroupFolder>(new CommandDefinition("SELECT f.Id,CASE WHEN f.RelativePath='' THEN l.Name ELSE l.Name||' / '||f.RelativePath END Name FROM Folders f JOIN Libraries l ON l.Id=f.LibraryId WHERE f.Id IN (SELECT value FROM json_each(@ids))",new{ids=JsonSerializer.Serialize(rows.Select(x=>x.FolderId).Distinct())},tx,cancellationToken:deadline.Token))).ToDictionary(x=>x.Id,x=>x.Name) : [];
            var items=(await SummariesAsync(db,tx,rows,deadline.Token)).Select((item,i)=>item with {
                GroupKey=ordering.GroupKey(rows[i]),GroupLabel=query.GroupBy switch {"folder"=>folderLabels.GetValueOrDefault(item.FolderId),"type"=>item.MediaType=="image"?"Photos":"Videos","date"=>ordering.GroupKey(rows[i]),_=>null} }).ToArray();
            tx.Commit();
            if(rows.Count==0) return new(items,null,null,query.Seed);
            return new(items,
                (backward ? position is not null : more) ? cursors.Encode(fingerprint,ordering.Tuple(rows[^1]),rows[^1].Id,false) : null,
                (backward ? more : position is not null) ? cursors.Encode(fingerprint,ordering.Tuple(rows[0]),rows[0].Id,true) : null,query.Seed);
        }
        catch(Exception error) when(deadline.IsCancellationRequested && !ct.IsCancellationRequested && error is SqliteException or OperationCanceledException)
        { throw new ApiRequestException(503,"query_timeout","This search took too long. Try narrowing the filters."); }
    }

    // Seek IDs within each of the two types. SQLite's text tuple range otherwise
    // revisits preceding tied type keys on deep pages instead of seeking the ID.
    private static async Task<List<MediaRow>> TypeRowsAsync(SqliteConnection db,SqliteTransaction tx,MediaQuery query,
        string predicate,DynamicParameters parameters,CursorPosition? position,bool backward,int limit,CancellationToken ct)
    {
        var ascending=(query.Order=="asc")!=backward;
        string[] types=ascending?["image","video"]:["video","image"];
        var current=position?.Tuple?[query.GroupBy=="none"?0:1];
        var start=current is null?0:Array.IndexOf(types,current);
        if(start<0) throw new ApiRequestException(400,"invalid_cursor","Refresh the results.");
        var rows=new List<MediaRow>();
        for(var i=start;i<types.Length && rows.Count<limit;i++) {
            parameters.Add("typeOrder",types[i]);
            parameters.Add("limit",limit-rows.Count);
            var within=predicate+" AND m.MediaType=@typeOrder";
            if(position is not null && i==start) {
                parameters.Add("typeId",position.Id);
                within+=$" AND m.Id {(ascending?">":"<")} @typeId";
            }
            rows.AddRange(await db.QueryAsync<MediaRow>(new CommandDefinition($"SELECT m.* FROM Media m WHERE {within} ORDER BY m.Id {(ascending?"ASC":"DESC")} LIMIT @limit",parameters,tx,cancellationToken:ct)));
        }
        return rows;
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
        var row=await db.QuerySingleOrDefaultAsync<MediaRow>(new CommandDefinition("SELECT * FROM Media WHERE Id=@id",new{id},cancellationToken:ct)) ?? throw ApiRequestException.Missing();
        var ordering=new MediaOrdering(query);
        var previous=await ListAsync(query with {Limit=1,Cursor=cursors.Encode(query.Fingerprint(),ordering.Tuple(row),id,true)},ct);
        var next=await ListAsync(query with {Limit=1,Cursor=cursors.Encode(query.Fingerprint(),ordering.Tuple(row),id,false)},ct);
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
        var progress=(await db.QueryAsync<WatchState>(new CommandDefinition("SELECT * FROM WatchProgress WHERE MediaId IN (SELECT value FROM json_each(@ids))",new{ids},tx,cancellationToken:ct))).ToDictionary(x=>x.MediaId);
        return rows.Select(row=>
        {
            CacheRepresentation Variant(string variant)
            {
                var entry=cache[row.Id].FirstOrDefault(x=>x.Variant==variant);
                return new($"/api/media/{row.Id}/cache/{row.SourceRevision}/{variant}?v={IndexingOptions.EncoderVersion}",entry?.State ?? (row.ProcessingStatus == "failed" ? "failed" : "pending"),entry?.Width,entry?.Height);
            }
            return new MediaSummary(row.Id,row.LibraryId,row.FolderId,row.FileName,row.MediaType,row.Extension,row.SizeBytes,row.Width,row.Height,row.DurationMs,
                row.ModifiedAt,row.EffectiveDate,row.CapturedAt,row.Preference,row.Availability,Variant("thumbnail"),Variant(row.MediaType=="image"?"preview":"poster"),
                tags[row.Id].Select(x=>new TagSummary(x.Id,x.Name)).ToArray(),WatchProgress:progress.GetValueOrDefault(row.Id));
        }).ToArray();
    }
    private sealed record GroupFolder(long Id,string Name);
    private sealed class TagRow {public long MediaId{get;set;} public long Id{get;set;} public string Name{get;set;}="";}
    private sealed class CacheRow {public long MediaId{get;set;} public string Variant{get;set;}=""; public string State{get;set;}=""; public int Width{get;set;} public int Height{get;set;}}
}
