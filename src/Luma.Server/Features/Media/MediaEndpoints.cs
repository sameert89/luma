using Luma.Server.Features.Libraries;
using Luma.Server.Features.Tags;
using Luma.Server.Http;

namespace Luma.Server.Features.Media;

public static class MediaEndpoints
{
    public static void MapMedia(this WebApplication app)
    {
        app.MapGet("/api/media/{id:long}/original", async (long id, bool? download, OriginalContent content, CancellationToken ct) =>
            await content.ServeAsync(id, download ?? false, ct)).WithName("GetOriginalMedia")
            .Produces(200).Produces(206).Produces(416).Produces<ApiProblem>(503,"application/problem+json");
        app.MapPost("/api/imports/tags",async(MetadataJobRequest request,MetadataJobs jobs,CancellationToken ct)=>
        {var accepted=await jobs.EnqueueAsync("import",request,ct);return TypedResults.Accepted($"/api/jobs/{accepted.Id}",accepted);}).WithName("ImportTags");
        app.MapPost("/api/exports/xmp",async(MetadataJobRequest request,MetadataJobs jobs,CancellationToken ct)=>
        {var accepted=await jobs.EnqueueAsync("xmp",request,ct);return TypedResults.Accepted($"/api/jobs/{accepted.Id}",accepted);}).WithName("ExportXmp");
        app.MapPost("/api/exports/dislikes",async(MetadataJobRequest request,MetadataJobs jobs,CancellationToken ct)=>
        {var accepted=await jobs.EnqueueAsync("dislikes",request,ct);return TypedResults.Accepted($"/api/jobs/{accepted.Id}",accepted);}).WithName("ExportDislikes");
        app.MapGet("/api/jobs/{id:long}",async(long id,long? afterMediaId,MetadataJobs jobs,CancellationToken ct)=>TypedResults.Ok(await jobs.StatusAsync(id,afterMediaId,ct))).WithName("GetMetadataJob");
        app.MapGet("/api/jobs/{id:long}/content",async(long id,MetadataJobs jobs,CancellationToken ct)=>await jobs.ContentAsync(id,ct)).WithName("DownloadMetadataJob");
        app.MapGet("/api/random",async([AsParameters] MediaQuery query,HttpContext context,RandomImage random,CancellationToken ct)=>
            await random.ServeAsync(query.Normalize(context.Request.Query),context,ct)).WithName("GetRandomImage").Produces(200,contentType:"image/jpeg");
        app.MapPut("/api/folders/{id:long}/cover",async(long id,CoverRequest request,LibraryBrowser browser,CancellationToken ct)=>
        {await browser.SetCoverAsync(id,request.MediaId,ct);return TypedResults.NoContent();}).WithName("SetFolderCover");
        app.MapGet("/api/libraries",async(LibraryBrowser browser,CancellationToken ct)=>TypedResults.Ok(await browser.LibrariesAsync(ct))).WithName("GetLibraries");
        app.MapGet("/api/folders",async(long? libraryId,long? parentId,int? limit,string? cursor,LibraryBrowser browser,CancellationToken ct)=>
            TypedResults.Ok(await browser.FoldersAsync(libraryId,parentId,limit,cursor,ct))).WithName("GetFolders");
        app.MapGet("/api/media",async([AsParameters] MediaQuery query,HttpContext context,MediaBrowser browser,CancellationToken ct)=>
            TypedResults.Ok(await browser.ListAsync(query.Normalize(context.Request.Query),ct))).WithName("GetMedia");
        app.MapGet("/api/media/{id:long}",async(long id,MediaBrowser browser,CancellationToken ct)=>TypedResults.Ok(await browser.DetailAsync(id,ct))).WithName("GetMediaDetail");
        app.MapGet("/api/media/{id:long}/neighbors",async(long id,[AsParameters] MediaQuery query,HttpContext context,MediaBrowser browser,CancellationToken ct)=>
            TypedResults.Ok(await browser.NeighborsAsync(id,query.Normalize(context.Request.Query),ct))).WithName("GetMediaNeighbors");
        app.MapPost("/api/media/priority",async(MediaPriorityRequest request,MediaBrowser browser,CancellationToken ct)=>
        {await browser.PrioritizeAsync(request,ct);return TypedResults.NoContent();}).WithName("PrioritizeVisibleMedia");
        app.MapGet("/api/media/{id:long}/cache/{revision:long}/{variant}",async(long id,long revision,string variant,int? v,HttpContext context,CacheContent cache,CancellationToken ct)=>
            await cache.ServeAsync(id,revision,variant,v,context,ct)).WithName("GetCachedMedia")
            .Produces(200,contentType:"image/webp").Produces(200,contentType:"image/jpeg").Produces(304).Produces<ApiProblem>(503,"application/problem+json");
        app.MapGet("/api/collections/tags",async(string? cursor,TagService tags,CursorSigner signer,CancellationToken ct)=>TypedResults.Ok(await tags.PageAsync(cursor,signer,ct))).WithName("GetCollectionTags");
        app.MapGet("/api/tags",async(string? prefix,int? limit,TagService tags,CancellationToken ct)=>TypedResults.Ok(await tags.FindAsync(prefix,limit,ct))).WithName("FindTags");
        app.MapPost("/api/tags",async(CreateTagRequest request,TagService tags,CancellationToken ct)=>
        {
            var result=await tags.CreateAsync(request.Name,ct);
            return Results.Json(result.Tag,statusCode:result.Created?201:200);
        }).WithName("CreateTag").Produces<TagSummary>(200).Produces<TagSummary>(201);
        app.MapPost("/api/media/tags",async(BulkTagsRequest request,TagService tags,CancellationToken ct)=>
        {await tags.BulkAsync(request,ct);return TypedResults.NoContent();}).WithName("EditMediaTags");
        app.MapPut("/api/media/{id:long}/preference",async(long id,PreferenceRequest request,TagService tags,CancellationToken ct)=>
        {await tags.PreferenceAsync(id,request.Preference,ct);return TypedResults.NoContent();}).WithName("SetPreference");
    }
}
