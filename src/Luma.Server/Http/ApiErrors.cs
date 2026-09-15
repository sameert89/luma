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
        if (exception is OperationCanceledException && cancellationToken.IsCancellationRequested) return false;
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
