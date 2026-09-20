using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Media;
using Luma.Server.Http;
using Luma.Server.Features.Indexing;

namespace Luma.Server.Features.Libraries;

public sealed record CoverRequest(long? MediaId);
// Cover selection (which media represent a folder) is separate from rendering, which the client
// chooses. CoverOverride: the person picked a cover; while it stays eligible it is the only image
// returned. Otherwise CoverImages holds up to five automatic candidates, newest first.
public sealed record CoverImage(string Url, int Width, int Height);
public sealed record LibrarySummary(long Id, string Name, string Availability, long? RootFolderId, string? CoverUrl, bool CoverOverride = false, IReadOnlyList<CoverImage>? CoverImages = null, string MetadataMode = "embedded");
public sealed record FolderSummary(long Id, long LibraryId, long? ParentId, string Name, string? CoverUrl, bool CoverOverride = false, IReadOnlyList<CoverImage>? CoverImages = null);
public sealed record FolderVisibilityRequest(bool Hidden);
public sealed record HiddenFolderSummary(long Id, long LibraryId, string LibraryName, string Path);
public sealed record FolderPage(FolderSummary Current, IReadOnlyList<FolderSummary> Ancestors, IReadOnlyList<FolderSummary> Items, string? NextCursor, string? PreviousCursor);
public static class HiddenFolders
{
    // Every folder at or beneath a folder the person hid. Non-correlated, so SQLite
    // evaluates it once per statement; the partial index keeps it free when nothing is hidden.
    public const string Descendants = "SELECT a.DescendantId FROM Folders h INDEXED BY IX_Folders_Hidden JOIN FolderAncestry a ON a.AncestorId=h.Id WHERE h.Hidden=1";
}
public sealed class LibraryBrowser(Database database, CursorSigner cursors)
{
    public async Task<IReadOnlyList<LibrarySummary>> LibrariesAsync(CancellationToken ct)
    {
        await using var db = await database.OpenAsync(ct);
        var rows = await db.QueryAsync<LibraryRow>(new CommandDefinition($"""
            SELECT l.Id,l.Name,l.Availability,l.MetadataMode,(SELECT Id FROM Folders WHERE LibraryId=l.Id AND PathKey='') RootFolderId,
            (SELECT CoverMediaId IS NOT NULL FROM Folders WHERE LibraryId=l.Id AND PathKey='') CoverOverride,
            COALESCE((SELECT json_array({CoverJson})
             FROM Folders root JOIN Media m ON m.Id=root.CoverMediaId JOIN CacheEntries c ON c.MediaId=m.Id AND c.SourceRevision=m.SourceRevision
             WHERE root.LibraryId=l.Id AND root.PathKey='' AND m.LibraryId=l.Id AND m.Availability='present' AND m.FolderId NOT IN ({HiddenFolders.Descendants}) AND c.Variant='thumbnail' AND c.State='ready' AND c.EncoderVersion=@encoder),
            (SELECT json_group_array(json(Cover)) FROM (SELECT {CoverJson} Cover
             FROM Media m CROSS JOIN CacheEntries c ON c.MediaId=m.Id AND c.SourceRevision=m.SourceRevision
             WHERE m.LibraryId=l.Id AND m.Availability='present' AND m.ProcessingStatus='ready' AND m.FolderId NOT IN ({HiddenFolders.Descendants}) AND c.Variant='thumbnail' AND c.State='ready' AND c.EncoderVersion=@encoder
             ORDER BY m.ModifiedTicks DESC,m.Id DESC LIMIT {CoverCandidates}))) CoverJson FROM Libraries l WHERE Enabled=1 ORDER BY l.Id
            """, new { encoder = IndexingOptions.EncoderVersion }, cancellationToken: ct));
        return rows.Select(x => { var images = CoverImages(x.CoverJson); return new LibrarySummary(x.Id, x.Name, x.Availability, x.RootFolderId, images.FirstOrDefault()?.Url, x.CoverOverride, images, x.MetadataMode); }).ToArray();
    }
    public async Task<FolderPage> FoldersAsync(long? libraryId, long? parentId, int? limit, string? cursor, CancellationToken ct, string? sort = null, string? sortOrder = null)
    {
        sort ??= "id"; sortOrder ??= "asc";
        if (sort is not ("id" or "name" or "modified") || sortOrder is not ("asc" or "desc")) throw ApiRequestException.Invalid();
        if (limit is < 1 or > 200 || libraryId <= 0 || parentId <= 0 || (libraryId is null && parentId is null)) throw ApiRequestException.Invalid();
        await using var db = await database.OpenAsync(ct);
        var current = await db.QuerySingleOrDefaultAsync<FolderRow>(new CommandDefinition("""
            SELECT f.*,f.CoverMediaId IS NOT NULL CoverOverride,l.Name LibraryName FROM Folders f JOIN Libraries l ON l.Id=f.LibraryId
            WHERE (@parentId IS NOT NULL AND f.Id=@parentId) OR (@parentId IS NULL AND f.LibraryId=@libraryId AND f.PathKey='')
            """, new { parentId, libraryId }, cancellationToken: ct)) ?? throw ApiRequestException.Missing();
        if (libraryId is not null && current.LibraryId != libraryId) throw ApiRequestException.Invalid();
        // Name cursors hold the natural sort key (migration 0018); the ":2" retires cursors that held paths.
        var scope = sort == "id" && sortOrder == "asc" ? $"folders:{current.Id}" : $"folders:{current.Id}:{sort}:{sortOrder}{(sort == "name" ? ":2" : "")}";
        var position = cursor is null ? null : cursors.Decode(cursor, scope);
        var backwards = position?.Backward == true;
        var descending = (sortOrder == "desc") != backwards;
        var order = descending ? "DESC" : "ASC";
        var compare = descending ? "<" : ">";
        if (position is not null && sort == "name" && position.Tuple is not { Length: 1 }) throw new ApiRequestException(400, "invalid_cursor", "Refresh the folder listing.");
        // Natural name order and directory modified time are both stored keys, so each page is one
        // index seek (IX_Folders_Parent_Sort / IX_Folders_Parent_Modified).
        var seek = position is null ? "" : sort switch
        {
            "name" => $"AND (f.SortKey,f.Id) {compare} (@key,@after)",
            "modified" => $"AND (f.ModifiedTicks,f.Id) {compare} (@ticks,@after)",
            _ => $"AND f.Id {compare} @after"
        };
        var ordering = sort switch { "name" => $"f.SortKey {order},f.Id {order}", "modified" => $"f.ModifiedTicks {order},f.Id {order}", _ => $"f.Id {order}" };
        string Encode(FolderRow row, bool backward) => sort switch
        {
            "name" => cursors.Encode(scope, [row.SortKey], row.Id, backward),
            "modified" => cursors.Encode(scope, row.ModifiedTicks, row.Id, backward),
            _ => cursors.Encode(scope, 0, row.Id, backward)
        };
        var rows = (await db.QueryAsync<FolderRow>(new CommandDefinition($"""
            SELECT f.*,f.CoverMediaId IS NOT NULL CoverOverride,
            COALESCE((SELECT json_array({CoverJson})
             FROM Media m JOIN CacheEntries c ON c.MediaId=m.Id AND c.SourceRevision=m.SourceRevision
             WHERE m.Id=f.CoverMediaId AND m.LibraryId=f.LibraryId AND m.Availability='present' AND m.FolderId NOT IN ({HiddenFolders.Descendants}) AND c.Variant='thumbnail' AND c.State='ready' AND c.EncoderVersion=@encoder
               AND EXISTS(SELECT 1 FROM FolderAncestry WHERE AncestorId=f.Id AND DescendantId=m.FolderId)),
            (SELECT json_group_array(json(Cover)) FROM (SELECT {CoverJson} Cover
             FROM FolderAncestry a CROSS JOIN Media m ON m.FolderId=a.DescendantId AND m.LibraryId=f.LibraryId
             CROSS JOIN CacheEntries c ON c.MediaId=m.Id AND c.SourceRevision=m.SourceRevision
             WHERE a.AncestorId=f.Id AND m.Availability='present' AND m.ProcessingStatus='ready' AND m.FolderId NOT IN ({HiddenFolders.Descendants}) AND c.Variant='thumbnail' AND c.State='ready' AND c.EncoderVersion=@encoder ORDER BY m.ModifiedTicks DESC,m.Id DESC LIMIT {CoverCandidates}))) CoverJson
            FROM Folders f WHERE ParentId=@id AND Hidden=0 {seek} ORDER BY {ordering} LIMIT @limit
            """, new { id = current.Id, after = position?.Id, key = position?.Tuple?[0], ticks = position?.Ticks, limit = (limit ?? 100) + 1, encoder = IndexingOptions.EncoderVersion }, cancellationToken: ct))).ToList();
        var more = rows.Count > (limit ?? 100); if (more) rows.RemoveAt(rows.Count - 1); if (backwards) rows.Reverse();
        var ancestors = await db.QueryAsync<FolderRow>(new CommandDefinition("""
            SELECT f.*,l.Name LibraryName FROM FolderAncestry a JOIN Folders f ON f.Id=a.AncestorId JOIN Libraries l ON l.Id=f.LibraryId
            WHERE a.DescendantId=@id AND a.AncestorId<>@id ORDER BY f.Id
            """, new { id = current.Id }, cancellationToken: ct));
        return new(ToSummary(current), ancestors.Select(ToSummary).ToArray(), rows.Select(ToSummary).ToArray(),
            rows.Count > 0 && (backwards ? position is not null : more) ? Encode(rows[^1], false) : null,
            rows.Count > 0 && (backwards ? more : position is not null) ? Encode(rows[0], true) : null);
    }
    public async Task SetCoverAsync(long folder, long? mediaId, CancellationToken ct)
    {
        if (mediaId <= 0) throw ApiRequestException.Invalid();
        await using var db = await database.OpenAsync(ct);
        using var tx = db.BeginTransaction();
        var library = await db.QuerySingleOrDefaultAsync<long?>(new CommandDefinition("SELECT LibraryId FROM Folders WHERE Id=@folder", new { folder }, tx, cancellationToken: ct)) ?? throw ApiRequestException.Missing();
        if (mediaId is not null && !await db.ExecuteScalarAsync<bool>(new CommandDefinition("SELECT EXISTS(SELECT 1 FROM Media m JOIN FolderAncestry a ON a.DescendantId=m.FolderId WHERE m.Id=@mediaId AND m.LibraryId=@library AND a.AncestorId=@folder AND m.Availability='present')", new { folder, library, mediaId }, tx, cancellationToken: ct)))
            throw ApiRequestException.Invalid("Select a present item inside this folder.");
        await db.ExecuteAsync(new CommandDefinition("UPDATE Folders SET CoverMediaId=@mediaId WHERE Id=@folder", new { folder, mediaId }, tx, cancellationToken: ct));
        tx.Commit();
    }
    public async Task SetHiddenAsync(long folder, bool hidden, CancellationToken ct)
    {
        await using var db = await database.OpenAsync(ct);
        using var tx = db.BeginTransaction();
        var parent = await db.QuerySingleOrDefaultAsync<FolderParent>(new CommandDefinition("SELECT ParentId FROM Folders WHERE Id=@folder", new { folder }, tx, cancellationToken: ct)) ?? throw ApiRequestException.Missing();
        if (parent.ParentId is null) throw ApiRequestException.Invalid("A library root cannot be hidden.");
        await db.ExecuteAsync(new CommandDefinition("UPDATE Folders SET Hidden=@hidden WHERE Id=@folder", new { folder, hidden }, tx, cancellationToken: ct));
        // Hidden media is never visible, so stop preparing it. Unhiding needs no requeue:
        // visible-item priority adopts waiting work as soon as the items are shown again.
        if (hidden) await db.ExecuteAsync(new CommandDefinition("""
            UPDATE ProcessingJobs SET State='waiting' WHERE State='pending' AND MediaId IN
              (SELECT m.Id FROM FolderAncestry a JOIN Media m ON m.FolderId=a.DescendantId WHERE a.AncestorId=@folder)
            """, new { folder }, tx, cancellationToken: ct));
        tx.Commit();
    }
    public async Task<IReadOnlyList<HiddenFolderSummary>> HiddenAsync(CancellationToken ct)
    {
        await using var db = await database.OpenAsync(ct);
        return (await db.QueryAsync<HiddenFolderSummary>(new CommandDefinition("""
            SELECT f.Id,f.LibraryId,l.Name LibraryName,f.RelativePath Path FROM Folders f JOIN Libraries l ON l.Id=f.LibraryId
            WHERE f.Hidden=1 AND l.Enabled=1 ORDER BY l.Id,f.RelativePath LIMIT 500
            """, cancellationToken: ct))).ToArray();
    }
    private static FolderSummary ToSummary(FolderRow row)
    {
        var images = CoverImages(row.CoverJson);
        return new(row.Id, row.LibraryId, row.ParentId, row.RelativePath == "" ? row.LibraryName : row.RelativePath.Split('/')[^1], images.FirstOrDefault()?.Url, row.CoverOverride, images);
    }
    // Enough candidates for a five-tile mosaic; the client decides how many it shows.
    private const int CoverCandidates = 5;
    private const string CoverJson = "json_object('url','/api/media/' || m.Id || '/cache/' || m.SourceRevision || '/thumbnail?v=' || c.EncoderVersion,'width',c.Width,'height',c.Height)";
    private static readonly System.Text.Json.JsonSerializerOptions CoverJsonOptions = new(System.Text.Json.JsonSerializerDefaults.Web);
    private static IReadOnlyList<CoverImage> CoverImages(string? json) => json is null ? [] : System.Text.Json.JsonSerializer.Deserialize<CoverImage[]>(json, CoverJsonOptions) ?? [];
    private sealed class FolderRow { public long Id { get; set; } public long LibraryId { get; set; } public long? ParentId { get; set; } public string RelativePath { get; set; } = ""; public string SortKey { get; set; } = ""; public long ModifiedTicks { get; set; } public string LibraryName { get; set; } = ""; public bool CoverOverride { get; set; } public string? CoverJson { get; set; } }
    private sealed record FolderParent(long? ParentId);
    private sealed class LibraryRow { public long Id { get; set; } public string Name { get; set; } = ""; public string Availability { get; set; } = ""; public string MetadataMode { get; set; } = "embedded"; public long? RootFolderId { get; set; } public bool CoverOverride { get; set; } public string? CoverJson { get; set; } }
}
