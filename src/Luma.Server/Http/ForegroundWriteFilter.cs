using Luma.Server.Data;
using Microsoft.Data.Sqlite;

namespace Luma.Server.Http;

/// <summary>
/// Every mutating API request is an interactive action: background workers yield to it, and
/// a write that still finds the database locked is retried with a short bounded backoff before
/// the client sees "Luma is busy". Handlers roll back on failure (their transaction is disposed
/// uncommitted), so running one again is safe.
/// </summary>
public sealed class ForegroundWriteFilter(Database database, ILogger<ForegroundWriteFilter> logger) : IEndpointFilter
{
    private static readonly int[] BackoffMs = [50, 150, 400];

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var method = context.HttpContext.Request.Method;
        if (HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method)) return await next(context);
        using var _ = database.BeginForegroundWrite();
        for (var attempt = 0; ; attempt++)
        {
            try { return await next(context); }
            catch (SqliteException error) when (Database.IsBusy(error) && attempt < BackoffMs.Length && !context.HttpContext.Response.HasStarted)
            {
                logger.LogDebug("Retrying {Method} {Path} after database contention (attempt {Attempt})", method, context.HttpContext.Request.Path, attempt + 1);
                await Task.Delay(BackoffMs[attempt], context.HttpContext.RequestAborted);
            }
        }
    }
}
