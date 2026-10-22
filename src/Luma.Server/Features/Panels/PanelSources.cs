using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Files;
using Luma.Server.Features.Indexing;
using Luma.Server.Http;

namespace Luma.Server.Features.Panels;

public sealed record PanelSourceLocation(long LibraryId, string RelativePath = "", bool ImageFolders = false, bool ExcludeFromGallery = true, IReadOnlyList<string>? CoverUrls = null);
public sealed record PanelSourceConfiguration(bool Configured, IReadOnlyList<PanelSourceLocation> Locations);
public sealed record PanelSourceUpdate(IReadOnlyList<PanelSourceLocation> Locations);
public sealed class PanelSources(Database database, IndexingOptions options, IConfiguration configuration)
{
    private const string PauseGallerySql = "UPDATE ProcessingJobs SET State='waiting' WHERE State='pending' AND MediaId IN (SELECT m.Id FROM Media m WHERE m.FolderId IN (" + Luma.Server.Features.Libraries.HiddenFolders.Descendants + "))";
    public async Task<SourceFolderPage> FoldersAsync(long libraryId, string path, string? q, int offset, CancellationToken ct)
    {
        var root = options.Libraries.Find(x => x.Id == libraryId) ?? throw ApiRequestException.Missing();
        path = MutationPaths.Normalize(path, allowRoot: true);
        if (offset is < 0 or > 1000000 || q?.Length > 200) throw ApiRequestException.Invalid();
        if (!string.IsNullOrWhiteSpace(q))
        {
            var key = Luma.Server.Features.Media.SearchText.Key(q.Trim());
            await using var db = await database.OpenAsync(ct);
            var rows = await db.QueryAsync<string>(new CommandDefinition("""
                SELECT RelativePath FROM Folders WHERE LibraryId=@libraryId AND ParentId IS NOT NULL
                  AND ((NameKey>=@key AND NameKey<@end)
                    OR Id IN (SELECT rowid FROM FolderSearch WHERE FolderSearch MATCH @fts LIMIT 200))
                ORDER BY NameKey,Id LIMIT 51
                """, new { libraryId, key, end = key + "\U0010FFFF", fts = "NameKey:\"" + key.Replace("\"", "\"\"") + "\"" }, cancellationToken: ct));
            var found = rows.Select(x => new SourceFolderChoice(x.Split('/')[^1], x)).ToArray();
            return new(found.Take(50).ToArray(), null);
        }
        // Explicit source selection may browse originals, including unindexed comic-only trees.
        // Normal gallery/search and indexed folder search never execute this branch.
        var directory = SourcePaths.Resolve(root, path);
        var items = new List<SourceFolderChoice>();
        foreach (var folder in SourceTraversal.Enumerate(directory, recursive: false).OfType<DirectoryInfo>().Skip(offset))
        {
            ct.ThrowIfCancellationRequested();
            items.Add(new(folder.Name, Path.GetRelativePath(root.Path, folder.FullName).Replace('\\', '/')));
            if (items.Count == 51) break;
        }
        return new(items.Take(50).ToArray(), items.Count > 50 ? offset + 50 : null);
    }
    public async Task<PanelSourceConfiguration> GetAsync(CancellationToken ct)
    {
        await using var db = await database.OpenAsync(ct);
        var configured = await db.ExecuteScalarAsync<bool>(new CommandDefinition("SELECT EXISTS(SELECT 1 FROM ApplicationState WHERE Key='panelSourcesConfigured')", cancellationToken: ct));
        var locations = (await db.QueryAsync<SourceRow>(new CommandDefinition("SELECT LibraryId,RelativePath,ImageFolders,ExcludeFromGallery FROM PanelSources ORDER BY LibraryId,PathKey", cancellationToken: ct))).ToArray();
        var covers = await ComicShelfCovers.LoadAsync(db, options, locations.Select(x => new ComicCoverScope(x.LibraryId, x.RelativePath)), ct);
        return new(configured, locations.Select(x => new PanelSourceLocation(x.LibraryId, x.RelativePath, x.ImageFolders, x.ExcludeFromGallery, covers.GetValueOrDefault((x.LibraryId, x.RelativePath)))).ToArray());
    }
    public async Task InitializeAsync(CancellationToken ct)
    {
        var defaults = configuration.GetSection("Luma:Panels:Sources").Get<List<PanelSourceLocation>>() ?? [];
        if (defaults.Count != 0 && !(await GetAsync(ct)).Configured) await SaveAsync(defaults, ct);
        await using var db = await database.OpenAsync(ct);
        await db.ExecuteAsync(new CommandDefinition(PauseGallerySql, cancellationToken: ct));
    }
    public async Task SaveAsync(IReadOnlyList<PanelSourceLocation> locations, CancellationToken ct)
    {
        if (locations.Count > 32) throw ApiRequestException.Invalid("Choose at most 32 comic locations.");
        var normalized = locations.Select(source =>
        {
            var root = options.Libraries.Find(x => x.Id == source.LibraryId) ?? throw ApiRequestException.Missing();
            var path = MutationPaths.Normalize(source.RelativePath, allowRoot: true);
            return new { source.LibraryId, RelativePath = path, PathKey = root.Key(path), source.ImageFolders, source.ExcludeFromGallery };
        }).DistinctBy(x => (x.LibraryId, x.PathKey)).ToArray();
        await using var db = await database.OpenAsync(ct);
        using var tx = db.BeginTransaction();
        if (await db.ExecuteScalarAsync<bool>(new CommandDefinition($"SELECT EXISTS(SELECT 1 FROM FileOperations WHERE State IN ({FileOperations.ActiveStates}))", transaction: tx, cancellationToken: ct)))
            throw new ApiRequestException(409, "library_busy", "Finish active file operations before changing comic locations.");
        // Retire old discovery intents. Completed books/progress stay available when a location is re-added.
        await db.ExecuteAsync(new CommandDefinition("UPDATE ComicJobs SET State='cancelled' WHERE State IN ('queued','running'); DELETE FROM PanelSources; INSERT INTO ApplicationState(Key,Value) VALUES('panelSourcesConfigured','1') ON CONFLICT(Key) DO NOTHING;", transaction: tx, cancellationToken: ct));
        foreach (var source in normalized)
        {
            await db.ExecuteAsync(new CommandDefinition("INSERT INTO PanelSources(LibraryId,RelativePath,PathKey,ImageFolders,ExcludeFromGallery) VALUES(@LibraryId,@RelativePath,@PathKey,@ImageFolders,@ExcludeFromGallery); INSERT INTO ComicJobs(LibraryId,Source,Recursive,ImageFolders,CreatedAt) VALUES(@LibraryId,@RelativePath,1,@ImageFolders,@now)", new { source.LibraryId, source.RelativePath, source.PathKey, source.ImageFolders, source.ExcludeFromGallery, now = DateTimeOffset.UtcNow.ToString("O") }, tx, cancellationToken: ct));
        }
        // Stop queued Gallery previews for excluded sources without discarding their identities.
        await db.ExecuteAsync(new CommandDefinition(PauseGallerySql, transaction: tx, cancellationToken: ct));
        tx.Commit();
    }
    private sealed class SourceRow
    {
        public long LibraryId { get; set; }
        public string RelativePath { get; set; } = "";
        public bool ImageFolders { get; set; }
        public bool ExcludeFromGallery { get; set; }
    }
}

public sealed record SourceFolderChoice(string Name, string RelativePath);
public sealed record SourceFolderPage(IReadOnlyList<SourceFolderChoice> Items, int? NextOffset);
