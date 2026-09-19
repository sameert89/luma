using System.Collections.Concurrent;
using Dapper;
using Luma.Server.Data;
using Microsoft.Data.Sqlite;

namespace Luma.Server.Features.Indexing;

public sealed record LibraryRefreshSettings(
    string Mode = "watcher",
    bool RefreshOnOpen = true,
    int PeriodicIntervalMinutes = 60,
    int WatcherDebounceSeconds = 5,
    int FileStabilitySeconds = 10);

/// <summary>
/// Uses filesystem notifications as hints and hands all actual discovery to the existing scan
/// worker. Event storms are coalesced in memory, stable changes are persisted by folder, and at
/// most one ordinary bounded scan per library is ever queued or running.
/// </summary>
public sealed class AutomaticLibraryRefresh(
    Database database,
    IndexingOptions options,
    ILogger<AutomaticLibraryRefresh> logger) : BackgroundService
{
    private readonly ConcurrentDictionary<string, PendingChange> pending = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<long, LibraryRefreshSettings> settings = new();
    private readonly List<FileSystemWatcher> watchers = [];

    public void ApplySettings(long libraryId, LibraryRefreshSettings value)
    {
        settings[libraryId] = value;
        if (value.Mode == "watcher") return;
        var prefix = $"{libraryId}:";
        foreach (var key in pending.Keys.Where(x => x.StartsWith(prefix, StringComparison.Ordinal))) pending.TryRemove(key, out _);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (options.Libraries.Count == 0) return;
        await LoadSettingsAsync(stoppingToken);
        StartWatchers();
        var nextSettingsRefresh = DateTimeOffset.UtcNow.AddSeconds(5);
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    if (DateTimeOffset.UtcNow >= nextSettingsRefresh)
                    {
                        await LoadSettingsAsync(stoppingToken);
                        nextSettingsRefresh = DateTimeOffset.UtcNow.AddSeconds(5);
                    }
                    await FlushStableChangesAsync(stoppingToken);
                    await QueuePeriodicScanAsync(stoppingToken);
                    await ProcessPendingFolderAsync(stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
                catch (SqliteException error) when (Database.IsBusy(error)) { }
                catch (Exception error) { logger.LogWarning(error, "Automatic library refresh will retry"); }
                await Task.Delay(1000, stoppingToken);
            }
        }
        finally
        {
            foreach (var watcher in watchers) watcher.Dispose();
        }
    }

    private async Task LoadSettingsAsync(CancellationToken ct)
    {
        await using var db = await database.OpenAsync(ct);
        var rows = await db.QueryAsync<RefreshRow>(new CommandDefinition("""
            SELECT Id,RefreshMode,RefreshOnOpen,PeriodicIntervalMinutes,WatcherDebounceSeconds,FileStabilitySeconds
            FROM Libraries WHERE Enabled=1
            """, cancellationToken: ct));
        foreach (var row in rows)
            settings[row.Id] = new(row.RefreshMode, row.RefreshOnOpen, row.PeriodicIntervalMinutes,
                row.WatcherDebounceSeconds, row.FileStabilitySeconds);
    }

    private void StartWatchers()
    {
        foreach (var library in options.Libraries)
        {
            try
            {
                var watcher = new FileSystemWatcher(library.Path)
                {
                    Filter = "*",
                    IncludeSubdirectories = true,
                    NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size,
                    InternalBufferSize = 16 * 1024
                };
                watcher.Created += (_, change) => Observe(library, change.FullPath, change.ChangeType);
                watcher.Changed += (_, change) => Observe(library, change.FullPath, change.ChangeType);
                watcher.Deleted += (_, change) => Observe(library, change.FullPath, change.ChangeType);
                watcher.Renamed += (_, change) =>
                {
                    Observe(library, change.OldFullPath, WatcherChangeTypes.Deleted);
                    Observe(library, change.FullPath, WatcherChangeTypes.Created);
                };
                watcher.Error += (_, error) => logger.LogWarning(error.GetException(),
                    "Filesystem watcher overflowed or failed for library {Library}; use Rescan library to reconcile missed changes", library.Name);
                watcher.EnableRaisingEvents = true;
                watchers.Add(watcher);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
            {
                logger.LogWarning(error, "Filesystem watcher is unavailable for library {Library}", library.Name);
            }
        }
    }

    private void Observe(LibraryOptions library, string fullPath, WatcherChangeTypes changeType)
    {
        if (!settings.TryGetValue(library.Id, out var mode) || mode.Mode != "watcher") return;
        try
        {
            var existsAsDirectory = Directory.Exists(fullPath);
            var createdDirectory = changeType == WatcherChangeTypes.Created && existsAsDirectory;
            var affected = createdDirectory ? fullPath : Path.GetDirectoryName(fullPath);
            if (affected is null || !SourcePaths.IsInside(library, affected)) return;
            var relative = Path.GetRelativePath(library.Path, affected).Replace(Path.DirectorySeparatorChar, '/');
            if (relative == ".") relative = "";
            var key = $"{library.Id}:{library.Key(relative)}";
            pending.AddOrUpdate(key,
                _ => new(library, fullPath, relative, createdDirectory, DateTimeOffset.UtcNow.AddSeconds(mode.WatcherDebounceSeconds)),
                (_, previous) => new(library, fullPath, relative, previous.Recursive || createdDirectory,
                    DateTimeOffset.UtcNow.AddSeconds(mode.WatcherDebounceSeconds)));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
        {
            logger.LogDebug(error, "Ignored an unusable filesystem notification for library {Library}", library.Name);
        }
    }

    private async Task FlushStableChangesAsync(CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var (key, change) in pending)
        {
            if (change.NotBefore > now || !pending.TryGetValue(key, out var current) || !ReferenceEquals(change, current)) continue;
            var sample = Sample(change.FullPath);
            var stabilitySeconds = settings.TryGetValue(change.Library.Id, out var mode) ? mode.FileStabilitySeconds : 10;
            if (sample is not null && change.Sample != sample)
            {
                pending[key] = change with { Sample = sample, NotBefore = now.AddSeconds(stabilitySeconds) };
                continue;
            }
            if (!((ICollection<KeyValuePair<string, PendingChange>>)pending).Remove(new(key, change))) continue;
            await QueueDirtyFolderAsync(change.Library.Id, change.RelativePath, change.Library.Key(change.RelativePath),
                change.Recursive, priority: 1, ct);
        }
    }

    private static FileSample? Sample(string path)
    {
        try
        {
            if (Directory.Exists(path)) return new(-1, Directory.GetLastWriteTimeUtc(path).Ticks);
            if (File.Exists(path))
            {
                var file = new FileInfo(path);
                return new(file.Length, file.LastWriteTimeUtc.Ticks);
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
        return null;
    }

    internal async Task QueueDirtyFolderAsync(long libraryId, string relativePath, string pathKey,
        bool recursive, int priority, CancellationToken ct)
    {
        await using var db = await database.OpenAsync(ct);
        await db.ExecuteAsync(new CommandDefinition("""
            INSERT INTO DirtyFolders(LibraryId,RelativePath,PathKey,Recursive,Priority,DetectedAt)
            VALUES(@libraryId,@relativePath,@pathKey,@recursive,@priority,@now)
            ON CONFLICT(LibraryId,PathKey) DO UPDATE SET
              RelativePath=excluded.RelativePath,
              Recursive=MAX(DirtyFolders.Recursive,excluded.Recursive),
              Priority=MAX(DirtyFolders.Priority,excluded.Priority),
              DetectedAt=excluded.DetectedAt
            """, new { libraryId, relativePath, pathKey, recursive, priority, now = DateTimeOffset.UtcNow.ToString("O") },
            cancellationToken: ct));
    }

    internal async Task ProcessPendingFolderAsync(CancellationToken ct)
    {
        await using var db = await database.OpenAsync(ct);
        using var tx = db.BeginTransaction();
        var dirty = await db.QuerySingleOrDefaultAsync<DirtyRow>(new CommandDefinition("""
            SELECT d.* FROM DirtyFolders d JOIN Libraries l ON l.Id=d.LibraryId
            WHERE l.Enabled=1 AND l.RefreshMode='watcher'
              AND NOT EXISTS(SELECT 1 FROM Scans s WHERE s.LibraryId=d.LibraryId AND s.State IN ('queued','running'))
            ORDER BY d.Priority DESC,d.DetectedAt,d.LibraryId LIMIT 1
            """, transaction: tx, cancellationToken: ct));
        if (dirty is null) { tx.Commit(); return; }

        var folderId = await db.QuerySingleOrDefaultAsync<long?>(new CommandDefinition(
            "SELECT Id FROM Folders WHERE LibraryId=@LibraryId AND PathKey=@PathKey", dirty, tx, cancellationToken: ct));
        var resolvedExact = folderId is not null;
        if (!resolvedExact)
        {
            var parent = dirty.RelativePath.Contains('/') ? dirty.RelativePath[..dirty.RelativePath.LastIndexOf('/')] : "";
            var library = options.Libraries.Find(x => x.Id == dirty.LibraryId);
            if (library is null) { tx.Commit(); return; }
            folderId = await db.QuerySingleOrDefaultAsync<long?>(new CommandDefinition(
                "SELECT Id FROM Folders WHERE LibraryId=@LibraryId AND PathKey=@parentKey",
                new { dirty.LibraryId, parentKey = library.Key(parent) }, tx, cancellationToken: ct));
        }
        if (folderId is null) { tx.Commit(); return; }

        var mode = await db.ExecuteScalarAsync<string>(new CommandDefinition(
            "SELECT MetadataMode FROM Libraries WHERE Id=@LibraryId", dirty, tx, cancellationToken: ct));
        var scanId = await db.ExecuteScalarAsync<long>(new CommandDefinition("""
            INSERT INTO Scans(LibraryId,FolderId,Recursive,State,StartedAt,MetadataMode,Priority)
            VALUES(@LibraryId,@folderId,@recursive,'queued',@now,@mode,@Priority) RETURNING Id
            """, new { dirty.LibraryId, folderId, recursive = resolvedExact && dirty.Recursive, now = DateTimeOffset.UtcNow.ToString("O"), mode, dirty.Priority },
            tx, cancellationToken: ct));
        await IndexingEndpoints.QueueMetadataAsync(db, tx, scanId, dirty.LibraryId, folderId, mode, ct,
            recursive: resolvedExact && dirty.Recursive);
        if (resolvedExact)
            await db.ExecuteAsync(new CommandDefinition(
                "DELETE FROM DirtyFolders WHERE LibraryId=@LibraryId AND PathKey=@PathKey", dirty, tx, cancellationToken: ct));
        tx.Commit();
    }

    internal async Task QueuePeriodicScanAsync(CancellationToken ct)
    {
        await using var db = await database.OpenAsync(ct);
        using var tx = db.BeginTransaction();
        var library = await db.QuerySingleOrDefaultAsync<PeriodicRow>(new CommandDefinition("""
            SELECT l.Id,l.MetadataMode FROM Libraries l
            WHERE l.Enabled=1 AND l.RefreshMode='periodic'
              AND (l.LastPeriodicScanAt IS NULL OR unixepoch('now')-unixepoch(l.LastPeriodicScanAt)>=l.PeriodicIntervalMinutes*60)
              AND EXISTS(SELECT 1 FROM Folders f WHERE f.LibraryId=l.Id AND f.PathKey='')
              AND NOT EXISTS(SELECT 1 FROM Scans s WHERE s.LibraryId=l.Id AND s.State IN ('queued','running'))
            ORDER BY COALESCE(l.LastPeriodicScanAt,'') LIMIT 1
            """, transaction: tx, cancellationToken: ct));
        if (library is null) { tx.Commit(); return; }
        var scanId = await db.ExecuteScalarAsync<long>(new CommandDefinition("""
            INSERT INTO Scans(LibraryId,FolderId,Recursive,State,StartedAt,MetadataMode,Priority)
            VALUES(@Id,NULL,0,'queued',@now,@MetadataMode,0) RETURNING Id
            """, new { library.Id, library.MetadataMode, now = DateTimeOffset.UtcNow.ToString("O") }, tx, cancellationToken: ct));
        await IndexingEndpoints.QueueMetadataAsync(db, tx, scanId, library.Id, null, library.MetadataMode, ct, recursive: true);
        await db.ExecuteAsync(new CommandDefinition("UPDATE Libraries SET LastPeriodicScanAt=@now WHERE Id=@Id",
            new { library.Id, now = DateTimeOffset.UtcNow.ToString("O") }, tx, cancellationToken: ct));
        tx.Commit();
    }

    private sealed record PendingChange(LibraryOptions Library, string FullPath, string RelativePath,
        bool Recursive, DateTimeOffset NotBefore, FileSample? Sample = null);
    private sealed record FileSample(long Size, long ModifiedTicks);
    private sealed class RefreshRow
    {
        public long Id { get; set; }
        public string RefreshMode { get; set; } = "watcher";
        public bool RefreshOnOpen { get; set; }
        public int PeriodicIntervalMinutes { get; set; }
        public int WatcherDebounceSeconds { get; set; }
        public int FileStabilitySeconds { get; set; }
    }
    private sealed class DirtyRow
    {
        public long LibraryId { get; set; }
        public string RelativePath { get; set; } = "";
        public string PathKey { get; set; } = "";
        public bool Recursive { get; set; }
        public int Priority { get; set; }
        public string DetectedAt { get; set; } = "";
    }
    private sealed class PeriodicRow
    {
        public long Id { get; set; }
        public string MetadataMode { get; set; } = "embedded";
    }
}
