using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Files;
using Luma.Server.Http;

namespace Luma.Server.Features.Panels;

public static class PanelEndpoints
{
    public static void MapPanels(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/panels/recently-added", async (ComicLibrary library, CancellationToken ct) => TypedResults.Ok(await library.RecentAsync(ct))).WithName("GetRecentlyAddedComics");
        app.MapGet("/api/panels/continue-reading", async (ComicLibrary library, CancellationToken ct) => TypedResults.Ok(await library.ContinueAsync(ct))).WithName("GetContinueReading");
        app.MapGet("/api/panels/sources", async (PanelSources sources, CancellationToken ct) => TypedResults.Ok(await sources.GetAsync(ct))).WithName("GetComicSources");
        app.MapGet("/api/panels/suggestions", async (string? q, int? limit, ComicLibrary library, CancellationToken ct) => TypedResults.Ok(await library.SuggestAsync(q, limit ?? 8, ct))).WithName("GetComicSuggestions");
        app.MapGet("/api/panels/source-folders", async (long libraryId, string? path, string? q, int? offset, PanelSources sources, CancellationToken ct) => TypedResults.Ok(await sources.FoldersAsync(libraryId, path ?? "", q, offset ?? 0, ct))).AddEndpointFilter<SameOriginFilter>().WithName("GetComicSourceFolders");
        app.MapGet("/api/panels/comics", async (string? q, string? state, string? series, bool? favourite, long? cursor, long? libraryId, string? path, string? tag, string? sort, string? order, ComicLibrary library, CancellationToken ct) =>
            TypedResults.Ok(await library.ListAsync(q, state, series, favourite, cursor, ct, libraryId, path, tag, sort, order))).WithName("GetComicLibrary");
        app.MapGet("/api/panels/folders", async (long libraryId, string? path, string? after, string? order, ComicLibrary library, CancellationToken ct) => TypedResults.Ok(await library.FoldersAsync(libraryId, path ?? "", after, ct, order))).WithName("GetComicFolders");
        app.MapGet("/api/panels/comics/{id:long}/tags", async (long id, ComicLibrary library, CancellationToken ct) => TypedResults.Ok(await library.TagsAsync(id, ct))).WithName("GetComicTags");
        app.MapGet("/api/panels/tags", async (string? prefix, int? limit, Database database, CancellationToken ct) =>
        {
            if (prefix?.Length > 400 || limit is < 1 or > 50) throw ApiRequestException.Invalid();
            var key = Luma.Server.Features.Media.SearchText.Key(prefix?.Trim() ?? "");
            await using var db = await database.OpenAsync(ct);
            return TypedResults.Ok((await db.QueryAsync<Luma.Server.Features.Media.TagSummary>(new CommandDefinition("SELECT Id,Name FROM Tags WHERE NormalizedKey>=@key AND NormalizedKey<@end ORDER BY NormalizedKey,Id LIMIT @limit", new { key, end = key + "\U0010FFFF", limit = limit ?? 20 }, cancellationToken: ct))).ToArray());
        }).WithName("FindComicTags");
        app.MapGet("/api/panels/comics/{id:long}", async (long id, ComicLibrary library, CancellationToken ct) =>
            TypedResults.Ok(ComicLibrary.Summary(await library.GetAsync(id, ct)))).WithName("GetComic");
        app.MapGet("/api/panels/comics/{id:long}/pages/{page:int}", (long id, int page, bool? original, ComicPageContent pages, CancellationToken ct) =>
            pages.ServeAsync(id, page, original == true, ct)).WithName("GetComicPage");
        app.MapGet("/api/panels/comics/{id:long}/document", (long id, int? revision, ComicPageContent pages, CancellationToken ct) =>
            pages.DocumentAsync(id, revision, ct)).AddEndpointFilter<SameOriginFilter>().WithName("GetComicDocument");
        app.MapGet("/api/panels/comics/{id:long}/cover", (long id, ComicPageContent pages, CancellationToken ct) =>
            pages.CoverAsync(id, ct)).WithName("GetComicCover");
        app.MapPut("/api/panels/comics/{id:long}/progress", async (long id, ReadingUpdate update, ComicProgress progress, CancellationToken ct) =>
        { await progress.UpdateAsync(id, update, ct); return TypedResults.NoContent(); }).WithName("UpdateReadingProgress");
        app.MapGet("/api/panels/statistics", async (ComicProgress progress, CancellationToken ct) =>
            TypedResults.Ok(await progress.StatisticsAsync(ct))).WithName("GetReadingStatistics");
        app.MapPut("/api/panels/sources", async (PanelSourceUpdate update, HttpContext context, PanelSources sources, CancellationToken ct) => { MutationAccess.CheckOrigin(context.Request); await sources.SaveAsync(update.Locations, ct); return TypedResults.NoContent(); }).WithName("UpdateComicSources");
        var manage = app.MapGroup("/api/panels").AddEndpointFilter<SameOriginFilter>();

        manage.MapPost("/comics/{id:long}/tags", async (long id, ComicTagUpdate update, ComicLibrary library, CancellationToken ct) => { await library.UpdateTagsAsync(id, update, ct); return TypedResults.NoContent(); }).WithName("UpdateComicTags");
        manage.MapPost("/refresh", async (ComicRegistration registration, ComicDiscovery discovery, CancellationToken ct) =>
        { await discovery.RefreshAsync(registration, ct); return TypedResults.NoContent(); }).WithName("RefreshComicFolder");
        manage.MapPost("/discover", async (ComicRegistration registration, ComicLibrary library, CancellationToken ct) =>
            TypedResults.Accepted(uri: (string?)null, value: await library.QueueAsync(registration, ct))).WithName("DiscoverComics");
        manage.MapPut("/comics/{id:long}/metadata", async (long id, ComicMetadataUpdate update, Database database, ComicLibrary library, CancellationToken ct) =>
        {
            var comic = await library.GetAsync(id, ct);
            if (string.IsNullOrWhiteSpace(update.Title) || update.Title.Length > 500 || update.Series.Length > 500 || update.Author.Length > 500 || update.Description.Length > 4096 || update.CoverPage < 0 || update.CoverPage >= comic.PageCount) throw ApiRequestException.Invalid();
            await using var db = await database.OpenAsync(ct);
            using var tx = db.BeginTransaction();
            if (update.CoverPage != comic.CoverPage && await db.ExecuteScalarAsync<bool>(new CommandDefinition("SELECT EXISTS(SELECT 1 FROM ComicJobs WHERE LibraryId=@LibraryId AND State IN ('queued','running'))", comic, tx, cancellationToken: ct))) throw new ApiRequestException(409, "comic_job_active", "Wait for comic discovery before selecting a new cover.");
            await db.ExecuteAsync(new CommandDefinition("UPDATE Comics SET Title=@Title,Series=@Series,Author=@Author,Description=@Description,Favourite=@Favourite,Revision=Revision+CASE WHEN CoverPage<>@CoverPage THEN 1 ELSE 0 END,CoverPage=@CoverPage WHERE Id=@id", new { id, update.Title, update.Series, update.Author, update.Description, update.Favourite, update.CoverPage }, tx, cancellationToken: ct));
            if (update.CoverPage != comic.CoverPage) await db.ExecuteAsync(new CommandDefinition("INSERT INTO ComicJobs(LibraryId,Source,CreatedAt) VALUES(@LibraryId,@RelativePath,@now)", new { comic.LibraryId, comic.RelativePath, now = DateTimeOffset.UtcNow.ToString("O") }, tx, cancellationToken: ct));
            tx.Commit();
            return TypedResults.NoContent();
        }).WithName("UpdateComicMetadata");
    }
}
