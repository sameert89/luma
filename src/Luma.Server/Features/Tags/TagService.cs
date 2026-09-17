using System.Globalization;
using System.Text;
using System.Text.Json;
using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Media;
using Luma.Server.Http;

namespace Luma.Server.Features.Tags;

public static class TagText
{
    public static (string Name,string Key) Normalize(string input)
    {
        if(input is null) throw ApiRequestException.Invalid("A tag name is required.");
        var name=input.Trim().Normalize(NormalizationForm.FormC);
        if(name.Length==0 || name.EnumerateRunes().Count()>100 || name.EnumerateRunes().Any(x=>Rune.GetUnicodeCategory(x)==UnicodeCategory.Control))
            throw ApiRequestException.Invalid("Tags must contain 1–100 characters and no control characters.");
        return (name,SearchText.Key(name));
    }
}
public sealed record CollectionTagPage(IReadOnlyList<TagSummary> Items,string? NextCursor,string? PreviousCursor);
public sealed record CreateTagRequest(string Name);
public sealed record BulkTagsRequest(long[] MediaIds,long[] AddTagIds,long[] RemoveTagIds);
public sealed record PreferenceRequest(string Preference);
public sealed class TagService(Database database)
{
    public async Task<CollectionTagPage> PageAsync(string? cursor,CursorSigner signer,CancellationToken ct)
    {
        const string scope="collection-tags";
        var position=cursor is null?null:signer.Decode(cursor,scope);
        var backward=position?.Backward==true;
        await using var db=await database.OpenAsync(ct);
        var seek=position is null?"":$"WHERE Id {(backward?"<":">")} @id";
        var rows=(await db.QueryAsync<TagSummary>(new CommandDefinition($"SELECT Id,Name FROM Tags {seek} ORDER BY Id {(backward?"DESC":"ASC")} LIMIT 51",new{id=position?.Id},cancellationToken:ct))).ToList();
        var more=rows.Count>50;
        if(more) rows.RemoveAt(50);
        if(backward) rows.Reverse();
        return new(rows,rows.Count>0 && (backward?position is not null:more)?signer.Encode(scope,0,rows[^1].Id,false):null,
            rows.Count>0 && (backward?more:position is not null)?signer.Encode(scope,0,rows[0].Id,true):null);
    }
    public async Task<(TagSummary Tag,bool Created)> CreateAsync(string name,CancellationToken ct)
    {
        var normalized=TagText.Normalize(name);
        await using var db=await database.OpenAsync(ct);
        using var tx=db.BeginTransaction();
        var created=await db.ExecuteAsync(new CommandDefinition("INSERT INTO Tags(Name,NormalizedKey) VALUES(@Name,@Key) ON CONFLICT(NormalizedKey) DO NOTHING",new{normalized.Name,normalized.Key},tx,cancellationToken:ct))==1;
        var tag=await db.QuerySingleAsync<TagSummary>(new CommandDefinition("SELECT Id,Name FROM Tags WHERE NormalizedKey=@Key",new{normalized.Key},tx,cancellationToken:ct));
        tx.Commit();return (tag,created);
    }
    public async Task<IReadOnlyList<TagSummary>> FindAsync(string? prefix,int? limit,CancellationToken ct)
    {
        if(limit is <1 or >50 || prefix?.Length>400) throw ApiRequestException.Invalid();
        var key=string.IsNullOrWhiteSpace(prefix)?"":SearchText.Key(prefix.Trim());
        await using var db=await database.OpenAsync(ct);
        return (await db.QueryAsync<TagSummary>(new CommandDefinition("SELECT Id,Name FROM Tags WHERE NormalizedKey>=@key AND NormalizedKey<@end AND instr(NormalizedKey,@key)=1 ORDER BY NormalizedKey,Id LIMIT @limit",
            new{key,end=key+"\U0010FFFF",limit=limit??20},cancellationToken:ct))).ToArray();
    }
    public async Task BulkAsync(BulkTagsRequest request,CancellationToken ct)
    {
        if(request.MediaIds is null || request.AddTagIds is null || request.RemoveTagIds is null) throw ApiRequestException.Invalid();
        var media=request.MediaIds.Distinct().ToArray();var add=request.AddTagIds.Distinct().ToArray();var remove=request.RemoveTagIds.Distinct().ToArray();
        if(media.Length is <1 or >500 || add.Length>50 || remove.Length>50 || media.Concat(add).Concat(remove).Any(x=>x<=0) || add.Intersect(remove).Any()) throw ApiRequestException.Invalid("Select up to 500 items and 50 tags per operation; add/remove lists must not overlap.");
        await using var db=await database.OpenAsync(ct);using var tx=db.BeginTransaction();
        var p=new{media=JsonSerializer.Serialize(media),add=JsonSerializer.Serialize(add),remove=JsonSerializer.Serialize(remove),tags=JsonSerializer.Serialize(add.Concat(remove))};
        var missing=await db.ExecuteScalarAsync<bool>(new CommandDefinition("""
            SELECT EXISTS(SELECT value FROM json_each(@media) WHERE value NOT IN (SELECT Id FROM Media))
                OR EXISTS(SELECT value FROM json_each(@tags) WHERE value NOT IN (SELECT Id FROM Tags))
            """,p,tx,cancellationToken:ct));
        if(missing) throw ApiRequestException.Missing();
        await db.ExecuteAsync(new CommandDefinition("""
            DELETE FROM MediaTags WHERE MediaId IN (SELECT value FROM json_each(@media)) AND TagId IN (SELECT value FROM json_each(@remove));
            INSERT INTO MediaTags(MediaId,TagId) SELECT m.value,t.value FROM json_each(@media) m CROSS JOIN json_each(@add) t WHERE true ON CONFLICT DO NOTHING;
            """,p,tx,cancellationToken:ct));
        var over=await db.ExecuteScalarAsync<bool>(new CommandDefinition("SELECT EXISTS(SELECT MediaId FROM MediaTags WHERE MediaId IN (SELECT value FROM json_each(@media)) GROUP BY MediaId HAVING COUNT(*)>100)",p,tx,cancellationToken:ct));
        if(over) throw ApiRequestException.Invalid("An item may have at most 100 tags.");
        tx.Commit();
    }
    public async Task PreferenceAsync(long id,string preference,CancellationToken ct)
    {
        if(preference is not ("neutral" or "liked" or "disliked")) throw ApiRequestException.Invalid("Unknown preference.");
        await using var db=await database.OpenAsync(ct);
        if(await db.ExecuteAsync(new CommandDefinition("UPDATE Media SET Preference=@preference WHERE Id=@id",new{id,preference},cancellationToken:ct))==0) throw ApiRequestException.Missing();
    }
}
