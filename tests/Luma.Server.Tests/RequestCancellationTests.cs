using Luma.Server.Http;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace Luma.Server.Tests;

public sealed class RequestCancellationTests
{
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Sqlite_interrupt_is_only_silenced_when_the_request_is_cancelled(bool cancelled)
    {
        using var services = new ServiceCollection().AddLogging().AddProblemDetails().BuildServiceProvider();
        using var cancellation = new CancellationTokenSource();
        if (cancelled) cancellation.Cancel();
        var context = new DefaultHttpContext { RequestServices = services, RequestAborted = cancellation.Token };
        context.Response.Body = new MemoryStream();
        var handler = new ApiExceptionHandler(NullLogger<ApiExceptionHandler>.Instance);
        Assert.True(await handler.TryHandleAsync(context, new SqliteException("interrupted", 9), CancellationToken.None));
        Assert.Equal(cancelled ? 499 : 503, context.Response.StatusCode);
        if (cancelled) Assert.Equal(0, context.Response.Body.Length);
        else Assert.True(context.Response.Body.Length > 0);
    }
}
