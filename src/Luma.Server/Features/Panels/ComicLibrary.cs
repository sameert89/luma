using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Indexing;
using Luma.Server.Http;
using Microsoft.Data.Sqlite;

namespace Luma.Server.Features.Panels;

public sealed class ComicRow
{
    public long Id { get; set; }
    public long LibraryId { get; set; }
    public string RelativePath { get; set; } = "";
    public string Format { get; set; } = "";
    public string Title { get; set; } = "";
    public string Series { get; set; } = "";
    public string Author { get; set; } = "";
    public string Description { get; set; } = "";
    public int PageCount { get; set; }
    public int CoverPage { get; set; }
    public long SourceSize { get; set; }
    public long SourceModifiedTicks { get; set; }
    public int Revision { get; set; }
    public bool Favourite { get; set; }
    public int PageIndex { get; set; }
    public string State { get; set; } = "unread";
    public double ReadingSeconds { get; set; }
    public string Direction { get; set; } = "ltr";
    public string Settings { get; set; } = "{}";
    public string? LastReadAt { get; set; }
}
public sealed record ComicSummary(long Id, long LibraryId, string Title, string Series, string Author, string Description,
    string Format, int PageCount, int PageIndex, string State, double ReadingSeconds, string Direction, string Settings, string? LastReadAt, bool Favourite, string? CoverUrl, int CoverPage);
public sealed record ComicList(IReadOnlyList<ComicSummary> Items, long? NextCursor);
public sealed record ComicFolder(string Name, string RelativePath);
public sealed record ComicFolderPage(IReadOnlyList<ComicFolder> Items, string? NextCursor);
public sealed record ComicTagUpdate(long[] AddTagIds, long[] RemoveTagIds);
public sealed record ComicJobAccepted(long Id);
public sealed record ComicRegistration(long LibraryId, string? RelativePath = null);
public sealed class ComicJob
{
    public long Id { get; set; }
    public long LibraryId { get; set; }
    public bool Recursive { get; set; }
    public bool ImageFolders { get; set; }
    public string? Source { get; set; }
    public string State { get; set; } = "queued";
    public long Processed { get; set; }
    public long Failed { get; set; }
    public string? FailureCode { get; set; }
    public string CreatedAt { get; set; } = "";
}
public sealed class ComicLibrary(Database database, IndexingOptions options)
{
    internal const string ReadSql = """
        SELECT c.*,COALESCE(p.PageIndex,0) PageIndex,COALESCE(p.State,'unread') State,
          COALESCE(p.ReadingSeconds,0) ReadingSeconds,COALESCE(p.Direction,'ltr') Direction,COALESCE(p.Settings,'{}') Settings,p.LastReadAt
        FROM Comics c JOIN Libraries l ON l.Id=c.LibraryId LEFT JOIN ReadingProgress p ON p.ComicId=c.Id
        WHERE c.Availability='present' AND l.Enabled=1
          AND (NOT EXISTS(SELECT 1 FROM ApplicationState WHERE Key='panelSourcesConfigured')
            OR EXISTS(SELECT 1 FROM PanelSources s WHERE s.LibraryId=c.LibraryId
              AND (s.PathKey='' OR c.PathKey=s.PathKey OR (c.PathKey>=s.PathKey||'/' AND c.PathKey<s.PathKey||'0'))))
        """;
    public async Task<IReadOnlyList<Luma.Server.Features.Media.SearchSuggestion>> SuggestAsync(string? q, int limit, CancellationToken ct)
    {
        if (q?.Length > 200 || limit is < 1 or > 20) throw ApiRequestException.Invalid();
        if (string.IsNullOrWhiteSpace(q)) return [];
        await using var db = await database.OpenAsync(ct);
        var rows = await db.QueryAsync<ComicRow>(new CommandDefinition(ReadSql + " AND instr(lower(c.Title),lower(@q))>0 ORDER BY c.Id DESC LIMIT @limit", new { q = q.Trim(), limit }, cancellationToken: ct));
        return rows.Select(x => new Luma.Server.Features.Media.SearchSuggestion("comic", x.Title, x.Id, x.Series)).ToArray();
    }
    public async Task<ComicList> ListAsync(string? q, string? state, string? series, bool? favourite, long? cursor, CancellationToken ct, long? libraryId = null, string? path = null, string? tag = null)
    {
        if (path is not null) path = Luma.Server.Features.Files.MutationPaths.Normalize(path, true);
        if (libraryId is not null && !options.Libraries.Any(x => x.Id == libraryId)) throw ApiRequestException.Missing();
        if (q?.Length > 200 || state is not (null or "unread" or "reading" or "completed") || cursor < 0) throw ApiRequestException.Invalid();
        await using var db = await database.OpenAsync(ct);
        var rows = (await db.QueryAsync<ComicRow>(new CommandDefinition(ReadSql + "\n" + """
            AND (@q IS NULL OR instr(lower(c.Title),lower(@q))>0 OR instr(lower(c.Author),lower(@q))>0 OR instr(lower(c.Series),lower(@q))>0)
            AND (@libraryId IS NULL OR c.LibraryId=@libraryId)
            AND (@path IS NULL OR (substr(c.RelativePath,1,length(@prefix))=@prefix AND instr(substr(c.RelativePath,length(@prefix)+1),'/')=0))
            AND (@tag IS NULL OR EXISTS(SELECT 1 FROM ComicTags ct JOIN Tags t ON t.Id=ct.TagId WHERE ct.ComicId=c.Id AND t.NormalizedKey=@tag))
            AND (@state IS NULL OR COALESCE(p.State,'unread')=@state) AND (@series IS NULL OR c.Series=@series)
            AND (@favourite IS NULL OR c.Favourite=@favourite) AND (@cursor IS NULL OR c.Id<@cursor)
            ORDER BY c.Id DESC LIMIT 61
            """, new { q, state, series, favourite, cursor, libraryId, path, prefix = string.IsNullOrEmpty(path) ? "" : path + "/", tag = tag is null ? null : Luma.Server.Features.Tags.TagText.Normalize(tag).Key }, cancellationToken: ct))).ToList();
        var more = rows.Count > 60;
        if (more) rows.RemoveAt(rows.Count - 1);
        // Cache presence is a SQLite lookup, never a stat of source or generated files.
        var covered = (await db.QueryAsync<long>(new CommandDefinition("SELECT cc.ComicId FROM ComicCache cc JOIN Comics c ON c.Id=cc.ComicId AND c.Revision=cc.Revision WHERE cc.Variant='cover' AND cc.ComicId IN @ids", new { ids = rows.Select(x => x.Id).ToArray() }, cancellationToken: ct))).ToHashSet();
        return new(rows.Select(row => Summary(row, covered.Contains(row.Id))).ToArray(), more ? rows[^1].Id : null);
    }
    public async Task<ComicFolderPage> FoldersAsync(long libraryId, string path, string? after, CancellationToken ct)
    {
        path = Luma.Server.Features.Files.MutationPaths.Normalize(path, true);
        var root = options.Libraries.Find(x => x.Id == libraryId) ?? throw ApiRequestException.Missing();
        var prefix = path.Length == 0 ? "" : path + "/";
        var key = root.Key(prefix);
        await using var db = await database.OpenAsync(ct);
        // The library/path unique index bounds the subtree. Only immediate child names leave SQLite.
        var rows = (await db.QueryAsync<ComicFolder>(new CommandDefinition("""
            WITH visible AS (
            """ + ReadSql + """
              AND c.LibraryId=@libraryId AND c.PathKey>=@key AND c.PathKey<@end
            ), children AS (
              SELECT substr(RelativePath,length(@prefix)+1,instr(substr(RelativePath,length(@prefix)+1),'/')-1) Name
              FROM visible WHERE instr(substr(RelativePath,length(@prefix)+1),'/')>0
            )
            SELECT Name,@prefix||Name RelativePath FROM children WHERE @after IS NULL OR Name COLLATE BINARY>@after
            GROUP BY Name ORDER BY Name COLLATE BINARY LIMIT 61
            """, new { libraryId, prefix, key, end = key + "\U0010FFFF", after }, cancellationToken: ct))).ToList();
        var more = rows.Count > 60;
        if (more) rows.RemoveAt(60);
        return new(rows, more ? rows[^1].Name : null);
    }
    public async Task<IReadOnlyList<Luma.Server.Features.Media.TagSummary>> TagsAsync(long id, CancellationToken ct)
    {
        await GetAsync(id, ct);
        await using var db = await database.OpenAsync(ct);
        return (await db.QueryAsync<Luma.Server.Features.Media.TagSummary>(new CommandDefinition("SELECT t.Id,t.Name FROM ComicTags c JOIN Tags t ON t.Id=c.TagId WHERE c.ComicId=@id ORDER BY t.NormalizedKey,t.Id", new { id }, cancellationToken: ct))).ToArray();
    }
    public async Task UpdateTagsAsync(long id, ComicTagUpdate update, CancellationToken ct)
    {
        await GetAsync(id, ct);
        if (update.AddTagIds is null || update.RemoveTagIds is null || update.AddTagIds.Length > 50 || update.RemoveTagIds.Length > 50 || update.AddTagIds.Concat(update.RemoveTagIds).Any(x => x <= 0) || update.AddTagIds.Intersect(update.RemoveTagIds).Any()) throw ApiRequestException.Invalid();
        await using var db = await database.OpenAsync(ct);
        using var tx = db.BeginTransaction();
        if (await db.ExecuteScalarAsync<bool>(new CommandDefinition("SELECT EXISTS(SELECT value FROM json_each(@tags) WHERE value NOT IN (SELECT Id FROM Tags))", new { tags = System.Text.Json.JsonSerializer.Serialize(update.AddTagIds.Concat(update.RemoveTagIds)) }, tx, cancellationToken: ct))) throw ApiRequestException.Missing();
        foreach (var tag in update.RemoveTagIds.Distinct()) await db.ExecuteAsync(new CommandDefinition("DELETE FROM ComicTags WHERE ComicId=@id AND TagId=@tag", new { id, tag }, tx, cancellationToken: ct));
        foreach (var tag in update.AddTagIds.Distinct()) await db.ExecuteAsync(new CommandDefinition("INSERT INTO ComicTags(ComicId,TagId) VALUES(@id,@tag) ON CONFLICT DO NOTHING", new { id, tag }, tx, cancellationToken: ct));
        if (await db.ExecuteScalarAsync<int>(new CommandDefinition("SELECT COUNT(*) FROM ComicTags WHERE ComicId=@id", new { id }, tx, cancellationToken: ct)) > 100) throw ApiRequestException.Invalid("A comic may have at most 100 tags.");
        tx.Commit();
    }
    public async Task<ComicRow> GetAsync(long id, CancellationToken ct)
    {
        await using var db = await database.OpenAsync(ct);
        return await db.QuerySingleOrDefaultAsync<ComicRow>(new CommandDefinition(ReadSql + " AND c.Id=@id", new { id }, cancellationToken: ct)) ?? throw ApiRequestException.Missing();
    }
    internal static ComicSummary Summary(ComicRow row, bool cover = true) => new(row.Id, row.LibraryId, row.Title, row.Series, row.Author, row.Description, row.Format, row.PageCount, row.PageIndex, row.State, row.ReadingSeconds, row.Direction, row.Settings, row.LastReadAt, row.Favourite, cover ? $"/api/panels/comics/{row.Id}/cover?v={row.Revision}" : null, row.CoverPage);
    public async Task<ComicJobAccepted> QueueAsync(ComicRegistration request, CancellationToken ct)
    {
        var root = options.Libraries.Find(x => x.Id == request.LibraryId) ?? throw ApiRequestException.Missing();
        if (request.RelativePath is not null) Luma.Server.Features.Files.MutationPaths.Normalize(request.RelativePath, true);
        await using var db = await database.OpenAsync(ct);
        try
        {
            var id = await db.ExecuteScalarAsync<long>(new CommandDefinition("INSERT INTO ComicJobs(LibraryId,Source,CreatedAt) VALUES(@LibraryId,@RelativePath,@now) RETURNING Id", new { request.LibraryId, request.RelativePath, now = DateTimeOffset.UtcNow.ToString("O") }, cancellationToken: ct));
            return new(id);
        }
        catch (SqliteException error) when (error.SqliteErrorCode == 19) { throw new ApiRequestException(409, "comic_job_active", "A comic discovery task is already active for this library."); }
    }
}
