using Dapper;
using Luma.Server.Data;

namespace Luma.Server.Features.Indexing;

public sealed class IndexingOptions
{
    private SemaphoreSlim? processingSlots;
    internal SemaphoreSlim ProcessingSlots => LazyInitializer.EnsureInitialized(ref processingSlots,()=>new SemaphoreSlim(ProcessingWorkers,ProcessingWorkers));
    public List<LibraryOptions> Libraries { get; set; } = [];
    public string CachePath { get; set; } = ".local/cache";
    public string FfmpegPath { get; set; } = "ffmpeg";
    public string FfprobePath { get; set; } = "ffprobe";
    public int DiscoveryWorkers { get; set; } = 1;
    // Decoders run below normal OS priority, so background work can use every idle core of a
    // 4-core server while browse requests are still scheduled first. Unless configured, image
    // workers follow the aggregate limit, leaving one slot for video and keyword work.
    private int? imageWorkers;
    public int ImageWorkers { get => imageWorkers ?? Math.Max(1, ProcessingWorkers - 1); set => imageWorkers = value; }
    public int VideoWorkers { get; set; } = 1;
    public int ProcessingWorkers { get; set; } = 4;
    public int QueueCapacity { get; set; } = 128;
    public long CacheQuotaBytes { get; set; } = 20L * 1024 * 1024 * 1024;
    public long ReserveFreeBytes { get; set; } = 1024L * 1024 * 1024;
    public int VerificationIntervalSeconds { get; set; } = 300;
    public const int EncoderVersion = 1;

    public void Validate(string contentRoot, string databasePath)
    {
        if (new[] { DiscoveryWorkers, ImageWorkers, VideoWorkers, ProcessingWorkers }.Any(x => x is < 1 or > 4)
            || ImageWorkers > ProcessingWorkers || VideoWorkers > ProcessingWorkers
            || QueueCapacity is < 16 or > 1024 || CacheQuotaBytes < 1024L * 1024 * 1024
            || ReserveFreeBytes < 1024L * 1024 * 1024 || VerificationIntervalSeconds < 1)
            throw new InvalidOperationException("Invalid indexing resource limits.");
        CachePath = Path.GetFullPath(CachePath, contentRoot);
        foreach (var root in Libraries)
        {
            if (root.Id <= 0 || root.Id > 9_007_199_254_740_991 || string.IsNullOrWhiteSpace(root.Name)
                || !Path.IsPathFullyQualified(root.Path))
                throw new InvalidOperationException("Libraries require a positive stable ID, name and absolute path.");
            root.Path = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root.Path));
            if (Overlaps(root.Path, CachePath) || Overlaps(root.Path, databasePath))
                throw new InvalidOperationException("Application data must be outside media roots.");
            // Check existing ancestors too: a root below a symlink is not a safe boundary.
            for (var directory = new DirectoryInfo(root.Path); directory is not null; directory = directory.Parent)
                if (directory.Exists && directory.Attributes.HasFlag(FileAttributes.ReparsePoint))
                    throw new InvalidOperationException("Media roots cannot contain symlink ancestors.");
        }
        for (var i = 0; i < Libraries.Count; i++)
            for (var j = i + 1; j < Libraries.Count; j++)
                if (Libraries[i].Id == Libraries[j].Id || Overlaps(Libraries[i].Path, Libraries[j].Path))
                    throw new InvalidOperationException("Library IDs and roots must be distinct and non-overlapping.");
    }

    private static bool Overlaps(string left, string right) => Inside(left, right) || Inside(right, left);
    private static bool Inside(string parent, string child) =>
        string.Equals(parent, child, StringComparison.OrdinalIgnoreCase)
        || child.StartsWith(Path.TrimEndingDirectorySeparator(parent) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
}

public sealed class LibraryOptions
{
    public long Id { get; set; }
    public string Name { get; set; } = "";
    public string Path { get; set; } = "";
    public bool CaseSensitive { get; set; } = !OperatingSystem.IsWindows();
    // A configured path is not consent to immediately consume a large library.
    // First indexing is initiated from the library card or an explicit scan command.
    public bool ScanOnStartup { get; set; }
    public string Key(string relativePath) => CaseSensitive ? relativePath : relativePath.ToUpperInvariant();
}

public sealed class IndexingSetup(Database database, IndexingOptions options)
{
    public async Task InitializeAsync(CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(options.CachePath);
        await using var db = await database.OpenAsync(cancellationToken);
        using var tx = db.BeginTransaction();
        var previousVersion = await db.ExecuteScalarAsync<string>(new CommandDefinition(
            "SELECT Value FROM ApplicationState WHERE Key='cacheEncoderVersion'", transaction: tx, cancellationToken: cancellationToken));
        var encoderChanged = previousVersion is not null && previousVersion != IndexingOptions.EncoderVersion.ToString();
        await db.ExecuteAsync(new CommandDefinition("""
            UPDATE Libraries SET Enabled=0;
            UPDATE Scans SET State='interrupted', FinishedAt=@now, FailureCode='interrupted' WHERE State='running';
            UPDATE ProcessingJobs SET State='pending', Claim=NULL, LeaseUntil=NULL WHERE State='running';
            """, new { now = DateTimeOffset.UtcNow.ToString("O") }, tx, cancellationToken: cancellationToken));
        foreach (var root in options.Libraries)
        {
            var existing = await db.QuerySingleOrDefaultAsync<LibraryOptions>(new CommandDefinition(
                "SELECT Id, Path, CaseSensitive FROM Libraries WHERE Id=@Id", root, tx, cancellationToken: cancellationToken));
            if (existing is not null && (existing.Path != root.Path || existing.CaseSensitive != root.CaseSensitive))
                throw new InvalidOperationException("An existing library ID cannot change its root or path comparison policy.");
            await db.ExecuteAsync(new CommandDefinition("""
                INSERT INTO Libraries(Id,Name,Path,CaseSensitive) VALUES(@Id,@Name,@Path,@CaseSensitive)
                ON CONFLICT(Id) DO UPDATE SET Name=excluded.Name, Enabled=1;
                INSERT INTO Scans(LibraryId,FolderId,Recursive,State,Force,RetryFailures,StartedAt,MetadataMode)
                SELECT @Id,CASE WHEN NOT @ScanOnStartup AND NOT @encoderChanged THEN
                  (SELECT FolderId FROM Scans WHERE LibraryId=@Id AND State='interrupted' ORDER BY Id DESC LIMIT 1) ELSE NULL END,
                  CASE WHEN NOT @ScanOnStartup AND NOT @encoderChanged THEN
                  COALESCE((SELECT Recursive FROM Scans WHERE LibraryId=@Id AND State='interrupted' ORDER BY Id DESC LIMIT 1),0) ELSE 0 END,'queued',
                  COALESCE((SELECT Force FROM Scans WHERE LibraryId=@Id AND State='interrupted' AND Id=(SELECT MAX(Id) FROM Scans WHERE LibraryId=@Id)),0),
                  COALESCE((SELECT RetryFailures FROM Scans WHERE LibraryId=@Id AND State='interrupted' AND Id=(SELECT MAX(Id) FROM Scans WHERE LibraryId=@Id)),0),@now,(SELECT MetadataMode FROM Libraries WHERE Id=@Id) WHERE
                  (@ScanOnStartup OR @encoderChanged OR (SELECT State FROM Scans WHERE LibraryId=@Id ORDER BY Id DESC LIMIT 1)='interrupted')
                  AND NOT EXISTS(SELECT 1 FROM Scans WHERE LibraryId=@Id AND State IN ('queued','running'));
                """, new { root.Id, root.Name, root.Path, root.CaseSensitive, root.ScanOnStartup, encoderChanged, now = DateTimeOffset.UtcNow.ToString("O") }, tx,
                cancellationToken: cancellationToken));
        }
        await db.ExecuteAsync(new CommandDefinition("""
            UPDATE ProcessingJobs SET State='waiting' WHERE State='pending' AND MediaId IN
              (SELECT m.Id FROM Media m JOIN Libraries l ON l.Id=m.LibraryId WHERE l.Enabled=0);
            INSERT INTO ApplicationState(Key,Value) VALUES('cacheEncoderVersion',@version)
            ON CONFLICT(Key) DO UPDATE SET Value=excluded.Value
            """, new { version = IndexingOptions.EncoderVersion.ToString() }, tx, cancellationToken: cancellationToken));
        tx.Commit();
    }
}
