using System.Net;
using System.Net.Http.Json;
using Dapper;
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

    private static WebApplicationFactory<Program> Host(PipelineFixture f) => new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Testing")
        .UseSetting("Luma:DatabasePath", f.Database.Path).UseSetting("Luma:Indexing:CachePath", f.Options.CachePath)
        .UseSetting("Luma:Indexing:Libraries:0:Id", "1").UseSetting("Luma:Indexing:Libraries:0:Name", "Test").UseSetting("Luma:Indexing:Libraries:0:Path", f.Root.Path));
}
