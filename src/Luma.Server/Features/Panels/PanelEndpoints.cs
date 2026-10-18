using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Files;
using Luma.Server.Http;

namespace Luma.Server.Features.Panels;

public static class PanelEndpoints
{
    public static void MapPanels(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/panels/sources", async (PanelSources sources, CancellationToken ct) => TypedResults.Ok(await sources.GetAsync(ct))).WithName("GetComicSources");
        app.MapGet("/api/panels/comics", async (string? q, string? state, string? series, bool? favourite, long? cursor, ComicLibrary library, CancellationToken ct) =>
            TypedResults.Ok(await library.ListAsync(q, state, series, favourite, cursor, ct))).WithName("GetComicLibrary");
        app.MapGet("/api/panels/comics/{id:long}", async (long id, ComicLibrary library, CancellationToken ct) =>
            TypedResults.Ok(ComicLibrary.Summary(await library.GetAsync(id, ct)))).WithName("GetComic");
        app.MapGet("/api/panels/comics/{id:long}/pages/{page:int}", (long id, int page, bool? original, ComicPageContent pages, CancellationToken ct) =>
            pages.ServeAsync(id, page, original == true, ct)).WithName("GetComicPage");
        app.MapGet("/api/panels/comics/{id:long}/cover", (long id, ComicPageContent pages, CancellationToken ct) =>
            pages.CoverAsync(id, ct)).WithName("GetComicCover");
        app.MapPut("/api/panels/comics/{id:long}/progress", async (long id, ReadingUpdate update, ComicProgress progress, CancellationToken ct) =>
        { await progress.UpdateAsync(id, update, ct); return TypedResults.NoContent(); }).WithName("UpdateReadingProgress");
        app.MapGet("/api/panels/statistics", async (ComicProgress progress, CancellationToken ct) =>
            TypedResults.Ok(await progress.StatisticsAsync(ct))).WithName("GetReadingStatistics");
        app.MapPut("/api/panels/sources", async (PanelSourceUpdate update, HttpContext context, PanelSources sources, CancellationToken ct) => { MutationAccess.CheckOrigin(context.Request); await sources.SaveAsync(update.Locations, ct); return TypedResults.NoContent(); }).WithName("UpdateComicSources");
        var manage = app.MapGroup("/api/panels").AddEndpointFilter<MutationAccessFilter>();

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
