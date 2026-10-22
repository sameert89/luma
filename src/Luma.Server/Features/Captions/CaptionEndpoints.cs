using Luma.Server.Features.Files;

namespace Luma.Server.Features.Captions;

// Explicit playback work, not a foreground database mutation. Do not pause index workers
// or retry a long extraction through ForegroundWriteFilter.
public static class CaptionEndpoints
{
    public static void MapCaptions(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/media/{id:long}/captions", async (long id, HttpContext context, CaptionContent captions, CancellationToken ct) =>
        {
            MutationAccess.CheckOrigin(context.Request);
            return TypedResults.Ok(await captions.ListAsync(id, ct));
        }).WithName("DiscoverCaptions");
        app.MapGet("/api/media/{id:long}/captions/{trackId}", async (long id, string trackId, string key, HttpContext context, CaptionContent captions, CancellationToken ct) =>
        {
            var result = await captions.ServeAsync(id, trackId, key, ct);
            context.Response.Headers.CacheControl = "private, max-age=86400";
            return result;
        }).WithName("GetCaptionTrack").Produces(200, contentType: "text/vtt");
    }
}
