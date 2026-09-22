using System.Diagnostics;

namespace Luma.Server.Http;

/// <summary>
/// Reports requests that took longer than <c>Luma:SlowRequestMs</c>, and says nothing about the
/// rest.
/// </summary>
/// <remarks>
/// ASP.NET Core already times every request, but only at Information level and only alongside a
/// line for each one. A gallery asks for hundreds of thumbnails per screen, so turning that on to
/// find one slow query writes far more to the log than the query costs -- on a self-hosted box
/// where the disk is usually the thing being investigated. A threshold keeps the pipeline silent
/// until something is worth reading, which makes it safe to leave on.
/// </remarks>
public static class SlowRequestLog
{
    public const int DefaultThresholdMs = 500;

    public static IApplicationBuilder UseSlowRequestLog(this WebApplication app)
    {
        var threshold = app.Configuration.GetValue("Luma:SlowRequestMs", DefaultThresholdMs);
        if (threshold <= 0) return app;
        var logger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Luma.SlowRequest");
        return app.Use(async (context, next) =>
        {
            var started = Stopwatch.GetTimestamp();
            try { await next(context); }
            finally
            {
                var elapsed = Stopwatch.GetElapsedTime(started).TotalMilliseconds;
                if (elapsed >= threshold)
                    // The route pattern rather than the path: one line per endpoint that is slow,
                    // instead of one per media id, and nothing from the library in the log.
                    logger.LogWarning("{Method} {Route} took {Elapsed:F0} ms (status {Status}, over the {Threshold} ms threshold).",
                        context.Request.Method,
                        context.GetEndpoint() is Microsoft.AspNetCore.Routing.RouteEndpoint route ? route.RoutePattern.RawText : context.Request.Path.Value,
                        elapsed, context.Response.StatusCode, threshold);
            }
        });
    }
}
