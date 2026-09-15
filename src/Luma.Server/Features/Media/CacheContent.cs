using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Indexing;
using Luma.Server.Http;
using Microsoft.Net.Http.Headers;

namespace Luma.Server.Features.Media;

public sealed class CacheContent(Database database,IndexingOptions options,CacheAccessLog access)
{
    public async Task<IResult> ServeAsync(long id,long revision,string variant,int? v,HttpContext context,CancellationToken ct)
    {
        if(variant is not ("thumbnail" or "preview" or "poster") || (v??IndexingOptions.EncoderVersion)!=IndexingOptions.EncoderVersion) throw ApiRequestException.Missing();
        await using var db=await database.OpenAsync(ct);
        var media=await db.QuerySingleOrDefaultAsync<MediaRow>(new CommandDefinition("SELECT Id,SourceRevision,MediaType FROM Media WHERE Id=@id",new{id},cancellationToken:ct));
        if(media is null || media.SourceRevision!=revision || (variant=="preview" && media.MediaType!="image") || (variant=="poster" && media.MediaType!="video")) throw ApiRequestException.Missing();
        var entry=await db.QuerySingleOrDefaultAsync<MediaProcessing.CacheEntry>(new CommandDefinition("""
            SELECT * FROM CacheEntries WHERE MediaId=@id AND SourceRevision=@revision AND Variant=@variant AND EncoderVersion=@version
            """,new{id,revision,variant,version=IndexingOptions.EncoderVersion},cancellationToken:ct));
        if(entry?.State=="ready")
        {
            FileStream? stream=null;
            try
            {
                stream=new FileStream(System.IO.Path.Combine(options.CachePath,entry.RelativePath),FileMode.Open,FileAccess.Read,FileShare.Read|FileShare.Delete,64*1024,FileOptions.Asynchronous|FileOptions.SequentialScan);
                // Full hash verification runs in bounded background maintenance. The request path
                // validates that the generated file still exists at the recorded length.
                var valid=stream.Length==entry.SizeBytes;
                if(valid)
                {
                    stream.Position=0;
                    access.Record(id);
                    context.Response.Headers.CacheControl="public,max-age=31536000,immutable";
                    return Results.File(stream,variant=="thumbnail"?"image/webp":"image/jpeg",entityTag:new EntityTagHeaderValue('"'+entry.ContentHash+'"'));
                }
            }
            catch(Exception error) when(error is IOException or UnauthorizedAccessException) { }
            catch {if(stream is not null) await stream.DisposeAsync();throw;}
            if(stream is not null) await stream.DisposeAsync();
        }
        await QueueAsync(id,revision,ct);
        context.Response.Headers.RetryAfter="30";
        throw new ApiRequestException(503,"cache_unavailable","This preview is not available yet. Background processing will retry it.");
    }
    public async Task QueueAsync(long id,long revision,CancellationToken ct)
    {
        await using var db=await database.OpenAsync(ct);
        await db.ExecuteAsync(new CommandDefinition("""
            INSERT INTO ProcessingJobs(MediaId,SourceRevision,EncoderVersion,ScanId,MediaType,State,NextAttemptAt)
            SELECT m.Id,m.SourceRevision,@version,m.LastSeenScanId,m.MediaType,'pending',@now FROM Media m
              JOIN Libraries l ON l.Id=m.LibraryId JOIN Scans s ON s.Id=m.LastSeenScanId
              WHERE m.Id=@id AND m.SourceRevision=@revision AND l.Enabled=1 AND m.Availability='present' AND s.State IN ('running','completed')
            ON CONFLICT(MediaId,SourceRevision,EncoderVersion) DO UPDATE SET
              State=CASE WHEN ProcessingJobs.State IN ('ready','failed','waiting') AND ProcessingJobs.NextAttemptAt<=@now THEN 'pending' ELSE ProcessingJobs.State END,
              NextAttemptAt=CASE WHEN ProcessingJobs.State IN ('ready','failed','waiting') AND ProcessingJobs.NextAttemptAt<=@now THEN @now ELSE ProcessingJobs.NextAttemptAt END,
              Attempts=CASE WHEN ProcessingJobs.State='ready' THEN 0 ELSE ProcessingJobs.Attempts END
              WHERE ProcessingJobs.State IN ('ready','failed','waiting') AND ProcessingJobs.NextAttemptAt<=@now;
            """,new{id,revision,version=IndexingOptions.EncoderVersion,now=DateTimeOffset.UtcNow.ToString("O")},cancellationToken:ct));
    }
}
