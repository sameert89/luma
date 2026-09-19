using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Libraries;
using Luma.Server.Http;

namespace Luma.Server.Features.Media;

/// <summary>What a suggestion completes: an existing tag, a folder or an indexed file name.</summary>
public sealed record SearchSuggestion(string Kind, string Label, long Id, string? Detail = null, long? LibraryId = null);

public static class SearchSuggestions
{
    private const int MaximumTags = 4;
    private const int MaximumFolders = 3;

    // Tags by prefix on their unique key; only tags that still label something are offered.
    public const string TagQuery = """
        SELECT t.Id,t.Name Label,NULL Detail FROM Tags t
        WHERE t.NormalizedKey>=@key AND t.NormalizedKey<@end AND EXISTS(SELECT 1 FROM MediaTags mt WHERE mt.TagId=t.Id)
        ORDER BY t.NormalizedKey,t.Id LIMIT @count
        """;
    // Folders by their own name: a prefix seek on IX_Folders_Name, then (from three characters) names
    // containing the text from the folder trigram index. Library roots are libraries, not suggestions.
    public const string FolderPrefixQuery = $"""
        SELECT f.Id,f.LibraryId,f.RelativePath,l.Name LibraryName FROM Folders f INDEXED BY IX_Folders_Name JOIN Libraries l ON l.Id=f.LibraryId
        WHERE f.NameKey>=@key AND f.NameKey<@end AND f.ParentId IS NOT NULL AND l.Enabled=1
          AND f.Id NOT IN ({HiddenFolders.Descendants})
        ORDER BY f.NameKey,f.Id LIMIT @count
        """;
    public const string FolderSubstringQuery = $"""
        SELECT f.Id,f.LibraryId,f.RelativePath,l.Name LibraryName FROM Folders f JOIN Libraries l ON l.Id=f.LibraryId
        WHERE f.Id IN (SELECT rowid FROM FolderSearch WHERE FolderSearch MATCH @fts LIMIT 200)
          AND instr(f.NameKey,@key)>1 AND f.ParentId IS NOT NULL AND l.Enabled=1
          AND f.Id NOT IN ({HiddenFolders.Descendants})
        ORDER BY f.NameKey,f.Id LIMIT @count
        """;
    // Names that start with the text: a range seek on IX_Media_Name.
    public const string PrefixQuery = $"""
        SELECT m.Id,m.FileName Label,m.RelativePath Detail FROM Media m INDEXED BY IX_Media_Name
        WHERE m.NameKey>=@key AND m.NameKey<@end AND m.Availability='present'
          AND m.FolderId NOT IN ({HiddenFolders.Descendants})
        ORDER BY m.NameKey,m.Id LIMIT @remaining
        """;
    // Names containing the text, from the trigram index. A common fragment ("img") matches most of a
    // library, so only 200 candidates are examined and ranked.
    public const string SubstringQuery = $"""
        SELECT m.Id,m.FileName Label,m.RelativePath Detail FROM Media m
        WHERE m.Id IN (SELECT rowid FROM MediaSearch WHERE MediaSearch MATCH @fts LIMIT 200)
          AND instr(m.NameKey,@key)>1 AND m.Availability='present'
          AND m.FolderId NOT IN ({HiddenFolders.Descendants})
        ORDER BY m.NameKey,m.Id LIMIT @more
        """;

    public static void MapSearchSuggestions(this IEndpointRouteBuilder app) =>
        app.MapGet("/api/search/suggestions", async (string? q, int? limit, Database database, CancellationToken ct) =>
            TypedResults.Ok(await SuggestAsync(database, q, limit ?? 8, ct))).WithName("GetSearchSuggestions");

    public static async Task<IReadOnlyList<SearchSuggestion>> SuggestAsync(Database database, string? q, int limit, CancellationToken ct)
    {
        if (limit is < 1 or > 20 || q?.Length > 200) throw ApiRequestException.Invalid();
        var text = q?.Trim() ?? "";
        if (text.Length == 0) return [];
        var key = SearchText.Key(text);
        var end = key + "\U0010FFFF";
        await using var db = await database.OpenAsync(ct);
        var substring = text.EnumerateRunes().Count() >= 3;
        var fts = "NameKey:\"" + key.Replace("\"", "\"\"") + "\"";
        var tags = (await db.QueryAsync<SuggestionRow>(new CommandDefinition(TagQuery, new { key, end, count = Math.Min(MaximumTags, limit) }, cancellationToken: ct))).ToList();
        var folderCount = Math.Min(MaximumFolders, limit - tags.Count);
        var folders = folderCount <= 0 ? [] : (await db.QueryAsync<FolderRow>(new CommandDefinition(FolderPrefixQuery, new { key, end, count = folderCount }, cancellationToken: ct))).ToList();
        if (substring && folders.Count < folderCount)
            folders.AddRange(await db.QueryAsync<FolderRow>(new CommandDefinition(FolderSubstringQuery, new { key, fts, count = folderCount - folders.Count }, cancellationToken: ct)));
        var remaining = limit - tags.Count - folders.Count;
        var files = new List<SuggestionRow>();
        if (remaining > 0)
        {
            // Names that start with the text first, then (from three characters) names containing it.
            files.AddRange(await db.QueryAsync<SuggestionRow>(new CommandDefinition(PrefixQuery, new { key, end, remaining }, cancellationToken: ct)));
            if (substring && files.Count < remaining)
                files.AddRange(await db.QueryAsync<SuggestionRow>(new CommandDefinition(SubstringQuery, new { key, fts, more = remaining - files.Count }, cancellationToken: ct)));
        }
        return [.. tags.Select(x => new SearchSuggestion("tag", x.Label, x.Id)),
            // A folder's detail is where it lives: its library, then its parent folders.
            .. folders.Select(x => new SearchSuggestion("folder", SearchText.FolderName(x.RelativePath), x.Id,
                string.Join(" / ", new[] { x.LibraryName, FolderOf(x.RelativePath)?.Replace("/", " / ") }.Where(part => !string.IsNullOrEmpty(part))), x.LibraryId)),
            .. files.Select(x => new SearchSuggestion("file", x.Label, x.Id, FolderOf(x.Detail)))];
    }

    // Where the file lives, so identical names in different folders can be told apart.
    private static string? FolderOf(string? relativePath)
    {
        var slash = relativePath?.LastIndexOf('/') ?? -1;
        return slash > 0 ? relativePath![..slash] : null;
    }

    private sealed class FolderRow
    {
        public long Id { get; set; }
        public long LibraryId { get; set; }
        public string RelativePath { get; set; } = "";
        public string LibraryName { get; set; } = "";
    }

    private sealed class SuggestionRow
    {
        public long Id { get; set; }
        public string Label { get; set; } = "";
        public string? Detail { get; set; }
    }
}
