using Luma.Server.Features.Files;
using Luma.Server.Http;
using Microsoft.AspNetCore.Http.Features;

namespace Luma.Server.Features.Uploads;

public static class UploadEndpoints
{
    public static void MapUploads(this IEndpointRouteBuilder app)
    {
        // Raw byte handlers do not use ForegroundWriteFilter: retrying a consumed request body
        // would corrupt the protocol, and waiting for a client must not pause indexing workers.
        var uploads = app.MapGroup("/api/files/uploads").AddEndpointFilter<MutationAccessFilter>();
        uploads.MapPost("", async (UploadRequest request, UploadSessions sessions, CancellationToken ct) =>
            TypedResults.Ok(await sessions.CreateAsync(request, ct))).WithName("CreateUploadSession");
        uploads.MapGet("/{id}", async (string id, UploadSessions sessions, CancellationToken ct) =>
            TypedResults.Ok(await sessions.GetAsync(id, ct))).WithName("GetUploadSession");
        uploads.MapPatch("/{id}", async (string id, long offset, HttpContext context, UploadSessions sessions, CancellationToken ct) =>
        {
            if (context.Request.ContentLength is not { } length) throw ApiRequestException.Invalid("Upload chunks require Content-Length.");
            var limit = context.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if (limit is { IsReadOnly: false }) limit.MaxRequestBodySize = UploadSessions.ChunkBytes;
            return TypedResults.Ok(await sessions.AppendAsync(id, offset, context.Request.Body, length, ct));
        }).WithName("AppendUploadChunk");
        uploads.MapPost("/{id}/finalize", async (string id, bool? replaceExisting, UploadSessions sessions, CancellationToken ct) =>
            TypedResults.Ok(await sessions.FinalizeAsync(id, ct, replaceExisting ?? false))).WithName("FinalizeUploadSession");
        uploads.MapPost("/{id}/{action}", async (string id, string action, UploadSessions sessions, CancellationToken ct) =>
            TypedResults.Ok(await sessions.ChangeStateAsync(id, action, ct))).WithName("ChangeUploadSessionState");
    }
}
