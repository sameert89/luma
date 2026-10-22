using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Indexing;
using Luma.Server.MediaProcessing;
using Microsoft.AspNetCore.StaticFiles;
using Luma.Server.Http;

namespace Luma.Server.Features.Panels;

public sealed class ComicPageContent(Database database, IndexingOptions options, ComicLibrary library, MediaProcessor decoder)
{
    private readonly SemaphoreSlim slots = new(2);
    private readonly SemaphoreSlim trimGate = new(1);
    private const long Quota = 512L * 1024 * 1024;
    private static readonly FileExtensionContentTypeProvider Mime = new();

    public async Task<IResult> ServeAsync(long id, int page, bool original, CancellationToken ct)
    {
        var comic = await library.GetAsync(id, ct);
        if (page < 0 || page >= comic.PageCount) throw ApiRequestException.Invalid();
        var path = await PrepareAsync(comic, page, original ? "original" : "page", ct);
        Mime.TryGetContentType(path, out var mime);
        return Results.File(path, mime ?? "image/jpeg", lastModified: new DateTimeOffset(comic.SourceModifiedTicks, TimeSpan.Zero), enableRangeProcessing: true);
    }
    public async Task<IResult> CoverAsync(long id, CancellationToken ct)
    {
        var comic = await library.GetAsync(id, ct);
        await using var db = await database.OpenAsync(ct);
        var relative = await db.ExecuteScalarAsync<string>(new CommandDefinition("SELECT RelativePath FROM ComicCache WHERE ComicId=@Id AND Revision=@Revision AND Variant='cover'", comic, cancellationToken: ct));
        if (relative is null) throw ApiRequestException.Missing();
        // Cover listing/viewing never opens the original archive. Discovery prepares the cover.
        return Results.File(Path.Combine(options.CachePath, relative), "image/webp", lastModified: new DateTimeOffset(comic.SourceModifiedTicks, TimeSpan.Zero));
    }
    internal async Task<string> PrepareAsync(ComicRow comic, int page, string variant, CancellationToken ct)
    {
        await slots.WaitAsync(ct);
        try
        {
            await using var db = await database.OpenAsync(ct);
            var cacheVariant = variant == "cover" ? "cover" : $"{variant}-{page}";
            var existing = await db.ExecuteScalarAsync<string>(new CommandDefinition("SELECT RelativePath FROM ComicCache WHERE ComicId=@Id AND Revision=@Revision AND Variant=@cacheVariant", new { comic.Id, comic.Revision, cacheVariant }, cancellationToken: ct));
            if (existing is not null && File.Exists(Path.Combine(options.CachePath, existing)))
            {
                await db.ExecuteAsync(new CommandDefinition("UPDATE ComicCache SET LastAccessAt=@now WHERE ComicId=@Id AND Revision=@Revision AND Variant=@cacheVariant", new { comic.Id, comic.Revision, cacheVariant, now = DateTimeOffset.UtcNow.ToString("O") }, cancellationToken: ct));
                return Path.Combine(options.CachePath, existing);
            }
            var sourcePage = await db.QuerySingleOrDefaultAsync<ComicPageSource>(new CommandDefinition("SELECT EntryName Name,SizeBytes FROM ComicPages WHERE ComicId=@Id AND PageIndex=@page", new { comic.Id, page }, cancellationToken: ct)) ?? throw ApiRequestException.Missing();
            var root = options.Libraries.Find(x => x.Id == comic.LibraryId) ?? throw ApiRequestException.Missing();
            var source = SourcePaths.Resolve(root, comic.RelativePath);
            if (comic.Format != "folder" && (new FileInfo(source).Length != comic.SourceSize || File.GetLastWriteTimeUtc(source).Ticks != comic.SourceModifiedTicks))
                throw new ApiRequestException(409, "comic_source_changed", "Rediscover this comic after the source changed.");
            var directory = Path.Combine(options.CachePath, "comics");
            Directory.CreateDirectory(directory);
            var temp = Path.Combine(directory, Guid.NewGuid().ToString("N"));
            var raw = temp + Path.GetExtension(sourcePage.Name).ToLowerInvariant();
            var thumbnail = temp + ".webp";
            var preview = temp + ".jpg";
            await options.ProcessingSlots.WaitAsync(ct);
            try
            {
                using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
                deadline.CancelAfter(TimeSpan.FromSeconds(60));
                await ComicSources.ExtractIsolatedAsync(source, comic.Format == "folder", sourcePage, raw, deadline.Token);
                // Reuse the bounded decoder pool for validation, orientation, covers and previews.
                await decoder.ProcessAsync(raw, "image", thumbnail, variant == "cover" ? null : preview, deadline.Token);
                var selected = variant switch { "cover" => thumbnail, "original" => raw, _ => preview };
                var relative = Path.GetRelativePath(options.CachePath, selected);
                await db.ExecuteAsync(new CommandDefinition("""
                    INSERT INTO ComicCache(ComicId,Revision,Variant,RelativePath,SizeBytes,LastAccessAt) VALUES(@Id,@Revision,@cacheVariant,@relative,@size,@now)
                    ON CONFLICT(ComicId,Revision,Variant) DO UPDATE SET RelativePath=excluded.RelativePath,SizeBytes=excluded.SizeBytes,LastAccessAt=excluded.LastAccessAt
                    """, new { comic.Id, comic.Revision, cacheVariant, relative, size = new FileInfo(selected).Length, now = DateTimeOffset.UtcNow.ToString("O") }, cancellationToken: ct));
                if (selected != raw) File.Delete(raw);
                if (selected != thumbnail) File.Delete(thumbnail);
                if (selected != preview) File.Delete(preview);
                await TrimAsync(ct);
                return selected;
            }
            catch
            {
                foreach (var file in new[] { raw, thumbnail, preview }) File.Delete(file);
                throw;
            }
            finally { options.ProcessingSlots.Release(); }
        }
        finally { slots.Release(); }
    }
    private async Task TrimAsync(CancellationToken ct)
    {
        await trimGate.WaitAsync(ct);
        try
        {
            await using var db = await database.OpenAsync(ct);
            while (await db.ExecuteScalarAsync<long>(new CommandDefinition("SELECT COALESCE(SUM(SizeBytes),0) FROM ComicCache", cancellationToken: ct)) > Quota)
            {
                var row = await db.QueryFirstOrDefaultAsync<CacheRow>(new CommandDefinition("SELECT * FROM ComicCache ORDER BY LastAccessAt LIMIT 1", cancellationToken: ct));
                if (row is null) break;
                File.Delete(Path.Combine(options.CachePath, row.RelativePath));
                await db.ExecuteAsync(new CommandDefinition("DELETE FROM ComicCache WHERE RelativePath=@RelativePath", row, cancellationToken: ct));
            }
        }
        finally { trimGate.Release(); }
    }
    private sealed class CacheRow { public string RelativePath { get; set; } = ""; }
}
