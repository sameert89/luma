using System.Collections.Concurrent;
using Luma.Server.Http;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Luma.Server.Tests;

[Collection("HTTP timing")]
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
        var messages = new ConcurrentQueue<string>();
        using var services = new ServiceCollection().AddLogging(logging => logging.AddProvider(new CaptureProvider(messages))).BuildServiceProvider();
        var pipeline = new ApplicationBuilder(services);
        pipeline.UseSlowRequestLog(1);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        pipeline.Run(async _ => { await release.Task; await Task.Delay(2); });
        var request = pipeline.Build();
        static DefaultHttpContext Context()
        {
            var context = new DefaultHttpContext();
            context.Request.Method = "GET";
            context.Request.Path = "/api/status";
            return context;
        }
        int[] Counts() => messages.Where(message => message.Contains("for this path"))
            .Select(message => int.Parse(message.Split("on arrival ")[1].Split(' ')[0])).ToArray();

        // Hold the handlers after the middleware counted arrival. Overlap is deliberate,
        // independent of whether eight very fast database requests happen to overlap.
        var overlapping = Enumerable.Range(0, 8).Select(_ => request(Context())).ToArray();
        await Task.Delay(5);
        release.SetResult();
        await Task.WhenAll(overlapping);
        Assert.Equal(Enumerable.Range(1, 8), Counts().Order());
        // The same counters must unwind completely before the next request arrives.
        await request(Context());
        Assert.Equal(1, Counts().Last());
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
