using System.Globalization;
using System.Text.Json;
using Dapper;
using Luma.Server.Http;
using Microsoft.AspNetCore.Mvc;

namespace Luma.Server.Features.Media;

public sealed record MediaQuery
{
    [FromQuery(Name = "limit")] public int? Limit { get; init; }
    [FromQuery(Name = "cursor")] public string? Cursor { get; init; }
    [FromQuery(Name = "libraryId")] public long? LibraryId { get; init; }
    [FromQuery(Name = "folderId")] public long? FolderId { get; init; }
    [FromQuery(Name = "recursive")] public bool? Recursive { get; init; }
    [FromQuery(Name = "q")] public string? Q { get; init; }
    [FromQuery(Name = "path")] public string? Path { get; init; }
    [FromQuery(Name = "startsWith")] public string? StartsWith { get; init; }
    [FromQuery(Name = "endsWith")] public string? EndsWith { get; init; }
    [FromQuery(Name = "tag")] public string[]? Tag { get; init; }
    [FromQuery(Name = "collectionTag")] public string? CollectionTag { get; init; }
    [FromQuery(Name = "tagMode")] public string? TagMode { get; init; }
    [FromQuery(Name = "tagged")] public bool? Tagged { get; init; }
    [FromQuery(Name = "mediaType")] public string? MediaType { get; init; }
    [FromQuery(Name = "extension")] public string[]? Extension { get; init; }
    [FromQuery(Name = "dateFrom")] public string? DateFrom { get; init; }
    [FromQuery(Name = "dateTo")] public string? DateTo { get; init; }
    [FromQuery(Name = "minSizeBytes")] public long? MinSizeBytes { get; init; }
    [FromQuery(Name = "maxSizeBytes")] public long? MaxSizeBytes { get; init; }
    [FromQuery(Name = "orientation")] public string? Orientation { get; init; }
    [FromQuery(Name = "minWidth")] public int? MinWidth { get; init; }
    [FromQuery(Name = "width")] public int? Width { get; init; }
    [FromQuery(Name = "minHeight")] public int? MinHeight { get; init; }
    [FromQuery(Name = "height")] public int? Height { get; init; }
    [FromQuery(Name = "minAspectRatio")] public double? MinAspectRatio { get; init; }
    [FromQuery(Name = "maxAspectRatio")] public double? MaxAspectRatio { get; init; }
    [FromQuery(Name = "preference")] public string? Preference { get; init; }
    [FromQuery(Name = "availability")] public string? Availability { get; init; }
    [FromQuery(Name = "sort")] public string? Sort { get; init; }
    [FromQuery(Name = "order")] public string? Order { get; init; }
    [FromQuery(Name = "seed")] public string? Seed { get; init; }
    [FromQuery(Name = "groupBy")] public string? GroupBy { get; init; }

    public MediaQuery Normalize(IQueryCollection? parameters = null)
    {
        var names = typeof(MediaQuery).GetProperties().Select(x => x.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (parameters is not null && parameters.Any(x => !names.Contains(x.Key) || (x.Value.Count > 1 && x.Key is not ("tag" or "extension"))))
            throw ApiRequestException.Invalid("Unknown or repeated query parameter.");
        if (Limit is < 1 or > 200 || LibraryId <= 0 || FolderId <= 0 || MinSizeBytes < 0 || MaxSizeBytes < 0
            || MinSizeBytes > MaxSizeBytes || MinWidth <= 0 || MinHeight <= 0 || Width <= 0 || Height <= 0
            || Width < MinWidth || Height < MinHeight || Tagged == false && (Tag?.Length > 0 || !string.IsNullOrWhiteSpace(CollectionTag)))
            throw ApiRequestException.Invalid("Check the filter ranges.");
        if (new[] { MinAspectRatio, MaxAspectRatio }.Any(x => x is { } n && (!double.IsFinite(n) || n <= 0)) || MinAspectRatio > MaxAspectRatio)
            throw ApiRequestException.Invalid("Aspect ratios must be finite positive numbers.");
        static string? Text(string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return null;
            if (value.EnumerateRunes().Count() > 200 || value.Any(char.IsControl)) throw ApiRequestException.Invalid("Search text is too long or contains control characters.");
            return SearchText.Key(value.Trim());
        }
        static string? Choice(string? value, params string[] allowed)
        {
            if (string.IsNullOrEmpty(value)) return null;
            if (!allowed.Contains(value)) throw ApiRequestException.Invalid("Unsupported filter or sort value.");
            return value;
        }
        static string? Date(string? value)
        {
            if (string.IsNullOrEmpty(value)) return null;
            if (!DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var date)) throw ApiRequestException.Invalid("Invalid date.");
            return date.ToUniversalTime().ToString("O");
        }
        if (Seed is { Length: > 100 } || Seed?.Any(char.IsControl) == true) throw ApiRequestException.Invalid("Invalid shuffle seed.");
        var from = Date(DateFrom); var to = Date(DateTo);
        if (from is not null && to is not null && SearchText.Ticks(from) >= SearchText.Ticks(to)) throw ApiRequestException.Invalid("End date must follow start date.");
        if (Tag?.Length > 50 || Extension?.Length > 20) throw ApiRequestException.Invalid("Too many tags or extensions.");
        var extensions = Extension?.Select(x => x.Trim().TrimStart('.').ToLowerInvariant()).Where(x => x.Length > 0).Distinct().Order().ToArray() ?? [];
        if (extensions.Any(x => x.Length > 16 || !x.All(char.IsAsciiLetterOrDigit))) throw ApiRequestException.Invalid("Invalid extension.");
        return this with
        {
            Limit = Limit ?? 60,
            Q = Text(Q),
            Path = Text(Path),
            StartsWith = Text(StartsWith),
            EndsWith = Text(EndsWith),
            CollectionTag = string.IsNullOrWhiteSpace(CollectionTag) ? null : Tags.TagText.Normalize(CollectionTag).Key,
            Tag = Tag?.Select(Tags.TagText.Normalize).Select(x => x.Key).Distinct().Order().ToArray() ?? [],
            Extension = extensions,
            MediaType = Choice(MediaType, "image", "video", "gif", "motion"),
            Orientation = Choice(Orientation, "landscape", "portrait", "square"),
            Preference = Choice(Preference, "neutral", "liked", "disliked"),
            Availability = Choice(Availability, "present", "missing", "all") ?? "present",
            Seed = Seed ?? (Sort == "shuffle" ? Guid.NewGuid().ToString("N") : null),
            Sort = Choice(Sort, "modified", "captured", "name", "type", "size", "shuffle") ?? "modified",
            Order = Choice(Order, "asc", "desc") ?? "desc",
            GroupBy = Choice(GroupBy, "none", "folder", "date", "type", "tag") ?? "none",
            TagMode = Choice(TagMode, "all", "any") ?? "all",
            Recursive = Recursive ?? false,
            DateFrom = from,
            DateTo = to
        };
    }

    public string Fingerprint() => JsonSerializer.Serialize(this with { Limit = null, Cursor = null });

    public (string Sql, DynamicParameters Parameters) Predicate()
    {
        var conditions = new List<string>();
        var p = new DynamicParameters();
        void Add(string sql, string name, object? value) { if (value is null) return; conditions.Add(sql); p.Add(name, value); }
        if (Availability != "all") Add("m.Availability=@availability", "availability", Availability);
        Add("m.LibraryId=@libraryId", "libraryId", LibraryId);
        Add(Recursive == true ? "m.FolderId IN (SELECT DescendantId FROM FolderAncestry WHERE AncestorId=@folderId)" : "m.FolderId=@folderId", "folderId", FolderId);
        // A library removed from the configuration keeps its rows but is gone from every view.
        conditions.Add("m.LibraryId IN (SELECT Id FROM Libraries WHERE Enabled=1)");
        // Hidden folders drop out of every view, including their descendants.
        conditions.Add($"m.FolderId NOT IN ({Libraries.HiddenFolders.Descendants})");
        // GIFs are indexed as images; "motion" is the Reels set of videos plus animated GIFs.
        if (MediaType == "gif") conditions.Add("m.Extension='.gif'");
        else if (MediaType == "motion") conditions.Add("(m.MediaType='video' OR m.Extension='.gif')");
        else Add("m.MediaType=@mediaType", "mediaType", MediaType);
        Add("m.Id IN (SELECT mt.MediaId FROM MediaTags mt JOIN Tags t ON t.Id=mt.TagId WHERE t.NormalizedKey=@collectionTag)", "collectionTag", CollectionTag);
        Add("m.Preference=@preference", "preference", Preference);
        Add("m.Orientation=@orientation", "orientation", Orientation);
        Add("m.SizeBytes>=@minSize", "minSize", MinSizeBytes); Add("m.SizeBytes<=@maxSize", "maxSize", MaxSizeBytes);
        Add("m.Width>=@minWidth", "minWidth", MinWidth); Add("m.Height>=@minHeight", "minHeight", MinHeight);
        Add("m.Width=@width", "width", Width); Add("m.Height=@height", "height", Height);
        Add("m.AspectRatio>=@minAspect", "minAspect", MinAspectRatio); Add("m.AspectRatio<=@maxAspect", "maxAspect", MaxAspectRatio);
        Add("m.EffectiveTicks>=@from", "from", DateFrom is null ? null : SearchText.Ticks(DateFrom));
        Add("m.EffectiveTicks<@to", "to", DateTo is null ? null : SearchText.Ticks(DateTo));
        if (Extension?.Length > 0) Add("m.Extension IN (SELECT '.'||value FROM json_each(@extensions))", "extensions", JsonSerializer.Serialize(Extension));
        var terms = Q?.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Distinct().ToArray() ?? [];
        for (var index = 0; index < terms.Length; index++)
        {
            var text = terms[index];
            var name = $"q{index}";
            var tagged = $"SELECT MediaId FROM MediaTags INDEXED BY IX_MediaTags_Tag WHERE TagId IN (SELECT Id FROM Tags WHERE instr(NormalizedKey,@{name})>0)";
            if (text.EnumerateRunes().Count() >= 3)
            {
                Add($"""
                    m.Id IN (SELECT rowid FROM MediaSearch WHERE MediaSearch MATCH @{name}Fts
                      AND (instr(NameKey,@{name})>0 OR instr(SearchPath,@{name})>0)
                      UNION {tagged})
                    """, name, text);
                p.Add(name + "Fts", "\"" + text.Replace("\"", "\"\"") + "\"");
            }
            else Add($"(instr(m.NameKey,@{name})>0 OR instr(m.SearchPath,@{name})>0 OR m.Id IN ({tagged}))", name, text);
        }
        if (Path is not null)
        {
            Add("instr(m.SearchPath,@path)>0", "path", Path);
            if (Path.EnumerateRunes().Count() >= 3)
                Add("m.Id IN (SELECT rowid FROM MediaSearch WHERE MediaSearch MATCH @pathFts)", "pathFts",
                    "SearchPath:\"" + Path.Replace("\"", "\"\"") + "\"");
        }
        if (StartsWith is not null) { Add("m.NameKey>=@prefix AND m.NameKey<@prefixEnd AND instr(m.NameKey,@prefix)=1", "prefix", StartsWith); p.Add("prefixEnd", StartsWith + "\U0010FFFF"); }
        if (EndsWith is not null) { var reverse = SearchText.Reverse(EndsWith); Add("m.ReversedName>=@suffix AND m.ReversedName<@suffixEnd AND instr(m.ReversedName,@suffix)=1", "suffix", reverse); p.Add("suffixEnd", reverse + "\U0010FFFF"); }
        if (Tagged is not null) conditions.Add((Tagged == true ? "" : "NOT ") + "EXISTS(SELECT 1 FROM MediaTags mt WHERE mt.MediaId=m.Id)");
        if (Tag?.Length > 0)
        {
            p.Add("tags", JsonSerializer.Serialize(Tag));
            conditions.Add(TagMode == "any" || Tag.Length == 1
                ? "m.Id IN (SELECT mt.MediaId FROM MediaTags mt JOIN Tags t ON t.Id=mt.TagId WHERE t.NormalizedKey IN (SELECT value FROM json_each(@tags)))"
                : "m.Id IN (SELECT mt.MediaId FROM MediaTags mt JOIN Tags t ON t.Id=mt.TagId WHERE t.NormalizedKey IN (SELECT value FROM json_each(@tags)) GROUP BY mt.MediaId HAVING COUNT(*)=json_array_length(@tags))");
        }
        return (conditions.Count == 0 ? "1=1" : string.Join(" AND ", conditions), p);
    }
}
