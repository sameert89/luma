using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Media;
using Luma.Server.Http;
using Luma.Server.Features.Indexing;

namespace Luma.Server.Features.Libraries;

public sealed record CoverRequest(long? MediaId);
public sealed record LibrarySummary(long Id,string Name,string Availability,long? RootFolderId,string? CoverUrl);
public sealed record FolderSummary(long Id,long LibraryId,long? ParentId,string Name,string? CoverUrl);
public sealed record FolderPage(FolderSummary Current,IReadOnlyList<FolderSummary> Ancestors,IReadOnlyList<FolderSummary> Items,string? NextCursor,string? PreviousCursor);
public sealed class LibraryBrowser(Database database,CursorSigner cursors)
{
    public async Task<IReadOnlyList<LibrarySummary>> LibrariesAsync(CancellationToken ct)
    {
        await using var db=await database.OpenAsync(ct);
        var rows=await db.QueryAsync<LibraryRow>(new CommandDefinition("""
            SELECT l.Id,l.Name,l.Availability,(SELECT Id FROM Folders WHERE LibraryId=l.Id AND PathKey='') RootFolderId,
            COALESCE((SELECT '/api/media/' || m.Id || '/cache/' || m.SourceRevision || '/thumbnail?v=' || c.EncoderVersion
             FROM Folders root JOIN Media m ON m.Id=root.CoverMediaId JOIN CacheEntries c ON c.MediaId=m.Id AND c.SourceRevision=m.SourceRevision
             WHERE root.LibraryId=l.Id AND root.PathKey='' AND m.LibraryId=l.Id AND m.Availability='present' AND c.Variant='thumbnail' AND c.State='ready' AND c.EncoderVersion=@encoder),
            (SELECT '/api/media/' || m.Id || '/cache/' || m.SourceRevision || '/thumbnail?v=' || c.EncoderVersion
             FROM Media m CROSS JOIN CacheEntries c ON c.MediaId=m.Id AND c.SourceRevision=m.SourceRevision
             WHERE m.LibraryId=l.Id AND m.Availability='present' AND m.ProcessingStatus='ready' AND c.Variant='thumbnail' AND c.State='ready' AND c.EncoderVersion=@encoder
             ORDER BY m.ModifiedTicks DESC,m.Id DESC LIMIT 1)) CoverUrl FROM Libraries l WHERE Enabled=1 ORDER BY l.Id
            """,new { encoder=IndexingOptions.EncoderVersion },cancellationToken:ct));
        return rows.Select(x=>new LibrarySummary(x.Id,x.Name,x.Availability,x.RootFolderId,x.CoverUrl)).ToArray();
    }
    public async Task<FolderPage> FoldersAsync(long? libraryId,long? parentId,int? limit,string? cursor,CancellationToken ct)
    {
        if(limit is <1 or >200 || libraryId<=0 || parentId<=0 || (libraryId is null && parentId is null)) throw ApiRequestException.Invalid();
        await using var db=await database.OpenAsync(ct);
        var current=await db.QuerySingleOrDefaultAsync<FolderRow>(new CommandDefinition("""
            SELECT f.*,l.Name LibraryName FROM Folders f JOIN Libraries l ON l.Id=f.LibraryId
            WHERE (@parentId IS NOT NULL AND f.Id=@parentId) OR (@parentId IS NULL AND f.LibraryId=@libraryId AND f.PathKey='')
            """,new{parentId,libraryId},cancellationToken:ct)) ?? throw ApiRequestException.Missing();
        if(libraryId is not null && current.LibraryId!=libraryId) throw ApiRequestException.Invalid();
        var scope=$"folders:{current.Id}";
        var position=cursor is null?null:cursors.Decode(cursor,scope);
        var backwards=position?.Backward==true;
        var order=backwards?"DESC":"ASC";
        var seek=position is null?"":$"AND f.Id {(backwards?"<":">")} @after";
        var rows=(await db.QueryAsync<FolderRow>(new CommandDefinition($"""
            SELECT f.*,
            COALESCE((SELECT '/api/media/' || m.Id || '/cache/' || m.SourceRevision || '/thumbnail?v=' || c.EncoderVersion
             FROM Media m JOIN CacheEntries c ON c.MediaId=m.Id AND c.SourceRevision=m.SourceRevision
             WHERE m.Id=f.CoverMediaId AND m.LibraryId=f.LibraryId AND m.Availability='present' AND c.Variant='thumbnail' AND c.State='ready' AND c.EncoderVersion=@encoder
               AND EXISTS(SELECT 1 FROM FolderAncestry WHERE AncestorId=f.Id AND DescendantId=m.FolderId)),
            (SELECT '/api/media/' || m.Id || '/cache/' || m.SourceRevision || '/thumbnail?v=' || c.EncoderVersion
             FROM FolderAncestry a CROSS JOIN Media m ON m.FolderId=a.DescendantId AND m.LibraryId=f.LibraryId
             CROSS JOIN CacheEntries c ON c.MediaId=m.Id AND c.SourceRevision=m.SourceRevision
             WHERE a.AncestorId=f.Id AND m.Availability='present' AND m.ProcessingStatus='ready' AND c.Variant='thumbnail' AND c.State='ready' AND c.EncoderVersion=@encoder ORDER BY m.ModifiedTicks DESC,m.Id DESC LIMIT 1)) CoverUrl
            FROM Folders f WHERE ParentId=@id {seek} ORDER BY Id {order} LIMIT @limit
            """,new{id=current.Id,after=position?.Id,limit=(limit??100)+1,encoder=IndexingOptions.EncoderVersion},cancellationToken:ct))).ToList();
        var more=rows.Count>(limit??100);if(more)rows.RemoveAt(rows.Count-1);if(backwards)rows.Reverse();
        var ancestors=await db.QueryAsync<FolderRow>(new CommandDefinition("""
            SELECT f.*,l.Name LibraryName FROM FolderAncestry a JOIN Folders f ON f.Id=a.AncestorId JOIN Libraries l ON l.Id=f.LibraryId
            WHERE a.DescendantId=@id AND a.AncestorId<>@id ORDER BY f.Id
            """,new{id=current.Id},cancellationToken:ct));
        return new(ToSummary(current),ancestors.Select(ToSummary).ToArray(),rows.Select(ToSummary).ToArray(),
            rows.Count>0 && (backwards?position is not null:more)?cursors.Encode(scope,0,rows[^1].Id,false):null,
            rows.Count>0 && (backwards?more:position is not null)?cursors.Encode(scope,0,rows[0].Id,true):null);
    }
    public async Task SetCoverAsync(long folder,long? mediaId,CancellationToken ct)
    {
        if(mediaId<=0) throw ApiRequestException.Invalid();
        await using var db=await database.OpenAsync(ct);
        using var tx=db.BeginTransaction();
        var library=await db.QuerySingleOrDefaultAsync<long?>(new CommandDefinition("SELECT LibraryId FROM Folders WHERE Id=@folder",new{folder},tx,cancellationToken:ct)) ?? throw ApiRequestException.Missing();
        if(mediaId is not null && !await db.ExecuteScalarAsync<bool>(new CommandDefinition("SELECT EXISTS(SELECT 1 FROM Media m JOIN FolderAncestry a ON a.DescendantId=m.FolderId WHERE m.Id=@mediaId AND m.LibraryId=@library AND a.AncestorId=@folder AND m.Availability='present')",new{folder,library,mediaId},tx,cancellationToken:ct)))
            throw ApiRequestException.Invalid("Select a present item inside this folder.");
        await db.ExecuteAsync(new CommandDefinition("UPDATE Folders SET CoverMediaId=@mediaId WHERE Id=@folder",new{folder,mediaId},tx,cancellationToken:ct));
        tx.Commit();
    }
    private static FolderSummary ToSummary(FolderRow row)=>new(row.Id,row.LibraryId,row.ParentId,row.RelativePath==""?row.LibraryName:row.RelativePath.Split('/')[^1],row.CoverUrl);
    private sealed class FolderRow {public long Id{get;set;}public long LibraryId{get;set;}public long? ParentId{get;set;}public string RelativePath{get;set;}="";public string LibraryName{get;set;}="";public string? CoverUrl{get;set;}}
    private sealed class LibraryRow {public long Id{get;set;}public string Name{get;set;}="";public string Availability{get;set;}="";public long? RootFolderId{get;set;}public string? CoverUrl{get;set;}}
}
