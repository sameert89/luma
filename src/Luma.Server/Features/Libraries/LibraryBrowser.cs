using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Media;
using Luma.Server.Http;
using Luma.Server.Features.Indexing;

namespace Luma.Server.Features.Libraries;

public sealed record CoverRequest(long? MediaId);
public sealed record LibrarySummary(long Id,string Name,string Availability,long? RootFolderId,string? CoverUrl);
public sealed record FolderSummary(long Id,long LibraryId,long? ParentId,string Name,string? CoverUrl);
public sealed record FolderVisibilityRequest(bool Hidden);
public sealed record HiddenFolderSummary(long Id,long LibraryId,string LibraryName,string Path);
public sealed record FolderPage(FolderSummary Current,IReadOnlyList<FolderSummary> Ancestors,IReadOnlyList<FolderSummary> Items,string? NextCursor,string? PreviousCursor);
public static class HiddenFolders
{
    // Every folder at or beneath a folder the person hid. Non-correlated, so SQLite
    // evaluates it once per statement; the partial index keeps it free when nothing is hidden.
    public const string Descendants = "SELECT a.DescendantId FROM Folders h INDEXED BY IX_Folders_Hidden JOIN FolderAncestry a ON a.AncestorId=h.Id WHERE h.Hidden=1";
}
public sealed class LibraryBrowser(Database database,CursorSigner cursors)
{
    public async Task<IReadOnlyList<LibrarySummary>> LibrariesAsync(CancellationToken ct)
    {
        await using var db=await database.OpenAsync(ct);
        var rows=await db.QueryAsync<LibraryRow>(new CommandDefinition($"""
            SELECT l.Id,l.Name,l.Availability,(SELECT Id FROM Folders WHERE LibraryId=l.Id AND PathKey='') RootFolderId,
            COALESCE((SELECT '/api/media/' || m.Id || '/cache/' || m.SourceRevision || '/thumbnail?v=' || c.EncoderVersion
             FROM Folders root JOIN Media m ON m.Id=root.CoverMediaId JOIN CacheEntries c ON c.MediaId=m.Id AND c.SourceRevision=m.SourceRevision
             WHERE root.LibraryId=l.Id AND root.PathKey='' AND m.LibraryId=l.Id AND m.Availability='present' AND m.FolderId NOT IN ({HiddenFolders.Descendants}) AND c.Variant='thumbnail' AND c.State='ready' AND c.EncoderVersion=@encoder),
            (SELECT '/api/media/' || m.Id || '/cache/' || m.SourceRevision || '/thumbnail?v=' || c.EncoderVersion
             FROM Media m CROSS JOIN CacheEntries c ON c.MediaId=m.Id AND c.SourceRevision=m.SourceRevision
             WHERE m.LibraryId=l.Id AND m.Availability='present' AND m.ProcessingStatus='ready' AND m.FolderId NOT IN ({HiddenFolders.Descendants}) AND c.Variant='thumbnail' AND c.State='ready' AND c.EncoderVersion=@encoder
             ORDER BY m.ModifiedTicks DESC,m.Id DESC LIMIT 1)) CoverUrl FROM Libraries l WHERE Enabled=1 ORDER BY l.Id
            """,new { encoder=IndexingOptions.EncoderVersion },cancellationToken:ct));
        return rows.Select(x=>new LibrarySummary(x.Id,x.Name,x.Availability,x.RootFolderId,x.CoverUrl)).ToArray();
    }
    public async Task<FolderPage> FoldersAsync(long? libraryId,long? parentId,int? limit,string? cursor,CancellationToken ct,string? sort = null,string? sortOrder = null)
    {
        sort ??= "id"; sortOrder ??= "asc";
        if(sort is not ("id" or "name") || sortOrder is not ("asc" or "desc")) throw ApiRequestException.Invalid();
        if(limit is <1 or >200 || libraryId<=0 || parentId<=0 || (libraryId is null && parentId is null)) throw ApiRequestException.Invalid();
        await using var db=await database.OpenAsync(ct);
        var current=await db.QuerySingleOrDefaultAsync<FolderRow>(new CommandDefinition("""
            SELECT f.*,l.Name LibraryName FROM Folders f JOIN Libraries l ON l.Id=f.LibraryId
            WHERE (@parentId IS NOT NULL AND f.Id=@parentId) OR (@parentId IS NULL AND f.LibraryId=@libraryId AND f.PathKey='')
            """,new{parentId,libraryId},cancellationToken:ct)) ?? throw ApiRequestException.Missing();
        if(libraryId is not null && current.LibraryId!=libraryId) throw ApiRequestException.Invalid();
        var scope=sort=="id" && sortOrder=="asc"?$"folders:{current.Id}":$"folders:{current.Id}:{sort}:{sortOrder}";
        var position=cursor is null?null:cursors.Decode(cursor,scope);
        var backwards=position?.Backward==true;
        var descending=(sortOrder=="desc") != backwards;
        var order=descending?"DESC":"ASC";
        var compare=descending?"<":">";
        if(position is not null && sort=="name" && position.Tuple is not {Length:1}) throw new ApiRequestException(400,"invalid_cursor","Refresh the folder listing.");
        var seek=position is null?"":sort=="name"?$"AND (f.RelativePath COLLATE NOCASE,f.Id) {compare} (@key COLLATE NOCASE,@after)":$"AND f.Id {compare} @after";
        var ordering=sort=="name"?$"f.RelativePath COLLATE NOCASE {order},f.Id {order}":$"f.Id {order}";
        string Encode(FolderRow row,bool backward)=>sort=="name"?cursors.Encode(scope,[row.RelativePath],row.Id,backward):cursors.Encode(scope,0,row.Id,backward);
        var rows=(await db.QueryAsync<FolderRow>(new CommandDefinition($"""
            SELECT f.*,
            COALESCE((SELECT '/api/media/' || m.Id || '/cache/' || m.SourceRevision || '/thumbnail?v=' || c.EncoderVersion
             FROM Media m JOIN CacheEntries c ON c.MediaId=m.Id AND c.SourceRevision=m.SourceRevision
             WHERE m.Id=f.CoverMediaId AND m.LibraryId=f.LibraryId AND m.Availability='present' AND m.FolderId NOT IN ({HiddenFolders.Descendants}) AND c.Variant='thumbnail' AND c.State='ready' AND c.EncoderVersion=@encoder
               AND EXISTS(SELECT 1 FROM FolderAncestry WHERE AncestorId=f.Id AND DescendantId=m.FolderId)),
            (SELECT '/api/media/' || m.Id || '/cache/' || m.SourceRevision || '/thumbnail?v=' || c.EncoderVersion
             FROM FolderAncestry a CROSS JOIN Media m ON m.FolderId=a.DescendantId AND m.LibraryId=f.LibraryId
             CROSS JOIN CacheEntries c ON c.MediaId=m.Id AND c.SourceRevision=m.SourceRevision
             WHERE a.AncestorId=f.Id AND m.Availability='present' AND m.ProcessingStatus='ready' AND m.FolderId NOT IN ({HiddenFolders.Descendants}) AND c.Variant='thumbnail' AND c.State='ready' AND c.EncoderVersion=@encoder ORDER BY m.ModifiedTicks DESC,m.Id DESC LIMIT 1)) CoverUrl
            FROM Folders f WHERE ParentId=@id AND Hidden=0 {seek} ORDER BY {ordering} LIMIT @limit
            """,new{id=current.Id,after=position?.Id,key=position?.Tuple?[0],limit=(limit??100)+1,encoder=IndexingOptions.EncoderVersion},cancellationToken:ct))).ToList();
        var more=rows.Count>(limit??100);if(more)rows.RemoveAt(rows.Count-1);if(backwards)rows.Reverse();
        var ancestors=await db.QueryAsync<FolderRow>(new CommandDefinition("""
            SELECT f.*,l.Name LibraryName FROM FolderAncestry a JOIN Folders f ON f.Id=a.AncestorId JOIN Libraries l ON l.Id=f.LibraryId
            WHERE a.DescendantId=@id AND a.AncestorId<>@id ORDER BY f.Id
            """,new{id=current.Id},cancellationToken:ct));
        return new(ToSummary(current),ancestors.Select(ToSummary).ToArray(),rows.Select(ToSummary).ToArray(),
            rows.Count>0 && (backwards?position is not null:more)?Encode(rows[^1],false):null,
            rows.Count>0 && (backwards?more:position is not null)?Encode(rows[0],true):null);
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
    public async Task SetHiddenAsync(long folder,bool hidden,CancellationToken ct)
    {
        await using var db=await database.OpenAsync(ct);
        using var tx=db.BeginTransaction();
        var parent=await db.QuerySingleOrDefaultAsync<FolderParent>(new CommandDefinition("SELECT ParentId FROM Folders WHERE Id=@folder",new{folder},tx,cancellationToken:ct)) ?? throw ApiRequestException.Missing();
        if(parent.ParentId is null) throw ApiRequestException.Invalid("A library root cannot be hidden.");
        await db.ExecuteAsync(new CommandDefinition("UPDATE Folders SET Hidden=@hidden WHERE Id=@folder",new{folder,hidden},tx,cancellationToken:ct));
        // Hidden media is never visible, so stop preparing it. Unhiding needs no requeue:
        // visible-item priority adopts waiting work as soon as the items are shown again.
        if(hidden) await db.ExecuteAsync(new CommandDefinition("""
            UPDATE ProcessingJobs SET State='waiting' WHERE State='pending' AND MediaId IN
              (SELECT m.Id FROM FolderAncestry a JOIN Media m ON m.FolderId=a.DescendantId WHERE a.AncestorId=@folder)
            """,new{folder},tx,cancellationToken:ct));
        tx.Commit();
    }
    public async Task<IReadOnlyList<HiddenFolderSummary>> HiddenAsync(CancellationToken ct)
    {
        await using var db=await database.OpenAsync(ct);
        return (await db.QueryAsync<HiddenFolderSummary>(new CommandDefinition("""
            SELECT f.Id,f.LibraryId,l.Name LibraryName,f.RelativePath Path FROM Folders f JOIN Libraries l ON l.Id=f.LibraryId
            WHERE f.Hidden=1 AND l.Enabled=1 ORDER BY l.Id,f.RelativePath LIMIT 500
            """,cancellationToken:ct))).ToArray();
    }
    private static FolderSummary ToSummary(FolderRow row)=>new(row.Id,row.LibraryId,row.ParentId,row.RelativePath==""?row.LibraryName:row.RelativePath.Split('/')[^1],row.CoverUrl);
    private sealed class FolderRow {public long Id{get;set;}public long LibraryId{get;set;}public long? ParentId{get;set;}public string RelativePath{get;set;}="";public string LibraryName{get;set;}="";public string? CoverUrl{get;set;}}
    private sealed record FolderParent(long? ParentId);
    private sealed class LibraryRow {public long Id{get;set;}public string Name{get;set;}="";public string Availability{get;set;}="";public long? RootFolderId{get;set;}public string? CoverUrl{get;set;}}
}
