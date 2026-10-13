using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Indexing;

namespace Luma.Server.Features.Files;

public static class FileEndpoints
{
    public static void MapFileOperations(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/files/capabilities", (IndexingOptions options, MutationAccess access) =>
            TypedResults.Ok(new FileCapabilities(access.Enabled, options.Libraries.Select(x => new FileCapability(x.Id, x.Writable)).ToArray())))
            .WithName("GetFileCapabilities");
        var files = app.MapGroup("/api/files").AddEndpointFilter<MutationAccessFilter>();
        files.MapPost("/operations", async (FileOperationRequest request, FileOperations operations, CancellationToken ct) =>
            TypedResults.Accepted(uri: (string?)null, value: await operations.QueueAsync(request, ct))).WithName("CreateFileOperation");
        files.MapGet("/operations/{id}", async (string id, FileOperations operations, CancellationToken ct) =>
            TypedResults.Ok(await operations.GetAsync(id, ct))).WithName("GetFileOperation");
        files.MapPost("/operations/{id}/cancel", async (string id, FileOperations operations, CancellationToken ct) =>
        {
            await operations.CancelAsync(id, ct);
            return TypedResults.NoContent();
        }).WithName("CancelFileOperation");
        files.MapGet("/trash", async (long libraryId, string? before, FileOperations operations, CancellationToken ct) =>
            TypedResults.Ok(await operations.TrashAsync(libraryId, before, ct))).WithName("GetRecycledFiles");
    }
}
