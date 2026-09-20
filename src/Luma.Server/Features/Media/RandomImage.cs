using System.Security.Cryptography;
using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Indexing;
using Luma.Server.Http;

namespace Luma.Server.Features.Media;

public sealed class RandomImage(Database database, CacheContent cache, OriginalContent originals)
{
    public async Task<IResult> ServeAsync(MediaQuery query, HttpContext context, CancellationToken ct)
    {
        context.Response.Headers.CacheControl = "no-store";
        if (query.MediaType is "video" or "motion" || query.Cursor is not null) throw ApiRequestException.Invalid("Random content requires images and does not accept page cursors.");
        query = query with { MediaType = query.MediaType == "gif" ? "gif" : "image" };
        var (predicate, p) = query.Predicate();
        p.Add("pivot", BitConverter.ToInt64(RandomNumberGenerator.GetBytes(8)) & long.MaxValue);
        p.Add("encoder", IndexingOptions.EncoderVersion);
        await using var db = await database.OpenAsync(ct);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(2));
        using var interrupt = deadline.Token.Register(() => SQLitePCL.raw.sqlite3_interrupt(db.Handle));
        try
        {
            if (query.FolderId is { } folder)
            {
                var library = await db.QuerySingleOrDefaultAsync<long?>(new CommandDefinition("SELECT LibraryId FROM Folders WHERE Id=@folder", new { folder }, cancellationToken: deadline.Token));
                if (library is null) throw ApiRequestException.Missing();
                if (query.LibraryId is { } root && root != library) throw ApiRequestException.Invalid();
            }
            // Previews are prepared on demand, so choose among every match. One without a preview yet is
            // served as its original (browsers decode these formats) and gets a preview for next time.
            var preview = "EXISTS(SELECT 1 FROM CacheEntries c WHERE c.MediaId=m.Id AND c.SourceRevision=m.SourceRevision AND c.EncoderVersion=@encoder AND c.Variant='preview' AND c.State='ready')";
            var pick = await db.QuerySingleOrDefaultAsync<Pick>(new CommandDefinition($"SELECT m.Id,m.SourceRevision,m.Extension,{preview} Ready FROM Media m WHERE {predicate} AND m.RandomKey>=@pivot ORDER BY m.RandomKey,m.Id LIMIT 1", p, cancellationToken: deadline.Token))
                ?? await db.QuerySingleOrDefaultAsync<Pick>(new CommandDefinition($"SELECT m.Id,m.SourceRevision,m.Extension,{preview} Ready FROM Media m WHERE {predicate} AND m.RandomKey<@pivot ORDER BY m.RandomKey,m.Id LIMIT 1", p, cancellationToken: deadline.Token));
            if (pick is null) throw ApiRequestException.Missing();
            if (pick.Ready) return await cache.ServeAsync(pick.Id, pick.SourceRevision, "preview", IndexingOptions.EncoderVersion, context, ct, true);
            await MediaBrowser.PrioritizeAsync(db, [pick.Id], true, ct);
            if (BrowserImages.Contains(pick.Extension))
            {
                try
                {
                    var original = await originals.ServeAsync(pick.Id, false, context, ct);
                    context.Response.Headers.CacheControl = "no-store";
                    return original;
                }
                catch (ApiRequestException error) when (error.Status == 503) { }
            }
            // The original is offline or needs conversion: fall back to media whose preview is cached.
            var ready = $" AND {preview}";
            var row = await db.QuerySingleOrDefaultAsync<MediaRow>(new CommandDefinition($"SELECT m.Id,m.SourceRevision FROM Media m WHERE {predicate} {ready} AND m.RandomKey>=@pivot ORDER BY m.RandomKey,m.Id LIMIT 1", p, cancellationToken: deadline.Token))
                ?? await db.QuerySingleOrDefaultAsync<MediaRow>(new CommandDefinition($"SELECT m.Id,m.SourceRevision FROM Media m WHERE {predicate} {ready} AND m.RandomKey<@pivot ORDER BY m.RandomKey,m.Id LIMIT 1", p, cancellationToken: deadline.Token));
            if (row is null) throw new ApiRequestException(503, "cache_unavailable", "No matching cached preview is ready.");
            return await cache.ServeAsync(row.Id, row.SourceRevision, "preview", IndexingOptions.EncoderVersion, context, ct, true);
        }
        catch (Exception error) when (deadline.IsCancellationRequested && !ct.IsCancellationRequested && error is Microsoft.Data.Sqlite.SqliteException or OperationCanceledException)
        {
            throw new ApiRequestException(503, "query_timeout", "Try narrowing the filters.");
        }
    }
    private static readonly HashSet<string> BrowserImages = new([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"], StringComparer.OrdinalIgnoreCase);
    private sealed class Pick { public long Id { get; set; } public long SourceRevision { get; set; } public string Extension { get; set; } = ""; public bool Ready { get; set; } }
}
