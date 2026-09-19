using System.Security.Cryptography;
using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Indexing;

namespace Luma.Server.MediaProcessing;

public sealed class GeneratedCache(Database database, IndexingOptions options)
{
    private const long ReservationBytes = 48L * 1024 * 1024;
    private readonly SemaphoreSlim gate = new(1, 1);
    private long reserved;
    private volatile bool underPressure;
    public bool UnderPressure => underPressure;

    public string FilePath(long id, long revision, string variant, int version = IndexingOptions.EncoderVersion) =>
        Path.Combine(options.CachePath, (id % 256).ToString("x2"), id.ToString(), $"{revision}-{version}-{variant}.{(variant == "thumbnail" ? "webp" : "jpg")}");

    public async Task<bool> ReserveAsync(CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            await using var db = await database.OpenAsync(ct);
            var bytes = await db.ExecuteScalarAsync<long>(new CommandDefinition("SELECT SizeBytes FROM CacheAccounting WHERE Id=1", cancellationToken: ct));
            var free = new DriveInfo(options.CachePath).AvailableFreeSpace;
            underPressure = bytes + reserved + ReservationBytes > options.CacheQuotaBytes || free - reserved - ReservationBytes < options.ReserveFreeBytes;
            if (underPressure) return false;
            reserved += ReservationBytes;
            return true;
        }
        finally { gate.Release(); }
    }
    public async Task ReleaseAsync(CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try { reserved -= ReservationBytes; }
        finally { gate.Release(); }
    }

    public async Task<bool> PublishAsync(ProcessingJob job, MediaMetadata metadata, IReadOnlyList<GeneratedVariant> variants, CancellationToken ct)
    {
        var entries = new List<CacheEntry>();
        foreach (var variant in variants)
        {
            await using var stream = File.OpenRead(variant.TemporaryPath);
            var hash = Convert.ToHexString(await SHA256.HashDataAsync(stream, ct));
            entries.Add(new CacheEntry { MediaId = job.MediaId, SourceRevision = job.SourceRevision, Variant = variant.Variant,
                EncoderVersion = IndexingOptions.EncoderVersion, State = "ready", SizeBytes = stream.Length, Width = variant.Width, Height = variant.Height,
                ContentHash = hash, RelativePath = Path.GetRelativePath(options.CachePath, FilePath(job.MediaId, job.SourceRevision, variant.Variant)) });
        }
        await gate.WaitAsync(ct);
        try
        {
            await using var db = await database.OpenAsync(ct);
            using var tx = db.BeginTransaction();
            if (!await db.ExecuteScalarAsync<bool>(new CommandDefinition("""
                SELECT EXISTS(SELECT 1 FROM ProcessingJobs j JOIN Media m ON m.Id=j.MediaId JOIN Scans s ON s.Id=j.ScanId
                WHERE j.MediaId=@MediaId AND j.SourceRevision=@SourceRevision AND j.EncoderVersion=@EncoderVersion AND j.Claim=@Claim
                  AND j.State='running' AND m.SourceRevision=j.SourceRevision AND s.State IN ('running','completed'))
                """, job, tx, cancellationToken: ct))) return false;
            foreach (var entry in entries)
            {
                var variant = variants.Single(x => x.Variant == entry.Variant);
                File.Move(variant.TemporaryPath, Path.Combine(options.CachePath, entry.RelativePath), overwrite: true);
                await db.ExecuteAsync(new CommandDefinition("""
                    INSERT INTO CacheEntries(MediaId,SourceRevision,Variant,EncoderVersion,State,RelativePath,SizeBytes,Width,Height,ContentHash,LastAccessAt)
                    VALUES(@MediaId,@SourceRevision,@Variant,@EncoderVersion,'ready',@RelativePath,@SizeBytes,@Width,@Height,@ContentHash,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                    ON CONFLICT(MediaId,SourceRevision,Variant,EncoderVersion) DO UPDATE SET State='ready',SizeBytes=excluded.SizeBytes,
                      Width=excluded.Width,Height=excluded.Height,ContentHash=excluded.ContentHash,LastAccessAt=excluded.LastAccessAt;
                    """, entry, tx, cancellationToken: ct));
            }
            await db.ExecuteAsync(new CommandDefinition("""
                UPDATE Media SET Width=@Width,Height=@Height,DurationMs=@DurationMs,CapturedAt=@CapturedAt,
                  EffectiveDate=COALESCE(@CapturedAt,ModifiedAt),ProcessingStatus='ready' WHERE Id=@MediaId AND SourceRevision=@SourceRevision;
                UPDATE ProcessingJobs SET State=CASE WHEN WantPreview=1 AND NOT @previewed THEN 'pending' ELSE 'ready' END,
                  Claim=NULL,LeaseUntil=NULL,FailureCode=NULL
                  WHERE MediaId=@MediaId AND SourceRevision=@SourceRevision AND EncoderVersion=@EncoderVersion AND Claim=@Claim;
                """, new { job.MediaId, job.SourceRevision, job.EncoderVersion, job.Claim, metadata.Width, metadata.Height, metadata.DurationMs, metadata.CapturedAt,
                    // A preview requested while a thumbnail-only job was running stays queued (at its priority).
                    previewed = variants.Any(x => x.Variant == "preview") }, tx, cancellationToken: ct));
            tx.Commit();
            return true;
        }
        finally { gate.Release(); }
    }

    public async Task MaintainAsync(CancellationToken ct)
    {
        // Keyset batches keep verification memory bounded independently of cache size.
        long after = 0;
        while (true)
        {
            await using var db = await database.OpenAsync(ct);
            var entries = (await db.QueryAsync<CacheEntry>(new CommandDefinition("""
                SELECT c.rowid RowId,c.*,m.SourceRevision CurrentRevision FROM CacheEntries c JOIN Media m ON m.Id=c.MediaId
                WHERE c.rowid>@after ORDER BY c.rowid LIMIT 100
                """, new { after }, cancellationToken: ct))).ToArray();
            if (entries.Length == 0) break;
            foreach (var entry in entries)
            {
                ct.ThrowIfCancellationRequested();
                after = entry.RowId;
                await gate.WaitAsync(ct);
                try
                {
                    var path = Path.Combine(options.CachePath, entry.RelativePath);
                    if (entry.SourceRevision != entry.CurrentRevision || entry.EncoderVersion != IndexingOptions.EncoderVersion)
                    {
                        File.Delete(path);
                        await db.ExecuteAsync(new CommandDefinition("DELETE FROM CacheEntries WHERE rowid=@RowId", entry, cancellationToken: ct));
                        continue;
                    }
                    if (entry.State != "ready")
                    {
                        // Evicted previews need explicit demand, not periodic regeneration. Remove any file left
                        // behind (eviction by migration marks rows only), unless it was regenerated meanwhile.
                        if (await db.ExecuteScalarAsync<string>(new CommandDefinition("SELECT State FROM CacheEntries WHERE rowid=@RowId", entry, cancellationToken: ct)) is not "ready")
                            File.Delete(path);
                        continue;
                    }
                    // A length check catches missing and truncated files. Hashing every cached byte on each
                    // pass read the whole cache back from disk; the hash still serves as the ETag.
                    var file = new FileInfo(path);
                    var valid = file.Exists && file.Length == entry.SizeBytes;
                    if (!valid)
                    {
                        File.Delete(path);
                        await db.ExecuteAsync(new CommandDefinition("""
                            UPDATE CacheEntries SET State='missing',SizeBytes=0 WHERE rowid=@RowId AND ContentHash=@ContentHash;
                            UPDATE ProcessingJobs SET State='pending',NextAttemptAt=@now,Attempts=0,FailureCode=NULL
                            WHERE MediaId=@MediaId AND SourceRevision=@SourceRevision AND EncoderVersion=@EncoderVersion AND State IN ('ready','failed');
                            """, new { entry.RowId, entry.ContentHash, entry.MediaId, entry.SourceRevision, entry.EncoderVersion, now = DateTimeOffset.UtcNow.ToString("O") }, cancellationToken: ct));
                    }
                }
                finally { gate.Release(); }
            }
            await Task.Delay(20, ct);
        }
        await RemoveOrphansAsync(ct);
        await EvictAsync(ct);
    }

    private async Task RemoveOrphansAsync(CancellationToken ct)
    {
        // Cache-only traversal; never follows reparse points or touches source media.
        var enumeration = new EnumerationOptions { RecurseSubdirectories = true, AttributesToSkip = FileAttributes.ReparsePoint, IgnoreInaccessible = false };
        foreach (var batch in Directory.EnumerateFiles(options.CachePath, "*", enumeration).Chunk(100))
        {
            ct.ThrowIfCancellationRequested();
            await gate.WaitAsync(ct);
            try
            {
                await using var db = await database.OpenAsync(ct);
                var relatives = batch.Select(x => Path.GetRelativePath(options.CachePath, x)).ToArray();
                var known = (await db.QueryAsync<string>(new CommandDefinition("SELECT RelativePath FROM CacheEntries WHERE RelativePath IN @relatives", new { relatives }, cancellationToken: ct))).ToHashSet();
                foreach (var path in batch)
                    if (!known.Contains(Path.GetRelativePath(options.CachePath, path)) && File.GetLastWriteTimeUtc(path) < DateTime.UtcNow.AddMinutes(-10)) File.Delete(path);
            }
            finally { gate.Release(); }
            await Task.Delay(20, ct);
        }
    }

    public async Task EvictAsync(CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            await using var db = await database.OpenAsync(ct);
            var bytes = await db.ExecuteScalarAsync<long>(new CommandDefinition("SELECT SizeBytes FROM CacheAccounting WHERE Id=1", cancellationToken: ct));
            var free = new DriveInfo(options.CachePath).AvailableFreeSpace;
            if (bytes < options.CacheQuotaBytes * .9 && free - reserved - ReservationBytes >= options.ReserveFreeBytes) { underPressure = false; return; }
            underPressure = true;
            while (bytes > options.CacheQuotaBytes * .8 || free - reserved - ReservationBytes < options.ReserveFreeBytes)
            {
                var entries = (await db.QueryAsync<CacheEntry>(new CommandDefinition("""
                    SELECT * FROM CacheEntries WHERE State='ready' ORDER BY CASE Variant WHEN 'preview' THEN 0 ELSE 1 END,LastAccessAt LIMIT 100
                    """, cancellationToken: ct))).ToArray();
                if (entries.Length == 0) break;
                foreach (var entry in entries)
                {
                    File.Delete(Path.Combine(options.CachePath, entry.RelativePath));
                    await db.ExecuteAsync(new CommandDefinition("""
                        UPDATE CacheEntries SET State='evicted',SizeBytes=0 WHERE MediaId=@MediaId AND SourceRevision=@SourceRevision AND Variant=@Variant AND EncoderVersion=@EncoderVersion
                        """, entry, cancellationToken: ct));
                    bytes -= entry.SizeBytes;
                    free += entry.SizeBytes;
                    if (bytes <= options.CacheQuotaBytes * .8 && free - reserved - ReservationBytes >= options.ReserveFreeBytes) break;
                }
            }
            underPressure = bytes + reserved + ReservationBytes > options.CacheQuotaBytes || free - reserved - ReservationBytes < options.ReserveFreeBytes;
        }
        finally { gate.Release(); }
    }
}

public sealed class CacheEntry
{
    public long RowId { get; set; }
    public long MediaId { get; set; }
    public long SourceRevision { get; set; }
    public long CurrentRevision { get; set; }
    public string Variant { get; set; } = "";
    public int EncoderVersion { get; set; }
    public string State { get; set; } = "";
    public string RelativePath { get; set; } = "";
    public long SizeBytes { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public string ContentHash { get; set; } = "";
}
