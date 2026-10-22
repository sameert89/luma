using System.Collections.Concurrent;
using Luma.Server.Http;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Luma.Server.Tests;

[Collection("HTTP timing")]
public sealed class SlowRequestLogTests
{
    [Theory]
    [InlineData(1, 1, true)]
    [InlineData(null, 499, false)]
    [InlineData(null, 500, true)]
    [InlineData(null, 501, true)]
    [InlineData(0, 2000, false)]
    [InlineData(-1, 2000, false)]
    public async Task Only_requests_over_the_threshold_are_reported(int? threshold, int elapsedMs, bool expected)
    {
        var messages = new ConcurrentQueue<string>();
        using var services = new ServiceCollection().AddLogging(logging => logging.AddProvider(new CaptureProvider(messages))).BuildServiceProvider();
        var pipeline = new ApplicationBuilder(services);
        var clock = new ManualClock();
        pipeline.UseSlowRequestLog(threshold ?? SlowRequestLog.DefaultThresholdMs, clock);
        pipeline.Run(_ => { clock.Advance(elapsedMs); return Task.CompletedTask; });
        var context = new DefaultHttpContext();
        context.Request.Method = "GET";
        context.Request.Path = "/api/media/42";
        context.SetEndpoint(new Microsoft.AspNetCore.Routing.RouteEndpoint(_ => Task.CompletedTask,
            Microsoft.AspNetCore.Routing.Patterns.RoutePatternFactory.Parse("/api/media/{id:long}"), 0, EndpointMetadataCollection.Empty, "media"));
        await pipeline.Build()(context);

        var reported = messages.Where(message => message.Contains("took")).ToArray();
        Assert.Equal(expected, reported.Length > 0);
        if (!expected) return;
        var line = Assert.Single(reported);
        Assert.Contains("GET /api/media/{id:long}", line);
        Assert.DoesNotContain("/api/media/42", line);
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
        var clock = new ManualClock();
        pipeline.UseSlowRequestLog(1, clock);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        pipeline.Run(async _ => { await release.Task; clock.Advance(2); });
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

    private sealed class ManualClock : TimeProvider
    {
        private long timestamp;
        public override long TimestampFrequency => TimeSpan.TicksPerSecond;
        public override long GetTimestamp() => Interlocked.Read(ref timestamp);
        public void Advance(int milliseconds) => Interlocked.Add(ref timestamp, TimeSpan.FromMilliseconds(milliseconds).Ticks);
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
