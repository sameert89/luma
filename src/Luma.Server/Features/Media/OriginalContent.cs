using System.Globalization;
using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Indexing;
using Luma.Server.Http;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Net.Http.Headers;

namespace Luma.Server.Features.Media;

public sealed class OriginalContent(Database database, IndexingOptions options)
{
    // Browsers ask for open-ended ranges ("bytes=N-") and abandon them when they seek or
    // have buffered enough. Answering with a bounded chunk lets the connection finish and
    // be reused instead of streaming the rest of a large file into an aborted socket; media
    // elements request the following chunk themselves.
    public const long RangeChunkBytes = 8L * 1024 * 1024;
    private static readonly FileExtensionContentTypeProvider ContentTypes = new();

    public async Task<IResult> ServeAsync(long id, bool download, HttpContext context, CancellationToken ct)
    {
        await using var db = await database.OpenAsync(ct);
        var source = await db.QuerySingleOrDefaultAsync<Source>(new CommandDefinition("""
            SELECT m.LibraryId,m.RelativePath,m.FileName FROM Media m
            JOIN Libraries l ON l.Id=m.LibraryId WHERE m.Id=@id AND l.Enabled=1
            """, new { id }, cancellationToken: ct));
        if (source is null) throw ApiRequestException.Missing();
        var root = options.Libraries.SingleOrDefault(x => x.Id == source.LibraryId);
        FileStream? stream = null;
        try
        {
            if (root is null) throw new IOException();
            ct.ThrowIfCancellationRequested();
            var path = SourcePaths.Resolve(root, source.RelativePath);
            stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete,
                64 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
            SourcePaths.Check(root, path);
            ContentTypes.TryGetContentType(source.FileName, out var contentType);
            var modified = new DateTimeOffset(File.GetLastWriteTimeUtc(stream.SafeFileHandle), TimeSpan.Zero);
            var length = stream.Length;
            // A strong validator lets browsers reuse cached byte ranges across seeks and reels.
            var tag = new EntityTagHeaderValue($"\"{length.ToString("x", CultureInfo.InvariantCulture)}-{modified.UtcTicks.ToString("x", CultureInfo.InvariantCulture)}\"");
            if (!download) BoundOpenRange(context.Request, length);
            context.Response.Headers.CacheControl = "private, max-age=86400";
            return Results.File(stream, contentType ?? "application/octet-stream",
                fileDownloadName: download ? source.FileName : null, lastModified: modified, entityTag: tag, enableRangeProcessing: true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
        {
            if (stream is not null) await stream.DisposeAsync();
            throw new ApiRequestException(503, "source_unavailable", "The original media is unavailable.");
        }
    }

    internal static void BoundOpenRange(HttpRequest request, long length)
    {
        if (!RangeHeaderValue.TryParse(request.Headers.Range.ToString(), out var range)
            || !string.Equals(range.Unit.Value, "bytes", StringComparison.OrdinalIgnoreCase) || range.Ranges.Count != 1) return;
        var only = range.Ranges.First();
        if (only.From is not { } from || only.To is not null || from >= length || length - from <= RangeChunkBytes) return;
        request.Headers.Range = $"bytes={from.ToString(CultureInfo.InvariantCulture)}-{(from + RangeChunkBytes - 1).ToString(CultureInfo.InvariantCulture)}";
    }

    private sealed record Source(long LibraryId, string RelativePath, string FileName);
}
