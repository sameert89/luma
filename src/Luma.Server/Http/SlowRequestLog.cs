using System.Collections.Concurrent;
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
/// <para>
/// A slow request also says how much company it had, because the duration alone rarely names the
/// bug. A listing that takes a second when asked for once takes far longer when something asks
/// again before the first answer arrives: the copies compete for the same cores and the same disk,
/// each one making the next slower, and left alone that feeds back on itself. Whether a request was
/// slow by itself or slow because a dozen copies of it were running is the difference between an
/// expensive query and a request storm, and they need different fixes.
/// </para>
/// </remarks>
public static class SlowRequestLog
{
    public const int DefaultThresholdMs = 500;

    public static IApplicationBuilder UseSlowRequestLog(this WebApplication app)
    {
        var threshold = app.Configuration.GetValue("Luma:SlowRequestMs", DefaultThresholdMs);
        if (threshold <= 0) return app;
        var logger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Luma.SlowRequest");
        // Counted per application rather than per process, so what the log reports is this server's
        // own load and two hosts in one process cannot inflate each other's numbers.
        var inFlight = 0;
        // Keyed on path rather than route pattern, because the route is only known once routing has
        // run and the count has to be taken on the way in. For the fixed paths a storm forms on
        // (/api/folders, /api/media) the two are the same; a path carrying an id counts per id,
        // which costs nothing because those requests are cheap enough not to pile up.
        var inFlightByPath = new ConcurrentDictionary<string, int>();
        return app.Use(async (context, next) =>
        {
            var started = Stopwatch.GetTimestamp();
            var path = context.Request.Path.Value ?? "";
            var total = Interlocked.Increment(ref inFlight);
            // What this request found already running when it arrived, which is the number that
            // says whether it was queuing behind copies of itself.
            var samePath = inFlightByPath.AddOrUpdate(path, 1, (_, count) => count + 1);
            try { await next(context); }
            finally
            {
                Interlocked.Decrement(ref inFlight);
                inFlightByPath.AddOrUpdate(path, 0, (_, count) => count - 1);
                var elapsed = Stopwatch.GetElapsedTime(started).TotalMilliseconds;
                if (elapsed >= threshold)
                {
                    ThreadPool.GetAvailableThreads(out var freeWorkers, out _);
                    ThreadPool.GetMaxThreads(out var maxWorkers, out _);
                    logger.LogWarning(
                        "{Method} {Route} took {Elapsed:F0} ms (status {Status}, over the {Threshold} ms threshold; " +
                        "on arrival {Total} requests were in flight, {SamePath} for this path; " +
                        "thread pool {FreeWorkers} of {MaxWorkers} workers free, {Queued} queued).",
                        context.Request.Method, Route(context), elapsed, context.Response.StatusCode, threshold,
                        total, samePath, freeWorkers, maxWorkers, ThreadPool.PendingWorkItemCount);
                }
            }
        });
    }

    // The route pattern rather than the path: one line per endpoint that is slow, instead of one
    // per media id, and nothing from the library in the log.
    private static string Route(HttpContext context) =>
        context.GetEndpoint() is Microsoft.AspNetCore.Routing.RouteEndpoint route
            ? route.RoutePattern.RawText ?? context.Request.Path.Value ?? ""
            : context.Request.Path.Value ?? "";
}
