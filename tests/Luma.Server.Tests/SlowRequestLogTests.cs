using System.Collections.Concurrent;
using Luma.Server.Http;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Luma.Server.Tests;

public sealed class SlowRequestLogTests
{
    [Theory]
    // A threshold nothing can beat reports the request; the default leaves /api/status alone.
    [InlineData("1", true)]
    [InlineData(null, false)]
    // Zero switches it off, so even a request over the threshold says nothing.
    [InlineData("0", false)]
    public async Task Only_requests_over_the_threshold_are_reported(string? threshold, bool expected)
    {
        await using var f = await PipelineFixture.CreateAsync();
        var messages = new ConcurrentQueue<string>();
        await using var host = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing")
                .UseSetting("Luma:DatabasePath", f.Database.Path).UseSetting("Luma:Indexing:CachePath", f.Options.CachePath)
                .UseSetting("Luma:Indexing:Libraries:0:Id", "1").UseSetting("Luma:Indexing:Libraries:0:Name", "Test")
                .UseSetting("Luma:Indexing:Libraries:0:Path", f.Root.Path);
            if (threshold is not null) builder.UseSetting("Luma:SlowRequestMs", threshold);
            builder.ConfigureServices(services => services.AddSingleton<ILoggerProvider>(new CaptureProvider(messages)));
        });

        Assert.True((await host.CreateClient().GetAsync("/api/status")).IsSuccessStatusCode);

        var reported = messages.Where(message => message.Contains("took")).ToArray();
        Assert.Equal(expected, reported.Length > 0);
        if (!expected) return;
        // The route pattern, not the path: nothing from the library reaches the log.
        var line = Assert.Single(reported);
        Assert.Contains("GET /api/status", line);
        // One request on its own found itself alone, and says so.
        Assert.Contains("on arrival 1 requests were in flight, 1 for this path", line);
        Assert.Contains("thread pool", line);
    }

    // A request that is slow because copies of it are queued behind each other is a different bug
    // from one that is slow on its own, so the line has to tell them apart.
    [Fact]
    public async Task A_request_reports_the_company_it_arrived_to()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var messages = new ConcurrentQueue<string>();
        await using var host = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder
            .UseEnvironment("Testing")
            .UseSetting("Luma:DatabasePath", f.Database.Path).UseSetting("Luma:Indexing:CachePath", f.Options.CachePath)
            .UseSetting("Luma:Indexing:Libraries:0:Id", "1").UseSetting("Luma:Indexing:Libraries:0:Name", "Test")
            .UseSetting("Luma:Indexing:Libraries:0:Path", f.Root.Path)
            .UseSetting("Luma:SlowRequestMs", "1")
            .ConfigureServices(services => services.AddSingleton<ILoggerProvider>(new CaptureProvider(messages))));

        using var client = host.CreateClient();
        int[] Counts() => messages.Where(message => message.Contains("for this path"))
            .Select(message => int.Parse(message.Split("on arrival ")[1].Split(' ')[0])).ToArray();

        // Whether requests fired together actually overlap is up to the scheduler, and under a
        // loaded machine a burst can be served one at a time. Repeating the burst makes the test
        // depend on overlap happening at all rather than on it happening the first time.
        var counts = Array.Empty<int>();
        for (var attempt = 0; attempt < 10 && (counts.Length == 0 || counts.Max() == 1); attempt++)
        {
            await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => client.GetAsync("/api/status")));
            counts = Counts();
        }
        Assert.NotEmpty(counts);
        Assert.True(counts.Max() > 1, $"in-flight counts were {string.Join(",", counts)}");
        // The tally is returned rather than leaked: a request made once the burst has drained
        // finds itself alone again. The test server hands the client its response before the
        // pipeline has finished unwinding, so this settles rather than reading straight away.
        var alone = 0;
        for (var attempt = 0; attempt < 50 && alone != 1; attempt++)
        {
            await Task.Delay(20);
            Assert.True((await client.GetAsync("/api/status")).IsSuccessStatusCode);
            alone = Counts().Last();
        }
        Assert.Equal(1, alone);
    }

    [Fact]
    public void The_default_threshold_is_the_one_documented()
    {
        Assert.Equal(500, SlowRequestLog.DefaultThresholdMs);
    }

    private sealed class CaptureProvider(ConcurrentQueue<string> messages) : ILoggerProvider
    {
        public ILogger CreateLogger(string categoryName) =>
            categoryName == "Luma.SlowRequest" ? new Capture(messages) : Microsoft.Extensions.Logging.Abstractions.NullLogger.Instance;
        public void Dispose() { }

        private sealed class Capture(ConcurrentQueue<string> messages) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
            public bool IsEnabled(LogLevel logLevel) => true;
            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? error, Func<TState, Exception?, string> formatter) =>
                messages.Enqueue(formatter(state, error));
        }
    }
}
