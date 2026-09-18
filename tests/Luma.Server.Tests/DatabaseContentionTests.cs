using System.Text.Json;
using Dapper;
using Luma.Server.Features.Tags;
using Luma.Server.Http;
using Microsoft.AspNetCore.Http;
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
}
