using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dapper;
using Luma.Server.Features.Tags;
using Luma.Server.Http;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace Luma.Server.Tests;

public sealed class DatabaseContentionTests
{
    [Fact]
    public async Task Metadata_jobs_outlast_a_write_lock_held_past_the_busy_timeout()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await BrowsingTests.SeedAsync(f, 1);
        using var service = new MetadataJobs(f.Database, f.Options, NullLogger<MetadataJobs>.Instance);
        var job = await service.EnqueueAsync("xmp", new MetadataJobRequest([1]), default);

        // Another writer holds SQLite's write lock for longer than the 5 s busy timeout,
        // exactly as the crash-looping deployment did at startup.
        await using (var holder = await f.Database.OpenAsync(default))
        {
            using var tx = holder.BeginTransaction();
            await holder.ExecuteAsync("UPDATE ApplicationState SET Value=Value WHERE Key='instanceId'", transaction: tx);
            await service.StartAsync(default);
            await Task.Delay(TimeSpan.FromSeconds(6));
            // Previously the SqliteException escaped ExecuteAsync and stopped the whole host.
            Assert.False(service.ExecuteTask!.IsCompleted);
            tx.Commit();
        }

        await using var db = await f.Database.OpenAsync(default);
        string? state = null;
        for (var attempt = 0; attempt < 150 && state is not "completed"; attempt++)
        {
            await Task.Delay(100);
            state = await db.ExecuteScalarAsync<string>("SELECT State FROM MetadataJobs WHERE Id=@Id", job);
        }
        Assert.Equal("completed", state);
        await service.StopAsync(default);
    }

    [Fact]
    public async Task A_busy_database_is_a_retryable_503_rather_than_an_internal_error()
    {
        var context = new DefaultHttpContext { RequestServices = new ServiceCollection().AddLogging().BuildServiceProvider() };
        context.Request.Method = "POST";
        context.Request.Path = "/api/media/priority";
        context.Response.Body = new MemoryStream();
        var handled = await new ApiExceptionHandler(NullLogger<ApiExceptionHandler>.Instance)
            .TryHandleAsync(context, new SqliteException("database is locked", 5), default);

        Assert.True(handled);
        Assert.Equal(503, context.Response.StatusCode);
        Assert.Equal("1", context.Response.Headers.RetryAfter.ToString());
        context.Response.Body.Position = 0;
        using var problem = await JsonDocument.ParseAsync(context.Response.Body);
        Assert.Equal("database_busy", problem.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Likes_succeed_promptly_while_background_work_keeps_taking_the_write_lock()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await BrowsingTests.SeedAsync(f, 1);
        await using var host = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Testing")
            .UseSetting("Luma:DatabasePath", f.Database.Path).UseSetting("Luma:Indexing:CachePath", f.Options.CachePath)
            .UseSetting("Luma:Indexing:Libraries:0:Id", "1").UseSetting("Luma:Indexing:Libraries:0:Name", "Test").UseSetting("Luma:Indexing:Libraries:0:Path", f.Root.Path));
        using var client = host.CreateClient();
        var database = host.Services.GetRequiredService<Luma.Server.Data.Database>();

        // A background writer in the shape of indexing: back-to-back short batches that
        // release the lock for only a moment between them.
        using var stop = new CancellationTokenSource();
        var background = Task.Run(async () =>
        {
            await using var db = await database.OpenAsync(default);
            while (!stop.IsCancellationRequested)
            {
                await database.YieldToForegroundAsync(default);
                using var tx = db.BeginTransaction();
                await db.ExecuteAsync("UPDATE ApplicationState SET Value=Value WHERE Key='instanceId'", transaction: tx);
                Thread.Sleep(30);
                tx.Commit();
            }
        });
        try
        {
            await client.GetAsync("/api/status");
            for (var attempt = 0; attempt < 10; attempt++)
            {
                // Let the background writer resume its rhythm before each tap.
                await Task.Delay(100);
                var timer = Stopwatch.StartNew();
                var response = await client.PutAsJsonAsync("/api/media/1/preference", new { preference = attempt % 2 == 0 ? "liked" : "neutral" });
                Assert.True(response.IsSuccessStatusCode, $"{response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
                Assert.True(timer.ElapsedMilliseconds < 1000, $"A like waited {timer.ElapsedMilliseconds} ms behind background writes.");
            }
        }
        finally { await stop.CancelAsync(); await background; }
    }

    [Fact]
    public async Task Interactive_writes_retry_a_locked_database_before_reporting_busy()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var filter = new ForegroundWriteFilter(f.Database, NullLogger<ForegroundWriteFilter>.Instance);
        var context = new DefaultEndpointFilterInvocationContext(new DefaultHttpContext { Request = { Method = "PUT" } });
        var attempts = 0;
        var result = await filter.InvokeAsync(context, _ =>
        {
            Assert.True(f.Database.ForegroundWritePending);
            return ++attempts < 3 ? throw new SqliteException("database is locked", 5) : ValueTask.FromResult<object?>("saved");
        });
        Assert.Equal("saved", result);
        Assert.Equal(3, attempts);
        Assert.False(f.Database.ForegroundWritePending);

        // Retries are bounded: a lock that never clears still reaches the client as busy.
        attempts = 0;
        await Assert.ThrowsAsync<SqliteException>(async () => await filter.InvokeAsync(context, _ => { attempts++; throw new SqliteException("database is locked", 5); }));
        Assert.Equal(4, attempts);
        Assert.False(f.Database.ForegroundWritePending);
    }
}
