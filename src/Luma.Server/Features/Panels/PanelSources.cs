using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Files;
using Luma.Server.Features.Indexing;
using Luma.Server.Http;

namespace Luma.Server.Features.Panels;

public sealed record PanelSourceLocation(long LibraryId, string RelativePath = "", bool ImageFolders = false);
public sealed record PanelSourceConfiguration(bool Configured, IReadOnlyList<PanelSourceLocation> Locations);
public sealed record PanelSourceUpdate(IReadOnlyList<PanelSourceLocation> Locations);
public sealed class PanelSources(Database database, IndexingOptions options, IConfiguration configuration)
{
    public async Task<PanelSourceConfiguration> GetAsync(CancellationToken ct)
    {
        await using var db = await database.OpenAsync(ct);
        var configured = await db.ExecuteScalarAsync<bool>(new CommandDefinition("SELECT EXISTS(SELECT 1 FROM ApplicationState WHERE Key='panelSourcesConfigured')", cancellationToken: ct));
        var locations = (await db.QueryAsync<SourceRow>(new CommandDefinition("SELECT LibraryId,RelativePath,ImageFolders FROM PanelSources ORDER BY LibraryId,PathKey", cancellationToken: ct))).ToArray();
        return new(configured, locations.Select(x => new PanelSourceLocation(x.LibraryId, x.RelativePath, x.ImageFolders)).ToArray());
    }
    public async Task InitializeAsync(CancellationToken ct)
    {
        var defaults = configuration.GetSection("Luma:Panels:Sources").Get<List<PanelSourceLocation>>() ?? [];
        if (defaults.Count != 0 && !(await GetAsync(ct)).Configured) await SaveAsync(defaults, ct);
    }
    public async Task SaveAsync(IReadOnlyList<PanelSourceLocation> locations, CancellationToken ct)
    {
        if (locations.Count > 32) throw ApiRequestException.Invalid("Choose at most 32 comic locations.");
        var normalized = locations.Select(source =>
        {
            var root = options.Libraries.Find(x => x.Id == source.LibraryId) ?? throw ApiRequestException.Missing();
            var path = MutationPaths.Normalize(source.RelativePath, allowRoot: true);
            return new { source.LibraryId, RelativePath = path, PathKey = root.Key(path), source.ImageFolders };
        }).DistinctBy(x => (x.LibraryId, x.PathKey)).ToArray();
        await using var db = await database.OpenAsync(ct);
        using var tx = db.BeginTransaction();
        if (await db.ExecuteScalarAsync<bool>(new CommandDefinition($"SELECT EXISTS(SELECT 1 FROM FileOperations WHERE State IN ({FileOperations.ActiveStates}))", transaction: tx, cancellationToken: ct)))
            throw new ApiRequestException(409, "library_busy", "Finish active file operations before changing comic locations.");
        // Retire old discovery intents. Completed books/progress stay available when a location is re-added.
        await db.ExecuteAsync(new CommandDefinition("UPDATE ComicJobs SET State='cancelled' WHERE State IN ('queued','running'); DELETE FROM PanelSources; INSERT INTO ApplicationState(Key,Value) VALUES('panelSourcesConfigured','1') ON CONFLICT(Key) DO NOTHING;", transaction: tx, cancellationToken: ct));
        foreach (var source in normalized)
        {
            await db.ExecuteAsync(new CommandDefinition("INSERT INTO PanelSources(LibraryId,RelativePath,PathKey,ImageFolders) VALUES(@LibraryId,@RelativePath,@PathKey,@ImageFolders); INSERT INTO ComicJobs(LibraryId,Source,Recursive,ImageFolders,CreatedAt) VALUES(@LibraryId,@RelativePath,1,@ImageFolders,@now)", new { source.LibraryId, source.RelativePath, source.PathKey, source.ImageFolders, now = DateTimeOffset.UtcNow.ToString("O") }, tx, cancellationToken: ct));
        }
        tx.Commit();
    }
    private sealed class SourceRow
    {
        public long LibraryId { get; set; }
        public string RelativePath { get; set; } = "";
        public bool ImageFolders { get; set; }
    }
}
