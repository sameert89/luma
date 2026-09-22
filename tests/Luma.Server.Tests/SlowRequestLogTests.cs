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
        // The route pattern, not the path: nothing from the library reaches the log.
        if (expected) Assert.Contains("GET /api/status", Assert.Single(reported));
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
