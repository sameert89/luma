using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Files;
using Luma.Server.Features.Indexing;
using Luma.Server.Http;
using Microsoft.Data.Sqlite;

namespace Luma.Server.Features.Panels;

/// <summary>Durable Panels hints fed by the existing library watcher, never by browse GETs.</summary>
public sealed class ComicDiscovery(Database database, IndexingOptions options)
{
    internal static Task HintAsync(SqliteConnection db, SqliteTransaction tx, long libraryId, string path, string key, bool recursive, CancellationToken ct) =>
        db.ExecuteAsync(new CommandDefinition("""
            INSERT INTO ComicDirtyFolders(LibraryId,RelativePath,PathKey,Recursive,DetectedAt)
            SELECT @libraryId,@path,@key,@recursive,@now
            WHERE EXISTS(SELECT 1 FROM PanelSources s WHERE s.LibraryId=@libraryId
              AND (s.PathKey='' OR @key=s.PathKey OR (@key>=s.PathKey||'/' AND @key<s.PathKey||'0')
                OR @key='' OR (s.PathKey>=@key||'/' AND s.PathKey<@key||'0')))
            ON CONFLICT(LibraryId,PathKey) DO UPDATE SET Recursive=MAX(ComicDirtyFolders.Recursive,excluded.Recursive),DetectedAt=excluded.DetectedAt
            """, new { libraryId, path, key, recursive, now = DateTimeOffset.UtcNow.ToString("O") }, tx, cancellationToken: ct));

    // The timestamp probe is deliberately outside the writer transaction, like Gallery.
    public async Task RefreshAsync(ComicRegistration request, CancellationToken ct)
    {
        var root = options.Libraries.Find(x => x.Id == request.LibraryId) ?? throw ApiRequestException.Missing();
        var path = MutationPaths.Normalize(request.RelativePath ?? "", true);
        var key = root.Key(path);
        await using var db = await database.OpenAsync(ct);
        if (!await db.ExecuteScalarAsync<bool>(new CommandDefinition("""
            SELECT EXISTS(SELECT 1 FROM PanelSources s JOIN Libraries l ON l.Id=s.LibraryId
              WHERE l.Id=@Id AND l.Enabled=1 AND l.RefreshOnOpen=1
                AND (s.PathKey='' OR @key=s.PathKey OR (@key>=s.PathKey||'/' AND @key<s.PathKey||'0')))
            """, new { root.Id, key }, cancellationToken: ct))) return;
        var previous = await db.ExecuteScalarAsync<long?>(new CommandDefinition("""
            SELECT f.SourceModifiedTicks FROM ComicFolders f JOIN ComicJobs j ON j.Id=f.LastJobId
            WHERE f.LibraryId=@Id AND f.PathKey=@key AND j.State='completed' AND j.Failed=0
            """, new { root.Id, key }, cancellationToken: ct));
        long ticks;
        try
        {
            var source = SourcePaths.Resolve(root, path);
            if (!Directory.Exists(source)) return;
            ticks = Directory.GetLastWriteTimeUtc(source).Ticks;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return; }
        if (previous == ticks) return;
        await database.YieldToForegroundAsync(ct);
        using var tx = db.BeginTransaction();
        await HintAsync(db, tx, root.Id, path, key, false, ct);
        tx.Commit();
    }

    internal async Task ProcessPendingAsync(CancellationToken ct)
    {
        await using var db = await database.OpenAsync(ct);
        // No recurring writer transaction while idle or while Panels is busy.
        var dirty = await db.QueryFirstOrDefaultAsync<DirtyFolder>(new CommandDefinition($"""
            SELECT d.* FROM ComicDirtyFolders d JOIN Libraries l ON l.Id=d.LibraryId
            WHERE l.Enabled=1
              AND NOT EXISTS(SELECT 1 FROM ComicJobs j WHERE j.LibraryId=d.LibraryId AND j.State IN ('queued','running'))
              AND NOT EXISTS(SELECT 1 FROM FileOperations o WHERE o.LibraryId=d.LibraryId AND o.State IN ({FileOperations.ActiveStates}))
            ORDER BY d.DetectedAt,d.LibraryId LIMIT 1
            """, cancellationToken: ct));
        if (dirty is null) return;
        await database.YieldToForegroundAsync(ct);
        using var tx = db.BeginTransaction();
        var sources = await db.QueryAsync<SourceRow>(new CommandDefinition("""
            SELECT LibraryId,RelativePath,ImageFolders,ExcludeFromGallery FROM PanelSources WHERE LibraryId=@LibraryId
            """, dirty, tx, cancellationToken: ct));
        var root = options.Libraries.Find(x => x.Id == dirty.LibraryId);
        if (root is not null)
        {
            var targets = sources.Select(source => new { Source = source, Key = root.Key(source.RelativePath) })
                .Where(item => Under(dirty.PathKey, item.Key) || Under(item.Key, dirty.PathKey))
                .Select(item => new { Path = Under(dirty.PathKey, item.Key) ? dirty.RelativePath : item.Source.RelativePath, item.Source.ImageFolders })
                .GroupBy(item => root.Key(item.Path));
            foreach (var target in targets)
            {
                // Clip ancestor notifications to the source. A routine parent timestamp event
                // stays shallow; only created/moved directory notifications request recursion.
                await db.ExecuteAsync(new CommandDefinition("""
                    INSERT INTO ComicJobs(LibraryId,Source,Recursive,Shallow,Automatic,ImageFolders,CreatedAt)
                    VALUES(@LibraryId,@path,@recursive,@shallow,1,@images,@now) ON CONFLICT DO NOTHING
                    """, new { dirty.LibraryId, path = target.First().Path, recursive = dirty.Recursive, shallow = !dirty.Recursive, images = target.Any(item => item.ImageFolders), now = DateTimeOffset.UtcNow.ToString("O") }, tx, cancellationToken: ct));
            }
        }
        await db.ExecuteAsync(new CommandDefinition("DELETE FROM ComicDirtyFolders WHERE LibraryId=@LibraryId AND PathKey=@PathKey", dirty, tx, cancellationToken: ct));
        tx.Commit();
    }

    // Called inside Gallery's periodic scheduling transaction, so a busy Gallery cannot lose Panels' pass.
    internal static Task QueuePeriodicAsync(SqliteConnection db, SqliteTransaction tx, CancellationToken ct) =>
        db.ExecuteAsync(new CommandDefinition("""
            INSERT INTO ComicJobs(LibraryId,Source,Recursive,Automatic,ImageFolders,CreatedAt)
            SELECT s.LibraryId,s.RelativePath,1,1,s.ImageFolders,@now FROM PanelSources s JOIN Libraries l ON l.Id=s.LibraryId
            WHERE l.Enabled=1 AND l.RefreshMode='periodic'
              AND (s.LastPeriodicScanAt IS NULL OR unixepoch('now')-unixepoch(s.LastPeriodicScanAt)>=l.PeriodicIntervalMinutes*60)
              AND NOT EXISTS(SELECT 1 FROM ComicJobs j WHERE j.LibraryId=s.LibraryId AND COALESCE(j.Source,'')=s.RelativePath AND j.State IN ('queued','running'));
            UPDATE PanelSources SET LastPeriodicScanAt=@now WHERE EXISTS(
              SELECT 1 FROM ComicJobs j WHERE j.LibraryId=PanelSources.LibraryId AND j.Source=PanelSources.RelativePath AND j.CreatedAt=@now AND j.Automatic=1);
            """, new { now = DateTimeOffset.UtcNow.ToString("O") }, tx, cancellationToken: ct));

    internal static bool Under(string key, string parent) => parent.Length == 0 || key == parent || key.StartsWith(parent + '/', StringComparison.Ordinal);
    private sealed class SourceRow
    {
        public string RelativePath { get; set; } = "";
        public bool ImageFolders { get; set; }
    }
    private sealed class DirtyFolder
    {
        public long LibraryId { get; set; }
        public string RelativePath { get; set; } = "";
        public string PathKey { get; set; } = "";
        public bool Recursive { get; set; }
    }
}
