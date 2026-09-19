using Microsoft.AspNetCore.Diagnostics;
using Microsoft.Data.Sqlite;

namespace Luma.Server.Http;

public static class ApiErrors
{
    public static string Code(int status) => status switch
    {
        400 => "invalid_request", 404 => "not_found", 405 => "method_not_allowed",
        409 => "conflict", 413 => "request_too_large", 503 => "database_unavailable", _ => "internal_error"
    };

    public static Dictionary<string, object?> Extensions(int status, HttpContext context) =>
        new() { ["code"] = Code(status), ["traceId"] = context.TraceIdentifier };
}

public sealed class ApiExceptionHandler(ILogger<ApiExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken cancellationToken)
    {
        // sqlite3_interrupt reports SQLITE_INTERRUPT rather than OperationCanceledException.
        // Only classify it as cancellation when the HTTP request was actually aborted.
        if ((context.RequestAborted.IsCancellationRequested || cancellationToken.IsCancellationRequested) &&
            exception is OperationCanceledException or SqliteException { SqliteErrorCode: 9 })
        {
            context.Response.StatusCode = 499;
            return true;
        }
        if (exception is ApiRequestException request)
        {
            if (request.Code == "cache_unavailable") context.Response.Headers.RetryAfter = "30";
            await Results.Problem(statusCode: request.Status, title: request.Message,
                extensions: new Dictionary<string, object?> { ["code"] = request.Code, ["traceId"] = context.TraceIdentifier }).ExecuteAsync(context);
            return true;
        }
        // Another writer held SQLite's write lock past the busy timeout. That is transient
        // contention, not a fault: ask the client to retry instead of logging a stack trace.
        if (exception is SqliteException { SqliteErrorCode: 5 or 6 })
        {
            logger.LogWarning("Database busy for {Method} {Path} (trace {TraceId})", context.Request.Method, context.Request.Path, context.TraceIdentifier);
            context.Response.Headers.RetryAfter = "1";
            await Results.Problem(statusCode: 503, title: "Luma is busy. Please try again.",
                extensions: new Dictionary<string, object?> { ["code"] = "database_busy", ["traceId"] = context.TraceIdentifier }).ExecuteAsync(context);
            return true;
        }
        logger.LogError(exception, "Request failed with trace {TraceId}", context.TraceIdentifier);
        var status = exception switch
        {
            SqliteException => 503,
            BadHttpRequestException bad => bad.StatusCode,
            _ => 500
        };
        await Results.Problem(statusCode: status, extensions: ApiErrors.Extensions(status, context)).ExecuteAsync(context);
        return true;
    }
}
