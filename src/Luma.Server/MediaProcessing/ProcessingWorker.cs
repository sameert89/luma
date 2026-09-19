using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Indexing;
using Microsoft.Data.Sqlite;

namespace Luma.Server.MediaProcessing;

public sealed class ProcessingWorker(Database database, IndexingOptions options, MediaProcessor processor,
    GeneratedCache cache, ILogger<ProcessingWorker> logger) : BackgroundService
{
    private readonly SemaphoreSlim aggregate = options.ProcessingSlots;
    protected override Task ExecuteAsync(CancellationToken stoppingToken) => options.Libraries.Count == 0 ? Task.CompletedTask : Task.WhenAll(
        Enumerable.Range(0, options.ImageWorkers).Select(_ => RunAsync("image", stoppingToken))
            .Concat(Enumerable.Range(0, options.VideoWorkers).Select(_ => RunAsync("video", stoppingToken)))
            .Append(MaintainAsync(stoppingToken)));

    private async Task MaintainAsync(CancellationToken ct)
    {
        // The full sweep visits every cache entry and file, so it runs at startup and then daily;
        // the quota check between sweeps is a single query.
        var sweepAfter = DateTimeOffset.MinValue;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                if (DateTimeOffset.UtcNow < sweepAfter) await cache.EvictAsync(ct);
                else
                {
                    await cache.MaintainAsync(ct);
                    sweepAfter = DateTimeOffset.UtcNow.AddHours(24);
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            catch (Exception error) { logger.LogWarning(error, "Cache maintenance will retry"); }
            await Task.Delay(TimeSpan.FromSeconds(options.VerificationIntervalSeconds), ct);
        }
    }

    private async Task RunAsync(string type, CancellationToken ct)
    {
        var recoverAfter = DateTimeOffset.MinValue;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var foundWork = false;
                await aggregate.WaitAsync(ct);
                try
                {
                    await using var db = await database.OpenAsync(ct);
                    if (DateTimeOffset.UtcNow >= recoverAfter)
                    {
                        await db.ExecuteAsync(new CommandDefinition("""
                        UPDATE ProcessingJobs SET State='pending',Claim=NULL,LeaseUntil=NULL
                        WHERE rowid IN (SELECT rowid FROM ProcessingJobs INDEXED BY IX_Jobs_Lease
                          WHERE State='running' AND MediaType=@type AND LeaseUntil<@now LIMIT 200)
                        """, new { type, now = DateTimeOffset.UtcNow.ToString("O") }, cancellationToken: ct));
                        recoverAfter = DateTimeOffset.UtcNow.AddSeconds(30);
                    }
                    var available = await db.ExecuteScalarAsync<bool>(new CommandDefinition("""
                        SELECT EXISTS(SELECT 1 FROM ProcessingJobs INDEXED BY IX_Jobs_Ready
                          WHERE State='pending' AND MediaType=@type AND NextAttemptAt<=@now AND EncoderVersion=@version)
                        """, new { type, now = DateTimeOffset.UtcNow.ToString("O"), version = IndexingOptions.EncoderVersion }, cancellationToken: ct));
                    // Find the candidate with a plain read, then claim it by rowid. Searching inside the
                    // UPDATE held SQLite's single write lock for the whole scan, which on large queues
                    // (many jobs owned by an interrupted scan) starved every other writer past its busy
                    // timeout. The guarded claim keeps two workers from taking the same job.
                    var now = DateTimeOffset.UtcNow.ToString("O");
                    var candidate = !available ? null : await db.ExecuteScalarAsync<long?>(new CommandDefinition("""
                        SELECT j.rowid FROM ProcessingJobs j INDEXED BY IX_Jobs_Ready
                        WHERE j.State='pending' AND j.NextAttemptAt<=@now AND j.MediaType=@type AND j.EncoderVersion=@version
                          AND EXISTS (SELECT 1 FROM Media m JOIN Libraries l ON l.Id=m.LibraryId JOIN Scans s ON s.Id=j.ScanId
                            WHERE m.Id=j.MediaId AND m.SourceRevision=j.SourceRevision AND m.Availability='present'
                              AND l.Enabled=1 AND s.State IN ('running','completed'))
                        ORDER BY j.NextAttemptAt,j.MediaId LIMIT 1
                        """, new { type, version = IndexingOptions.EncoderVersion, now }, cancellationToken: ct));
                    if (candidate is not null) await database.YieldToForegroundAsync(ct);
                    var job = candidate is null ? null : await db.QuerySingleOrDefaultAsync<ProcessingJob>(new CommandDefinition("""
                        UPDATE ProcessingJobs SET State='running',Claim=@claim,LeaseUntil=@lease
                        WHERE rowid=@candidate AND State='pending' AND NextAttemptAt<=@now RETURNING *
                        """, new { candidate, now, claim = Guid.NewGuid().ToString("N"), lease = DateTimeOffset.UtcNow.AddMinutes(2).ToString("O") }, cancellationToken: ct));
                    // Lost a race for this candidate: look again at once rather than idling.
                    if (candidate is not null && job is null) continue;
                    if (job is not null)
                    {
                        foundWork = true;
                        await ProcessAsync(job, type, ct);
                    }
                }
                finally { aggregate.Release(); }
                if (!foundWork) await Task.Delay(500, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            catch (SqliteException error) when (error.SqliteErrorCode is 5 or 6) { await Task.Delay(5000, ct); }
            catch (Exception error)
            {
                logger.LogError(error, "Processing paused; leased work will be retried");
                await Task.Delay(5000, ct);
            }
        }
    }

    public async Task ProcessAsync(ProcessingJob job, string type, CancellationToken ct)
    {
        var reserved = false;
        var inspectingSource = false;
        var temporaries = new List<string>();
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(type == "image" ? 30 : 60));
        using var monitorStop = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var monitor = MonitorScanAsync(job, deadline, monitorStop.Token);
        try
        {
            reserved = await cache.ReserveAsync(deadline.Token);
            if (!reserved) { await SetOutcomeAsync(job, "pending", "cache_pressure", 30, false, ct); return; }
            await using var db = await database.OpenAsync(deadline.Token);
            var source = await db.QuerySingleAsync<SourceRow>(new CommandDefinition("SELECT LibraryId,RelativePath,SizeBytes,ModifiedAt,SourceRevision FROM Media WHERE Id=@MediaId", job, cancellationToken: deadline.Token));
            if (source.SourceRevision != job.SourceRevision) { await SetOutcomeAsync(job, "obsolete", null, 0, false, ct); return; }
            var root = options.Libraries.Single(x => x.Id == source.LibraryId);
            inspectingSource = true;
            var path = SourcePaths.Resolve(root, source.RelativePath);
            CheckRevision(path, source);
            inspectingSource = false;
            // Indexing prepares thumbnails; an image's preview waits until someone opens it.
            foreach (var variant in type == "video" ? ["thumbnail", "poster"] : job.WantPreview ? new[] { "thumbnail", "preview" } : ["thumbnail"])
            {
                var output = cache.FilePath(job.MediaId, job.SourceRevision, variant);
                Directory.CreateDirectory(Path.GetDirectoryName(output)!);
                var temporary = output + "." + Guid.NewGuid().ToString("N") + ".tmp";
                temporaries.Add(temporary);
            }
            var result = await processor.ProcessAsync(path, type, temporaries[0], temporaries.ElementAtOrDefault(1), deadline.Token);
            inspectingSource = true;
            SourcePaths.Check(root, path);
            CheckRevision(path, source);
            inspectingSource = false;
            if (!await cache.PublishAsync(job, result.Metadata!, result.Variants, deadline.Token))
                await SetOutcomeAsync(job, "pending", null, 0, false, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        { await SetOutcomeAsync(job, "pending", null, 0, false, CancellationToken.None); }
        catch (OperationCanceledException)
        {
            if (job.ScanCancelled) await SetOutcomeAsync(job, "waiting", null, 0, false, ct);
            else await FailAsync(job, "processing_timeout", true, ct);
        }
        catch (ProcessingException error) { await FailAsync(job, error.Code, error.Transient, ct); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            if (inspectingSource) await SetOutcomeAsync(job, "waiting", "source_unavailable", 0, true, ct);
            else await FailAsync(job, "cache_io", true, ct);
        }
        finally
        {
            await monitorStop.CancelAsync();
            // A failed monitor must not skip the cleanup below, or the cache reservation leaks for good.
            try { await monitor; }
            catch (OperationCanceledException) { }
            catch (Exception error) { logger.LogWarning(error, "Scan monitor failed while processing media {MediaId}", job.MediaId); }
            foreach (var temporary in temporaries)
                try { File.Delete(temporary); }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException)
                { logger.LogWarning(error, "Temporary cache cleanup will be retried by maintenance"); }
            if (reserved) await cache.ReleaseAsync(CancellationToken.None);
        }
    }

    private async Task MonitorScanAsync(ProcessingJob job, CancellationTokenSource deadline, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await Task.Delay(500, ct);
            await using var db = await database.OpenAsync(ct);
            var state = await db.ExecuteScalarAsync<string>(new CommandDefinition("""
                SELECT s.State FROM ProcessingJobs j JOIN Scans s ON s.Id=j.ScanId
                WHERE j.MediaId=@MediaId AND j.SourceRevision=@SourceRevision AND j.EncoderVersion=@EncoderVersion AND j.Claim=@Claim
                """, job, cancellationToken: ct));
            if (state is null or "cancelled" or "interrupted" or "failed")
            {
                job.ScanCancelled = true;
                await deadline.CancelAsync();
                return;
            }
        }
    }

    private static void CheckRevision(string path, SourceRow source)
    {
        var info = new FileInfo(path);
        if (info.Length != source.SizeBytes || info.LastWriteTimeUtc.ToString("O") != source.ModifiedAt)
            throw new ProcessingException("source_changed");
    }
    private Task FailAsync(ProcessingJob job, string code, bool transient, CancellationToken ct)
    {
        if (code is "source_changed" or "source_unavailable") return SetOutcomeAsync(job, "waiting", code, 0, true, ct);
        var delay = job.Attempts switch { 0 => 5, 1 => 30, _ => 300 };
        return SetOutcomeAsync(job, transient && job.Attempts < 3 ? "pending" : "failed", code, delay, true, ct);
    }
    private async Task SetOutcomeAsync(ProcessingJob job, string state, string? code, int delay, bool failure, CancellationToken ct)
    {
        await database.YieldToForegroundAsync(ct);
        await using var db = await database.OpenAsync(ct);
        using var tx = db.BeginTransaction();
        var changed = await db.ExecuteAsync(new CommandDefinition("""
            UPDATE ProcessingJobs SET State=@state,FailureCode=@code,Attempts=Attempts+@increment,NextAttemptAt=@next,Claim=NULL,LeaseUntil=NULL
            WHERE MediaId=@MediaId AND SourceRevision=@SourceRevision AND EncoderVersion=@EncoderVersion AND Claim=@Claim;
            """, new { job.MediaId, job.SourceRevision, job.EncoderVersion, job.Claim, state, code, increment = failure ? 1 : 0,
                next = DateTimeOffset.UtcNow.AddSeconds(delay).ToString("O") }, tx, cancellationToken: ct));
        if (changed > 0)
        {
            await db.ExecuteAsync(new CommandDefinition("UPDATE Media SET ProcessingStatus=@state WHERE Id=@MediaId AND SourceRevision=@SourceRevision",
                new { job.MediaId, job.SourceRevision, state }, tx, cancellationToken: ct));
            if (failure)
                await db.ExecuteAsync(new CommandDefinition("""
                    INSERT INTO ProcessingFailures(ScanId,MediaId,Code,OccurredAt)
                    SELECT ScanId,MediaId,@code,@now FROM ProcessingJobs
                    WHERE MediaId=@MediaId AND SourceRevision=@SourceRevision AND EncoderVersion=@EncoderVersion
                    """, new { job.MediaId, job.SourceRevision, job.EncoderVersion, code, now = DateTimeOffset.UtcNow.ToString("O") }, tx, cancellationToken: ct));
        }
        tx.Commit();
    }
    private sealed record SourceRow(long LibraryId, string RelativePath, long SizeBytes, string ModifiedAt, long SourceRevision);
}

public sealed class ProcessingJob
{
    public long MediaId { get; set; }
    public long SourceRevision { get; set; }
    public int EncoderVersion { get; set; }
    public long ScanId { get; set; }
    public int Attempts { get; set; }
    public bool WantPreview { get; set; }
    public string Claim { get; set; } = "";
    public bool ScanCancelled { get; set; }
}
