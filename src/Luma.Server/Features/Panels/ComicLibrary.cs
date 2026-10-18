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
    public async Task<ComicList> ListAsync(string? q, string? state, string? series, bool? favourite, long? cursor, CancellationToken ct)
    {
        if (q?.Length > 200 || state is not (null or "unread" or "reading" or "completed") || cursor < 0) throw ApiRequestException.Invalid();
        await using var db = await database.OpenAsync(ct);
        var rows = (await db.QueryAsync<ComicRow>(new CommandDefinition(ReadSql + "\n" + """
            AND (@q IS NULL OR instr(lower(c.Title),lower(@q))>0 OR instr(lower(c.Author),lower(@q))>0)
            AND (@state IS NULL OR COALESCE(p.State,'unread')=@state) AND (@series IS NULL OR c.Series=@series)
            AND (@favourite IS NULL OR c.Favourite=@favourite) AND (@cursor IS NULL OR c.Id<@cursor)
            ORDER BY c.Id DESC LIMIT 61
            """, new { q, state, series, favourite, cursor }, cancellationToken: ct))).ToList();
        var more = rows.Count > 60;
        if (more) rows.RemoveAt(rows.Count - 1);
        // Cache presence is a SQLite lookup, never a stat of source or generated files.
        var covered = (await db.QueryAsync<long>(new CommandDefinition("SELECT cc.ComicId FROM ComicCache cc JOIN Comics c ON c.Id=cc.ComicId AND c.Revision=cc.Revision WHERE cc.Variant='cover' AND cc.ComicId IN @ids", new { ids = rows.Select(x => x.Id).ToArray() }, cancellationToken: ct))).ToHashSet();
        return new(rows.Select(row => Summary(row, covered.Contains(row.Id))).ToArray(), more ? rows[^1].Id : null);
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
