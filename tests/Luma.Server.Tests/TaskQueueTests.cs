using System.Net;
using System.Net.Http.Json;
using Dapper;
using Luma.Server.Features.Indexing;
using Luma.Server.Features.Status;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Luma.Server.Tests;

public sealed class TaskQueueTests
{
    [Fact]
    public async Task Terminal_tasks_report_no_progress_and_every_terminal_state_can_be_cleared()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await BrowsingTests.SeedAsync(f, 2);
        await using (var db = await f.Database.OpenAsync(default))
            await db.ExecuteAsync("""
                INSERT INTO Scans(Id,LibraryId,State,StartedAt,FinishedAt,FailureCode) VALUES(20,1,'interrupted','2026-01-02','2026-01-02','interrupted');
                INSERT INTO ProcessingJobs(MediaId,SourceRevision,EncoderVersion,ScanId,MediaType,State,NextAttemptAt,Claim) VALUES(1,0,@version,20,'image','running','2026',NULL);
                INSERT INTO MetadataJobs(Id,Kind,State,Request,CreatedAt,FinishedAt,FailureCode) VALUES
                  (30,'xmp','failed','{}',@now,@now,'interrupted'),
                  (31,'xmp','cancelled','{}',@now,@now,NULL),
                  (32,'xmp','completed','{}',@now,@now,NULL);
                """, new { version = Luma.Server.Features.Indexing.IndexingOptions.EncoderVersion, now = DateTimeOffset.UtcNow.ToString("O") });
        await using var host = Host(f);
        using var client = host.CreateClient();

        var tasks = (await client.GetFromJsonAsync<BackgroundTask[]>("/api/tasks"))!;
        // An interrupted task is terminal: a worker still stopping does not show as pending work.
        Assert.Equal(0, tasks.Single(x => x.Id == "scan-20").Pending);
        Assert.Equal("interrupted", tasks.Single(x => x.Id == "metadata-30").State);

        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/tasks/metadata-31/clear", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync("/api/tasks/metadata-99/clear", null)).StatusCode);
        Assert.DoesNotContain((await client.GetFromJsonAsync<BackgroundTask[]>("/api/tasks"))!, x => x.Id == "metadata-31");

        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/tasks/clear-finished", null)).StatusCode);
        var remaining = (await client.GetFromJsonAsync<BackgroundTask[]>("/api/tasks"))!;
        Assert.DoesNotContain(remaining, x => x.Id is "scan-20" or "metadata-30" or "metadata-32");
    }

    [Fact]
    public async Task An_empty_or_fully_cleared_queue_lists_without_error()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await using var host = Host(f);
        using var client = host.CreateClient();
        // Clearing leaves nothing for SQLite to infer computed column types from.
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/tasks/clear-finished", null)).StatusCode);
        var response = await client.GetAsync("/api/tasks");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty((await response.Content.ReadFromJsonAsync<BackgroundTask[]>())!);
        await using (var db = await f.Database.OpenAsync(default))
            await db.ExecuteAsync("INSERT INTO MetadataJobs(Kind,State,Request,CreatedAt) VALUES('xmp','queued','{}','2099')");
        // A first row whose scope is NULL must map as well.
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/tasks")).StatusCode);
    }

    [Fact]
    public async Task Active_tasks_cannot_be_cleared()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await BrowsingTests.SeedAsync(f, 1);
        await using (var db = await f.Database.OpenAsync(default))
            await db.ExecuteAsync("""
                INSERT INTO ProcessingJobs(MediaId,SourceRevision,EncoderVersion,ScanId,MediaType,State,NextAttemptAt) VALUES(1,0,@version,1,'image','pending','9999');
                """, new { version = Luma.Server.Features.Indexing.IndexingOptions.EncoderVersion });
        await using var host = Host(f);
        using var client = host.CreateClient();
        // A completed scan still preparing previews is running work, not a finished task.
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsync("/api/tasks/scan-1/clear", null)).StatusCode);
    }

    [Fact]
    public async Task A_cleared_scan_is_listed_as_running_again_while_new_preview_work_runs_under_it()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await BrowsingTests.SeedAsync(f, 1);
        await using var host = Host(f);
        using var client = host.CreateClient();
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/tasks/clear-finished", null)).StatusCode);
        Assert.DoesNotContain((await client.GetFromJsonAsync<BackgroundTask[]>("/api/tasks"))!, x => x.Id == "scan-1");

        await using (var db = await f.Database.OpenAsync(default))
            await db.ExecuteAsync("""
                INSERT INTO ProcessingJobs(MediaId,SourceRevision,EncoderVersion,ScanId,MediaType,State,NextAttemptAt) VALUES(1,0,@version,1,'image','pending','9999');
                """, new { version = Luma.Server.Features.Indexing.IndexingOptions.EncoderVersion });
        Assert.Contains((await client.GetFromJsonAsync<BackgroundTask[]>("/api/tasks"))!, x => x.Id == "scan-1" && x.State == "running");
    }

    [Fact]
    public async Task Queue_again_creates_a_new_task_and_retires_the_stopped_one()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await BrowsingTests.SeedAsync(f, 1);
        await using (var db = await f.Database.OpenAsync(default))
            await db.ExecuteAsync("INSERT INTO Scans(Id,LibraryId,State,StartedAt,FinishedAt,FailureCode) VALUES(40,1,'interrupted','2026-01-02','2026-01-02','interrupted')");
        await using var host = Host(f);
        using var client = host.CreateClient();

        var response = await client.PostAsync("/api/tasks/scan-40/queue", null);
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        var queued = (await response.Content.ReadFromJsonAsync<Luma.Server.Features.Indexing.ScanAccepted>())!;
        Assert.NotEqual(40, queued.Id);
        await using var check = await f.Database.OpenAsync(default);
        Assert.Equal("interrupted", await check.ExecuteScalarAsync<string>("SELECT State FROM Scans WHERE Id=40"));
        Assert.DoesNotContain((await client.GetFromJsonAsync<BackgroundTask[]>("/api/tasks"))!, x => x.Id == "scan-40");
    }

    [Fact]
    public async Task Finished_tasks_stop_at_the_most_recent_ten_while_active_work_stays_listed()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await BrowsingTests.SeedAsync(f, 1);
        await using (var db = await f.Database.OpenAsync(default))
        {
            var now = DateTimeOffset.UtcNow.ToString("O");
            // A running scan and a scan whose previews are still being prepared are not finished.
            await db.ExecuteAsync("""
                INSERT INTO Scans(Id,LibraryId,State,StartedAt) VALUES(500,1,'running',@now);
                INSERT INTO Scans(Id,LibraryId,State,StartedAt,FinishedAt) VALUES(501,1,'completed',@now,@now);
                INSERT INTO ProcessingJobs(MediaId,SourceRevision,EncoderVersion,ScanId,MediaType,State,NextAttemptAt) VALUES(1,0,@version,501,'image','pending',@now);
                """, new { now, version = Luma.Server.Features.Indexing.IndexingOptions.EncoderVersion });
            for (var i = 0; i < 14; i++)
                await db.ExecuteAsync("INSERT INTO Scans(LibraryId,State,StartedAt,FinishedAt) VALUES(1,'completed',@now,@now); INSERT INTO MetadataJobs(Kind,State,Request,CreatedAt,FinishedAt) VALUES('xmp','completed','{}',@now,@now)", new { now });
        }
        await using var host = Host(f);
        using var client = host.CreateClient();

        var tasks = (await client.GetFromJsonAsync<BackgroundTask[]>("/api/tasks"))!;
        Assert.Equal(10, tasks.Count(x => x.Kind == "xmp"));
        // The ten most recent finished scans, plus the two that are still working.
        Assert.Equal(12, tasks.Count(x => x.Kind == "indexing"));
        Assert.Contains(tasks, x => x.Id == "scan-500");
        Assert.Contains(tasks, x => x.Id == "scan-501");
        // The oldest finished ones cleared themselves rather than waiting for Clear finished.
        Assert.DoesNotContain(tasks, x => x.Id == "scan-502");
    }

    private static WebApplicationFactory<Program> Host(PipelineFixture f) => new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Testing")
        .UseSetting("Luma:DatabasePath", f.Database.Path).UseSetting("Luma:Indexing:CachePath", f.Options.CachePath)
        .UseSetting("Luma:Indexing:Libraries:0:Id", "1").UseSetting("Luma:Indexing:Libraries:0:Name", "Test").UseSetting("Luma:Indexing:Libraries:0:Path", f.Root.Path));

    // A restart during a scan marks it interrupted, and the processing worker only claims jobs
    // whose scan is running or completed. Jobs left pending under that scan were therefore
    // unclaimable while still counting as outstanding, so the queue carried work it could never
    // finish -- 7,663 of them on one install, untouched across days.
    [Fact]
    public async Task A_restart_during_a_scan_does_not_strand_the_work_it_had_discovered()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await f.CreateImageAsync("one.png");
        await f.CreateImageAsync("two.png");
        await f.ScanAsync();

        await using var db = await f.Database.OpenAsync(default);
        // Put the database back into the shape a kill leaves behind: the scan still running,
        // its jobs pending, one of them claimed by the worker that died with it.
        await db.ExecuteAsync("""
            UPDATE Scans SET State='running',FinishedAt=NULL;
            UPDATE ProcessingJobs SET State='pending',Claim=NULL,LeaseUntil=NULL;
            UPDATE ProcessingJobs SET State='running',Claim='dead',LeaseUntil='2099' WHERE MediaId=(SELECT MIN(MediaId) FROM ProcessingJobs);
            """);

        await new IndexingSetup(f.Database, f.Options).InitializeAsync(default);

        Assert.Equal("interrupted", await db.ExecuteScalarAsync<string>("SELECT State FROM Scans WHERE Id=1"));
        // Nothing is left pending under a scan no worker will ever look at again.
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("""
            SELECT COUNT(*) FROM ProcessingJobs j WHERE j.State='pending'
              AND NOT EXISTS(SELECT 1 FROM Scans s WHERE s.Id=j.ScanId AND s.State IN ('running','completed'))
            """));
        Assert.Equal(2, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM ProcessingJobs WHERE State='waiting' AND Claim IS NULL"));

        // Parked, not abandoned: the scan that resumes after the restart takes the work back.
        var resumed = await db.QuerySingleAsync<ScanRow>(
            "UPDATE Scans SET State='running' WHERE State='queued' RETURNING *");
        await f.Scanner.ScanAsync(resumed, f.Root, default);
        Assert.Equal(2, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM ProcessingJobs WHERE State='pending'"));
        Assert.NotNull(await f.ClaimAsync());
    }
}
