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
        files.MapGet("/access", () => TypedResults.NoContent()).WithName("CheckMutationAccess");
        files.MapGet("/location", async (long? folderId, long? mediaId, Database database, CancellationToken ct) =>
        {
            if ((folderId.HasValue ? 1 : 0) + (mediaId.HasValue ? 1 : 0) != 1) throw Luma.Server.Http.ApiRequestException.Invalid();
            await using var db = await database.OpenAsync(ct);
            var table = folderId.HasValue ? "Folders" : "Media";
            return TypedResults.Ok(await db.QuerySingleOrDefaultAsync<FileLocation>(new CommandDefinition($"SELECT LibraryId,RelativePath FROM {table} WHERE Id=@id", new { id = folderId ?? mediaId }, cancellationToken: ct)) ?? throw Luma.Server.Http.ApiRequestException.Missing());
        }).WithName("GetFileLocation");
        files.MapPost("/items", async (FileItemRequest request, Database database, FileOperations operations, CancellationToken ct) =>
        {
            if ((request.FolderId.HasValue ? 1 : 0) + (request.MediaId.HasValue ? 1 : 0) != 1) throw Luma.Server.Http.ApiRequestException.Invalid();
            await using var db = await database.OpenAsync(ct);
            var table = request.FolderId.HasValue ? "Folders" : "Media";
            var source = await db.QuerySingleOrDefaultAsync<string>(new CommandDefinition($"SELECT RelativePath FROM {table} WHERE LibraryId=@LibraryId AND Id=@id", new { request.LibraryId, id = request.FolderId ?? request.MediaId }, cancellationToken: ct)) ?? throw Luma.Server.Http.ApiRequestException.Missing();
            return TypedResults.Accepted(uri: (string?)null, value: await operations.QueueAsync(new(request.LibraryId, request.Kind, source, request.Destination), ct));
        }).WithName("CreateFileItemOperation");
        files.MapPost("/operations", async (FileOperationRequest request, FileOperations operations, CancellationToken ct) =>
            TypedResults.Accepted(uri: (string?)null, value: await operations.QueueAsync(request, ct))).WithName("CreateFileOperation");
        files.MapGet("/operations/{id}", async (string id, FileOperations operations, CancellationToken ct) =>
            TypedResults.Ok(await operations.GetAsync(id, ct))).WithName("GetFileOperation");
        files.MapGet("/operations/{id}/recovery", async (string id, FileRecovery recovery, CancellationToken ct) =>
            TypedResults.Ok(await recovery.InspectAsync(id, ct))).WithName("GetFileRecoveryEvidence");
        files.MapPost("/operations/{id}/recover", async (string id, FileRecoveryRequest request, FileRecovery recovery, CancellationToken ct) =>
            TypedResults.Accepted(uri: (string?)null, value: await recovery.ResolveAsync(id, request, ct))).WithName("ResolveFileOperation");
        files.MapPost("/operations/{id}/cancel", async (string id, FileOperations operations, CancellationToken ct) =>
        {
            await operations.CancelAsync(id, ct);
            return TypedResults.NoContent();
        }).WithName("CancelFileOperation");
        files.MapGet("/trash", async (long libraryId, string? before, FileOperations operations, CancellationToken ct) =>
            TypedResults.Ok(await operations.TrashAsync(libraryId, before, ct))).WithName("GetRecycledFiles");
    }
}
