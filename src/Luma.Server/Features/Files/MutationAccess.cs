using System.Security.Cryptography;
using System.Text;
using Luma.Server.Http;

namespace Luma.Server.Features.Files;

// One administrator capability, independent of read-only browsing. No secret is returned by APIs.
public sealed class MutationAccess(IConfiguration configuration)
{
    private readonly byte[]? tokenHash = Hash(configuration["Luma:Files:AccessToken"]);
    public bool Enabled => tokenHash is not null;

    public void Authorize(HttpContext context)
    {
        CheckOrigin(context.Request);
        var header = context.Request.Headers.Authorization.ToString();
        var token = header.StartsWith("Bearer ", StringComparison.Ordinal) ? header[7..] : null;
        if (tokenHash is null || token is null || !CryptographicOperations.FixedTimeEquals(tokenHash, SHA256.HashData(Encoding.UTF8.GetBytes(token))))
            throw new ApiRequestException(401, "mutation_unauthorized", "File management requires the configured access token.");
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

    private static byte[]? Hash(string? token)
    {
        if (string.IsNullOrEmpty(token)) return null;
        if (Encoding.UTF8.GetByteCount(token) < 32)
            throw new InvalidOperationException("Luma:Files:AccessToken must contain at least 32 UTF-8 bytes.");
        return SHA256.HashData(Encoding.UTF8.GetBytes(token));
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
