using Luma.Server.Features.Libraries;
using Luma.Server.Data;
using Dapper;
using Luma.Server.Features.Tags;
using Luma.Server.Http;

namespace Luma.Server.Features.Media;

public static class MediaEndpoints
{
    public static void MapMedia(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/media/{id:long}/original", async (long id, bool? download, HttpContext context, OriginalContent content, CancellationToken ct) =>
            await content.ServeAsync(id, download ?? false, context, ct)).WithName("GetOriginalMedia")
            .Produces(200).Produces(206).Produces(304).Produces(416).Produces<ApiProblem>(503, "application/problem+json");
        app.MapPost("/api/imports/tags", async (MetadataJobRequest request, MetadataJobs jobs, CancellationToken ct) =>
        { var accepted = await jobs.EnqueueAsync("import", request, ct); return TypedResults.Accepted($"/api/jobs/{accepted.Id}", accepted); }).WithName("ImportTags");
        app.MapPost("/api/exports/xmp", async (MetadataJobRequest request, MetadataJobs jobs, CancellationToken ct) =>
        { var accepted = await jobs.EnqueueAsync("xmp", request, ct); return TypedResults.Accepted($"/api/jobs/{accepted.Id}", accepted); }).WithName("ExportXmp");
        app.MapPost("/api/exports/dislikes", async (MetadataJobRequest request, MetadataJobs jobs, CancellationToken ct) =>
        { var accepted = await jobs.EnqueueAsync("dislikes", request, ct); return TypedResults.Accepted($"/api/jobs/{accepted.Id}", accepted); }).WithName("ExportDislikes");
        app.MapGet("/api/jobs/{id:long}", async (long id, long? afterMediaId, MetadataJobs jobs, CancellationToken ct) => TypedResults.Ok(await jobs.StatusAsync(id, afterMediaId, ct))).WithName("GetMetadataJob");
        app.MapGet("/api/jobs/{id:long}/content", async (long id, MetadataJobs jobs, CancellationToken ct) => await jobs.ContentAsync(id, ct)).WithName("DownloadMetadataJob");
        app.MapGet("/api/collections/tag-groups", async ([AsParameters] MediaQuery query, long? afterId, Database database, CancellationToken ct) =>
        {
            if (afterId < 0) throw ApiRequestException.Invalid();
            query = (query with { GroupBy = "none" }).Normalize();
            var (predicate, p) = query.Predicate(); p.Add("after", afterId ?? 0);
            await using var db = await database.OpenAsync(ct);
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct); deadline.CancelAfter(TimeSpan.FromSeconds(2));
            using var interrupt = deadline.Token.Register(() => SQLitePCL.raw.sqlite3_interrupt(db.Handle));
            try
            {
                var tags = (await db.QueryAsync<TagSummary>(new CommandDefinition($"SELECT t.Id,t.Name FROM Tags t WHERE t.Id>@after AND EXISTS(SELECT 1 FROM MediaTags mt JOIN Media m ON m.Id=mt.MediaId WHERE mt.TagId=t.Id AND {predicate}) ORDER BY t.Id LIMIT 51", p, cancellationToken: deadline.Token))).ToArray();
                return TypedResults.Ok(new TagGroupPage(tags.Take(50).ToArray(), tags.Length > 50 ? tags[49].Id : null));
            }
            catch (Exception error) when (deadline.IsCancellationRequested && !ct.IsCancellationRequested && error is Microsoft.Data.Sqlite.SqliteException or OperationCanceledException)
            {
                throw new ApiRequestException(503, "query_timeout", "Try narrowing the filters.");
            }
        }).WithName("GetTagGroups");
        app.MapGet("/api/random", async ([AsParameters] MediaQuery query, HttpContext context, RandomImage random, CancellationToken ct) =>
            await random.ServeAsync(query.Normalize(context.Request.Query), context, ct)).WithName("GetRandomImage").Produces(200, contentType: "image/jpeg");
        app.MapPut("/api/folders/{id:long}/cover", async (long id, CoverRequest request, LibraryBrowser browser, CancellationToken ct) =>
        { await browser.SetCoverAsync(id, request.MediaId, ct); return TypedResults.NoContent(); }).WithName("SetFolderCover");
        app.MapPut("/api/folders/{id:long}/hidden", async (long id, FolderVisibilityRequest request, LibraryBrowser browser, CancellationToken ct) =>
        { await browser.SetHiddenAsync(id, request.Hidden, ct); return TypedResults.NoContent(); }).WithName("SetFolderHidden")
            .Produces<ApiProblem>(400, "application/problem+json").Produces<ApiProblem>(404, "application/problem+json");
        app.MapGet("/api/folders/hidden", async (LibraryBrowser browser, CancellationToken ct) => TypedResults.Ok(await browser.HiddenAsync(ct))).WithName("GetHiddenFolders");
        app.MapGet("/api/libraries", async (LibraryBrowser browser, CancellationToken ct) => TypedResults.Ok(await browser.LibrariesAsync(ct))).WithName("GetLibraries");
        app.MapGet("/api/folders", async (long? libraryId, long? parentId, int? limit, string? cursor, string? sort, string? order, LibraryBrowser browser, CancellationToken ct) =>
            TypedResults.Ok(await browser.FoldersAsync(libraryId, parentId, limit, cursor, ct, sort, order))).WithName("GetFolders");
        app.MapGet("/api/media", async ([AsParameters] MediaQuery query, HttpContext context, MediaBrowser browser, CancellationToken ct) =>
            TypedResults.Ok(await browser.ListAsync(query.Normalize(context.Request.Query), ct))).WithName("GetMedia");
        app.MapGet("/api/media/{id:long}", async (long id, MediaBrowser browser, CancellationToken ct) => TypedResults.Ok(await browser.DetailAsync(id, ct))).WithName("GetMediaDetail");
        app.MapGet("/api/media/{id:long}/neighbors", async (long id, [AsParameters] MediaQuery query, HttpContext context, MediaBrowser browser, CancellationToken ct) =>
            TypedResults.Ok(await browser.NeighborsAsync(id, query.Normalize(context.Request.Query), ct))).WithName("GetMediaNeighbors");
        app.MapPost("/api/media/priority", async (MediaPriorityRequest request, MediaBrowser browser, CancellationToken ct) =>
        { await browser.PrioritizeAsync(request, ct); return TypedResults.NoContent(); }).WithName("PrioritizeVisibleMedia");
        app.MapGet("/api/media/{id:long}/cache/{revision:long}/{variant}", async (long id, long revision, string variant, int? v, HttpContext context, CacheContent cache, CancellationToken ct) =>
            await cache.ServeAsync(id, revision, variant, v, context, ct)).WithName("GetCachedMedia")
            .Produces(200, contentType: "image/webp").Produces(200, contentType: "image/jpeg").Produces(304).Produces<ApiProblem>(503, "application/problem+json");
        app.MapGet("/api/collections/tags", async (string? cursor, TagService tags, CursorSigner signer, CancellationToken ct) => TypedResults.Ok(await tags.PageAsync(cursor, signer, ct))).WithName("GetCollectionTags");
        app.MapGet("/api/tags", async (string? prefix, int? limit, TagService tags, CancellationToken ct) => TypedResults.Ok(await tags.FindAsync(prefix, limit, ct))).WithName("FindTags");
        app.MapPost("/api/tags", async (CreateTagRequest request, TagService tags, CancellationToken ct) =>
        {
            var result = await tags.CreateAsync(request.Name, ct);
            return Results.Json(result.Tag, statusCode: result.Created ? 201 : 200);
        }).WithName("CreateTag").Produces<TagSummary>(200).Produces<TagSummary>(201);
        app.MapPut("/api/tags/{id:long}", async (long id, CreateTagRequest request, TagService tags, CancellationToken ct) =>
            TypedResults.Ok(await tags.RenameAsync(id, request.Name, ct))).WithName("RenameTag")
            .Produces<ApiProblem>(400, "application/problem+json").Produces<ApiProblem>(404, "application/problem+json");
        app.MapDelete("/api/tags/{id:long}", async (long id, TagService tags, CancellationToken ct) =>
        { await tags.DeleteAsync(id, ct); return TypedResults.NoContent(); }).WithName("DeleteTag").Produces<ApiProblem>(404, "application/problem+json");
        app.MapPost("/api/media/tags", async (BulkTagsRequest request, TagService tags, CancellationToken ct) =>
        { await tags.BulkAsync(request, ct); return TypedResults.NoContent(); }).WithName("EditMediaTags");
        app.MapPut("/api/media/{id:long}/preference", async (long id, PreferenceRequest request, TagService tags, CancellationToken ct) =>
        { await tags.PreferenceAsync(id, request.Preference, ct); return TypedResults.NoContent(); }).WithName("SetPreference");
    }
}

public sealed record TagGroupPage(IReadOnlyList<TagSummary> Items, long? NextId);
