using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Indexing;
using Luma.Server.Http;
using Microsoft.AspNetCore.StaticFiles;

namespace Luma.Server.Features.Media;

public sealed class OriginalContent(Database database, IndexingOptions options)
{
    public async Task<IResult> ServeAsync(long id, bool download, CancellationToken ct)
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
            var provider = new FileExtensionContentTypeProvider();
            provider.TryGetContentType(source.FileName, out var contentType);
            return Results.File(stream, contentType ?? "application/octet-stream",
                fileDownloadName: download ? source.FileName : null, enableRangeProcessing: true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
        {
            if (stream is not null) await stream.DisposeAsync();
            throw new ApiRequestException(503, "source_unavailable", "The original media is unavailable.");
        }
    }

    private sealed record Source(long LibraryId, string RelativePath, string FileName);
}
