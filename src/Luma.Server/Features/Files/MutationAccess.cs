using Dapper;
using Luma.Server.Data;
using Luma.Server.Http;

namespace Luma.Server.Features.Files;

// A single-user preference, not authentication. Writable roots remain separately opt-in.
public sealed class MutationAccess(IConfiguration configuration)
{
    public bool Enabled { get; private set; } = configuration.GetValue("Luma:Files:Enabled", false);

    public async Task InitializeAsync(Database database, CancellationToken ct)
    {
        await using var db = await database.OpenAsync(ct);
        var stored = await db.ExecuteScalarAsync<string>(new CommandDefinition("SELECT Value FROM ApplicationState WHERE Key='fileManagementEnabled'", cancellationToken: ct));
        if (stored is not null) Enabled = stored == "1";
    }
    public async Task SaveAsync(bool enabled, Database database, CancellationToken ct)
    {
        await using var db = await database.OpenAsync(ct);
        await db.ExecuteAsync(new CommandDefinition("INSERT INTO ApplicationState(Key,Value) VALUES('fileManagementEnabled',@value) ON CONFLICT(Key) DO UPDATE SET Value=excluded.Value", new { value = enabled ? "1" : "0" }, cancellationToken: ct));
        Enabled = enabled;
    }
    public void Authorize(HttpContext context)
    {
        CheckOrigin(context.Request);
        if (!Enabled) throw new ApiRequestException(403, "file_management_disabled", "Enable file management in Settings to change original files.");
    }

    internal static void CheckOrigin(HttpRequest request)
    {
        if (request.Headers["Sec-Fetch-Site"] == "cross-site")
            throw new ApiRequestException(403, "cross_origin_write", "Cross-site file operations are not allowed.");
        // Browsers set this forbidden header themselves. Behind TLS-terminating proxies,
        // it proves same-origin even when Kestrel sees an internal HTTP scheme/host.
        if (request.Headers["Sec-Fetch-Site"] == "same-origin") return;
        var origin = request.Headers.Origin.ToString();
        var publicOrigin = request.HttpContext.RequestServices?.GetService<IConfiguration>()?["Luma:PublicOrigin"];
        if (origin.Length != 0 && Uri.TryCreate(publicOrigin, UriKind.Absolute, out var configured)
            && string.Equals(origin, configured.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase)) return;
        if (origin.Length != 0 && (!Uri.TryCreate(origin, UriKind.Absolute, out var uri) ||
            !string.Equals(uri.GetLeftPart(UriPartial.Authority), $"{request.Scheme}://{request.Host}", StringComparison.OrdinalIgnoreCase)))
            throw new ApiRequestException(403, "cross_origin_write", "Cross-origin requests are not allowed. Configure Luma:PublicOrigin for your external HTTPS URL.");
    }

}

public sealed class MutationAccessFilter(MutationAccess access) : IEndpointFilter
{
    public ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        access.Authorize(context.HttpContext);
        return next(context);
    }
}

public sealed class SameOriginFilter : IEndpointFilter
{
    public ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        MutationAccess.CheckOrigin(context.HttpContext.Request);
        return next(context);
    }
}
public sealed record FileManagementSettings(bool Enabled);
