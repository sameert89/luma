using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Indexing;

namespace Luma.Server.Features.Files;

public static class FileEndpoints
{
    public static void MapFileOperations(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/files/capabilities", (IndexingOptions options, MutationAccess access, FileWriteAvailability availability) =>
            TypedResults.Ok(new FileCapabilities(access.Enabled, options.Libraries.Select(x => new FileCapability(x.Id, access.Enabled && x.Writable && availability.CanWrite(x.Id))).ToArray())))
            .WithName("GetFileCapabilities");
        app.MapGet("/api/files/storage-status", (FileWriteAvailability availability, MutationAccess access) =>
            TypedResults.Ok(new FileStorageReport(availability.BootId, access.Enabled, availability.Statuses)))
            .WithName("GetFileStorageStatus");
        app.MapGet("/api/files/settings", (MutationAccess access) => TypedResults.Ok(new FileManagementSettings(access.Enabled))).WithName("GetFileManagementSettings");
        app.MapPut("/api/files/settings", async (FileManagementSettings settings, MutationAccess access, Database database, CancellationToken ct) =>
        { await access.SaveAsync(settings.Enabled, database, ct); return TypedResults.NoContent(); }).AddEndpointFilter<SameOriginFilter>().WithName("UpdateFileManagementSettings");
        var files = app.MapGroup("/api/files").AddEndpointFilter<MutationAccessFilter>();
        files.MapPost("/storage-check", async (IndexingOptions options, FileWriteAvailability availability, CancellationToken ct) =>
        {
            var statuses = await FileStorageCheck.CheckAsync(options, ct);
            availability.Update(statuses);
            return TypedResults.Ok(statuses);
        }).WithName("CheckFileStorage");
        files.MapGet("/access", () => TypedResults.NoContent()).WithName("CheckMutationAccess");
        files.MapGet("/location", async (long? folderId, long? mediaId, Database database, CancellationToken ct) =>
        {
            if ((folderId.HasValue ? 1 : 0) + (mediaId.HasValue ? 1 : 0) != 1) throw Luma.Server.Http.ApiRequestException.Invalid();
            await using var db = await database.OpenAsync(ct);
            var table = folderId.HasValue ? "Folders" : "Media";
            return TypedResults.Ok(await db.QuerySingleOrDefaultAsync<FileLocation>(new CommandDefinition($"SELECT LibraryId,RelativePath FROM {table} WHERE Id=@id", new { id = folderId ?? mediaId }, cancellationToken: ct)) ?? throw Luma.Server.Http.ApiRequestException.Missing());
        }).WithName("GetFileLocation");
        files.MapPost("/clipboard", async (FileSelectionRequest request, Database database, IndexingOptions options, CancellationToken ct) =>
        {
            if (request.MediaIds.Length + request.FolderIds.Length is < 1 or > 500) throw Luma.Server.Http.ApiRequestException.Invalid("Select between 1 and 500 items.");
            await using var db = await database.OpenAsync(ct);
            var entries = (await db.QueryAsync<FileClipboardEntry>(new CommandDefinition("""
                SELECT LibraryId,RelativePath,Id AS MediaId,NULL AS FolderId FROM Media WHERE Id IN @MediaIds
                UNION ALL
                SELECT LibraryId,RelativePath,NULL AS MediaId,Id AS FolderId FROM Folders WHERE Id IN @FolderIds AND ParentId IS NOT NULL AND Recycled=0
                """, request, cancellationToken: ct))).ToArray();
            if (entries.Length != request.MediaIds.Distinct().Count() + request.FolderIds.Distinct().Count()) throw Luma.Server.Http.ApiRequestException.Missing();
            // Selecting a folder already includes its descendants. Queue each original once.
            return TypedResults.Ok(entries.Where(entry => !entries.Any(parent => parent.FolderId.HasValue && parent != entry && parent.LibraryId == entry.LibraryId &&
                (options.Libraries.Find(root => root.Id == entry.LibraryId) is { } library) &&
                library.Key(entry.RelativePath).StartsWith(library.Key(parent.RelativePath) + '/', StringComparison.Ordinal))).ToArray());
        }).WithName("GetFileClipboardEntries");
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
