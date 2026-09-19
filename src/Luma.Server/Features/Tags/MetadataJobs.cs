using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Indexing;
using Luma.Server.Features.Media;
using Luma.Server.Http;
using Microsoft.Data.Sqlite;

namespace Luma.Server.Features.Tags;

public sealed record MetadataJobRequest(long[]? MediaIds = null,MediaQuery? Query = null,bool IncludeSidecars = false,bool Automatic = false,long? ScanId = null);
public sealed record JobAccepted(long Id);
public sealed record JobItem(long MediaId,string Code);
public sealed record MetadataJobStatus(long Id,string Kind,string State,string CreatedAt,string? SnapshotAt,string? FinishedAt,
    int Processed,int Failed,string? FailureCode,IReadOnlyList<JobItem> Items,long? NextMediaId,string? ContentUrl,int Found = 0,int Updated = 0,int Skipped = 0);

// One durable queue, one worker. Imports are capped at 500 selected items and exports
// stream 100-row batches from one SQLite read snapshot without loading the whole result.
public sealed class MetadataJobs(Database database,IndexingOptions options,ILogger<MetadataJobs>? logger = null,MediaProcessing.MediaProcessor? processor = null) : BackgroundService
{
    // Keyword reads reuse the pooled image workers; a standalone service owns its own pool.
    private readonly MediaProcessing.MediaProcessor? ownedProcessor = processor is null ? new(options) : null;
    private MediaProcessing.MediaProcessor Processor => processor ?? ownedProcessor!;
    private readonly ConcurrentDictionary<long,CancellationTokenSource> active = new();
    private const long Quota=1024L*1024*1024;
    private string JobDirectory => Path.Combine(Path.GetDirectoryName(database.Path)!,"exports");
    private string ContentPath(long id,string kind) => Path.Combine(JobDirectory,$"{id}.{(kind=="xmp"?"zip":"jsonl")}");

    public async Task<JobAccepted> EnqueueAsync(string kind,MetadataJobRequest request,CancellationToken ct)
    {
        if(request.MediaIds is { } ids && (ids.Length is <1 or >500 || ids.Any(x=>x<=0))) throw ApiRequestException.Invalid("Select 1 to 500 positive media IDs.");
        // Import without an explicit selection walks every media item matching the query
        // instead, one at a time like a scan; there is no 500 cap for that path.
        var query=(request.Query ?? new MediaQuery()).Normalize();
        if(query.Cursor is not null) throw ApiRequestException.Invalid("Jobs do not accept page cursors.");
        request=request with { Query=query,MediaIds=request.MediaIds?.Distinct().ToArray() };
        await using var db=await database.OpenAsync(ct);
        using var tx=db.BeginTransaction();
        if(await db.ExecuteScalarAsync<int>(new CommandDefinition("SELECT COUNT(*) FROM MetadataJobs WHERE State IN ('queued','running')",transaction:tx,cancellationToken:ct))>=16)
            throw new ApiRequestException(429,"rate_limited","The metadata job queue is full.");
        if(request.MediaIds is not null && await db.ExecuteScalarAsync<bool>(new CommandDefinition("SELECT EXISTS(SELECT value FROM json_each(@ids) WHERE value NOT IN (SELECT Id FROM Media))",new{ids=JsonSerializer.Serialize(request.MediaIds)},tx,cancellationToken:ct))) throw ApiRequestException.Missing();
        if(query.FolderId is { } folder) {
            var library=await db.QuerySingleOrDefaultAsync<long?>(new CommandDefinition("SELECT LibraryId FROM Folders WHERE Id=@folder",new{folder},tx,cancellationToken:ct));
            if(library is null) throw ApiRequestException.Missing();
            if(query.LibraryId is { } root && root!=library) throw ApiRequestException.Invalid();
        }
        var id=await db.ExecuteScalarAsync<long>(new CommandDefinition("INSERT INTO MetadataJobs(Kind,State,Request,CreatedAt,ScanId) VALUES(@kind,'queued',@request,@now,@scanId) RETURNING Id",
            new{kind,scanId=request.ScanId,request=JsonSerializer.Serialize(request),now=DateTimeOffset.UtcNow.ToString("O")},tx,cancellationToken:ct));
        if(request.ScanId is { } scanId) await db.ExecuteAsync(new CommandDefinition("UPDATE Scans SET MetadataQueued=1 WHERE Id=@scanId",new{scanId},tx,cancellationToken:ct));
        tx.Commit();
        return new(id);
    }

    public async Task CancelAsync(long id,CancellationToken ct)
    {
        await using var db=await database.OpenAsync(ct);
        if(!await db.ExecuteScalarAsync<bool>(new CommandDefinition("SELECT EXISTS(SELECT 1 FROM MetadataJobs WHERE Id=@id)",new{id},cancellationToken:ct))) throw ApiRequestException.Missing();
        var changed=await db.ExecuteAsync(new CommandDefinition("UPDATE MetadataJobs SET State='cancelled',FinishedAt=@now WHERE Id=@id AND State IN ('queued','running')",new{id,now=DateTimeOffset.UtcNow.ToString("O")},cancellationToken:ct));
        if(changed>0 && active.TryGetValue(id,out var source)) { try { source.Cancel(); } catch(ObjectDisposedException) { } }
    }

    // Always a new job: the stopped record stays terminal (and clearable), so a worker still
    // winding down the old ID can never write into the new run.
    public async Task<JobAccepted> QueueAgainAsync(long id,CancellationToken ct)
    {
        Job job;
        await using(var db=await database.OpenAsync(ct))
            job=await db.QuerySingleOrDefaultAsync<Job>(new CommandDefinition("SELECT * FROM MetadataJobs WHERE Id=@id",new{id},cancellationToken:ct)) ?? throw ApiRequestException.Missing();
        if(job.State is "queued" or "running" || active.ContainsKey(id)) throw new ApiRequestException(409,"conflict","This operation is still stopping or already queued.");
        var queued=await EnqueueAsync(job.Kind,JsonSerializer.Deserialize<MetadataJobRequest>(job.Request)! with {ScanId=null},ct);
        await using(var db=await database.OpenAsync(ct))
            await db.ExecuteAsync(new CommandDefinition("UPDATE MetadataJobs SET QueueDismissed=1 WHERE Id=@id",new{id},cancellationToken:ct));
        return queued;
    }

    public async Task<MetadataJobStatus> StatusAsync(long id,long? afterMediaId,CancellationToken ct)
    {
        if(afterMediaId<0) throw ApiRequestException.Invalid();
        await using var db=await database.OpenAsync(ct);
        var job=await db.QuerySingleOrDefaultAsync<Job>(new CommandDefinition("SELECT * FROM MetadataJobs WHERE Id=@id",new{id},cancellationToken:ct)) ?? throw ApiRequestException.Missing();
        var items=(await db.QueryAsync<JobItem>(new CommandDefinition("SELECT MediaId,Code FROM MetadataJobItems WHERE JobId=@id AND MediaId>@after ORDER BY MediaId LIMIT 101",new{id,after=afterMediaId??0},cancellationToken:ct))).ToList();
        var more=items.Count>100;
        if(more) items.RemoveAt(100);
        return new(job.Id,job.Kind,job.State,job.CreatedAt,job.SnapshotAt,job.FinishedAt,job.Processed,job.Failed,job.FailureCode,items,
            more?items[^1].MediaId:null,job.State=="completed" && job.Kind!="import"?$"/api/jobs/{id}/content":null,job.Found,job.Updated,job.Skipped);
    }

    public async Task<IResult> ContentAsync(long id,CancellationToken ct)
    {
        var status=await StatusAsync(id,null,ct);
        if(status.State!="completed" || status.Kind=="import") throw ApiRequestException.Missing();
        if(DateTimeOffset.Parse(status.FinishedAt!)<DateTimeOffset.UtcNow.AddHours(-24)) throw ApiRequestException.Missing();
        try {
            var stream=new FileStream(ContentPath(id,status.Kind),FileMode.Open,FileAccess.Read,FileShare.Read|FileShare.Delete,65536,FileOptions.Asynchronous|FileOptions.SequentialScan);
            return Results.File(stream,status.Kind=="xmp"?"application/zip":"application/x-ndjson",$"luma-{status.Kind}-{id}.{(status.Kind=="xmp"?"zip":"jsonl")}");
        } catch(IOException) { throw ApiRequestException.Missing(); }
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        Directory.CreateDirectory(JobDirectory);
        var recovered=false;
        while(!ct.IsCancellationRequested) {
            try {
                if(!recovered) { await RecoverAsync(ct); recovered=true; }
                if(!await RunNextAsync(ct)) await Task.Delay(1000,ct);
            }
            catch(OperationCanceledException) when(ct.IsCancellationRequested) { return; }
            // Never let an exception leave this loop: the host stops on an unhandled background
            // failure, and every restart interrupts scans and preview generation. A busy database
            // (other writers hold the lock past the busy timeout) simply waits and retries.
            catch(SqliteException error) when(error.SqliteErrorCode is 5 or 6) { await Task.Delay(5000,ct); }
            catch(Exception error) {
                logger?.LogError(error,"Metadata jobs paused; queued work will be retried");
                await Task.Delay(5000,ct);
            }
        }
    }

    private async Task RecoverAsync(CancellationToken ct)
    {
        await using(var db=await database.OpenAsync(ct)) {
            var interrupted=await db.QueryAsync<Job>(new CommandDefinition("SELECT * FROM MetadataJobs WHERE Kind<>'import' AND (State='running' OR FailureCode='interrupted')",cancellationToken:ct));
            foreach(var job in interrupted) {
                File.Delete(ContentPath(job.Id,job.Kind));
                File.Delete(ContentPath(job.Id,job.Kind)+".tmp");
            }
            await db.ExecuteAsync(new CommandDefinition("UPDATE MetadataJobs SET State='failed',FailureCode='interrupted',ContentBytes=0,FinishedAt=@now WHERE State='running' AND Kind<>'import'; UPDATE MetadataJobs SET State='queued',FailureCode=NULL,FinishedAt=NULL WHERE Kind='import' AND State='running'",new{now=DateTimeOffset.UtcNow.ToString("O")},cancellationToken:ct));
        }
    }

    // Runs one queued job; false when the queue is empty.
    private async Task<bool> RunNextAsync(CancellationToken ct)
    {
        await CleanupAsync(ct);
        await using(var repair=await database.OpenAsync(ct)) {
            using var tx=repair.BeginTransaction();
            if(await repair.ExecuteScalarAsync<int>(new CommandDefinition("SELECT COUNT(*) FROM MetadataJobs WHERE State IN ('queued','running')",transaction:tx,cancellationToken:ct))<16) {
                var scan=await repair.QuerySingleOrDefaultAsync<ScanRow>(new CommandDefinition("SELECT s.* FROM Scans s JOIN Libraries l ON l.Id=s.LibraryId WHERE l.Enabled=1 AND s.MetadataQueued=0 AND s.MetadataMode<>'none' AND s.State IN ('queued','running','completed') ORDER BY s.Id LIMIT 1",transaction:tx,cancellationToken:ct));
                if(scan is not null) {
                    var request=new MetadataJobRequest(Query:new MediaQuery{LibraryId=scan.LibraryId,FolderId=scan.FolderId}.Normalize(),IncludeSidecars:scan.MetadataMode=="xmp",Automatic:true,ScanId:scan.Id);
                    await repair.ExecuteAsync(new CommandDefinition("INSERT INTO MetadataJobs(Kind,State,Request,CreatedAt,ScanId) VALUES('import','queued',@request,@now,@scanId); UPDATE Scans SET MetadataQueued=1 WHERE Id=@scanId",new{scanId=scan.Id,request=JsonSerializer.Serialize(request),now=DateTimeOffset.UtcNow.ToString("O")},transaction:tx,cancellationToken:ct));
                }
            }
            tx.Commit();
        }
        Job? job;
        await using(var db=await database.OpenAsync(ct)) job=await db.QuerySingleOrDefaultAsync<Job>(new CommandDefinition("UPDATE MetadataJobs SET State='running' WHERE Id=(SELECT Id FROM MetadataJobs WHERE State='queued' AND (ScanId IS NULL OR NOT EXISTS(SELECT 1 FROM Scans WHERE LibraryId=json_extract(MetadataJobs.Request,'$.Query.LibraryId') AND State IN ('queued','running'))) ORDER BY Id LIMIT 1) RETURNING *",cancellationToken:ct));
        if(job is null) return false;
        using var jobCancellation=CancellationTokenSource.CreateLinkedTokenSource(ct);
        active[job.Id]=jobCancellation;
        try { return await RunClaimedAsync(job,jobCancellation,ct); }
        finally {
            active.TryRemove(job.Id,out _);
            if(jobCancellation.IsCancellationRequested && !ct.IsCancellationRequested) {
                File.Delete(ContentPath(job.Id,job.Kind));
                File.Delete(ContentPath(job.Id,job.Kind)+".tmp");
            }
        }
    }

    private async Task<bool> RunClaimedAsync(Job job,CancellationTokenSource cancellation,CancellationToken hostToken)
    {
        var ct=cancellation.Token;
        await using(var check=await database.OpenAsync(hostToken)) {
            if(await check.ExecuteScalarAsync<string>(new CommandDefinition("SELECT State FROM MetadataJobs WHERE Id=@Id",job,cancellationToken:hostToken))!="running") return true;
        }
        var (state,code,bytes)=("completed",(string?)null,0L);
        try {
            var request=JsonSerializer.Deserialize<MetadataJobRequest>(job.Request)!;
            if(request.ScanId is { } scanId) {
                await using var lookup=await database.OpenAsync(ct);
                var scanState=await lookup.ExecuteScalarAsync<string>(new CommandDefinition("SELECT State FROM Scans WHERE Id=@scanId",new{scanId},cancellationToken:ct));
                if(scanState is "cancelled" or "failed") throw new IOException("Indexing did not finish.");
            }
            if(job.Kind=="import") await ImportAsync(job,request,ct);
            else await ExportAsync(job,request,ct);
            bytes=job.Kind=="import"?0:new FileInfo(ContentPath(job.Id,job.Kind)).Length;
        } catch(OperationCanceledException) when(hostToken.IsCancellationRequested) { throw; }
        // Cancelled (or otherwise finished) elsewhere while running: its state is already terminal.
        catch(Exception error) when(error is JobStoppedException || error is OperationCanceledException && ct.IsCancellationRequested) {
            File.Delete(ContentPath(job.Id,job.Kind));
            File.Delete(ContentPath(job.Id,job.Kind)+".tmp");
            return true;
        }
        catch(SqliteException error) when(error.SqliteErrorCode is 5 or 6 && job.Kind=="import") {
            await using var retry=await database.OpenAsync(ct);
            await retry.ExecuteAsync(new CommandDefinition("UPDATE MetadataJobs SET State='queued' WHERE Id=@Id AND State='running'",job,cancellationToken:ct));
            await Task.Delay(1000,ct);
            return true;
        }
        catch(Exception error) {
            File.Delete(ContentPath(job.Id,job.Kind));
            File.Delete(ContentPath(job.Id,job.Kind)+".tmp");
            (state,code)=("failed",error is JobQuotaException?"job_quota_exceeded":"metadata_job_failed");
        }
        // Recorded outside the job's own error handling, so a busy database while saving the
        // outcome cannot turn a finished export into a failed one.
        await FinishAsync(job.Id,state,code,bytes,hostToken);
        return true;
    }

    private async Task CleanupAsync(CancellationToken ct)
    {
        await using var db=await database.OpenAsync(ct);
        var expired=await db.QueryAsync<Job>(new CommandDefinition("SELECT * FROM MetadataJobs WHERE State IN ('completed','failed') AND FinishedAt<@cutoff",new{cutoff=DateTimeOffset.UtcNow.AddHours(-24).ToString("O")},cancellationToken:ct));
        foreach(var job in expired) {
            File.Delete(ContentPath(job.Id,job.Kind)); File.Delete(ContentPath(job.Id,job.Kind)+".tmp");
            await db.ExecuteAsync(new CommandDefinition("UPDATE MetadataJobs SET State='expired',ContentBytes=0 WHERE Id=@Id",job,cancellationToken:ct));
        }
    }

    private async Task ExportAsync(Job job,MetadataJobRequest request,CancellationToken ct)
    {
        await using var db=await database.OpenAsync(ct);
        using var tx=db.BeginTransaction(deferred:true);
        // Establish the snapshot before recording its timestamp through a separate writer.
        await db.ExecuteScalarAsync<long>(new CommandDefinition("SELECT COUNT(*) FROM SchemaMigrations",transaction:tx,cancellationToken:ct));
        var snapshot=DateTimeOffset.UtcNow.ToString("O");
        await using(var writer=await database.OpenAsync(ct)) await writer.ExecuteAsync(new CommandDefinition("UPDATE MetadataJobs SET SnapshotAt=@snapshot WHERE Id=@Id",new{job.Id,snapshot},cancellationToken:ct));
        var (predicate,p)=(request.Query! with {Availability="all",Preference=job.Kind=="dislikes"?"disliked":request.Query.Preference}).Predicate();
        if(job.Kind!="dislikes") (predicate,p)=request.Query.Predicate();
        if(request.MediaIds is not null) { predicate+=" AND m.Id IN (SELECT value FROM json_each(@ids))"; p.Add("ids",JsonSerializer.Serialize(request.MediaIds)); }
        var used=await db.ExecuteScalarAsync<long>(new CommandDefinition("SELECT COALESCE(SUM(ContentBytes),0) FROM MetadataJobs",transaction:tx,cancellationToken:ct));
        long written=0,after=0;
        await using var file=new FileStream(ContentPath(job.Id,job.Kind)+".tmp",FileMode.Create,FileAccess.Write,FileShare.None,65536,FileOptions.Asynchronous);
        using var archive=job.Kind=="xmp"?new ZipArchive(file,ZipArchiveMode.Create,true):null;
        Stream manifest=file;
        // ZIP permits only one open entry. Write manifest to a small streaming temporary file,
        // then copy it into the archive after all sidecars have been written.
        if(archive is not null) { manifest=new FileStream(ContentPath(job.Id,job.Kind)+".manifest",FileMode.Create,FileAccess.ReadWrite,FileShare.None,65536,FileOptions.Asynchronous|FileOptions.DeleteOnClose); }
        async Task WriteAsync(Stream destination,byte[] bytes) {
            written+=bytes.Length;
            if(used+written>Quota) throw new JobQuotaException();
            await destination.WriteAsync(bytes,ct);
        }
        try {
            while(true) {
                p.Add("after",after);
                var rows=(await db.QueryAsync<ExportRow>(new CommandDefinition($"SELECT m.Id,m.LibraryId,m.RelativePath,m.Availability,l.Path LibraryPath FROM Media m JOIN Libraries l ON l.Id=m.LibraryId WHERE {predicate} AND m.Id>@after ORDER BY m.Id LIMIT 100",p,tx,cancellationToken:ct))).ToArray();
                if(rows.Length==0) break;
                var tagRows=job.Kind=="xmp" ? (await db.QueryAsync<ExportTag>(new CommandDefinition("SELECT mt.MediaId,t.Name FROM MediaTags mt JOIN Tags t ON t.Id=mt.TagId WHERE mt.MediaId IN (SELECT value FROM json_each(@ids)) ORDER BY t.NormalizedKey,t.Id",new{ids=JsonSerializer.Serialize(rows.Select(x=>x.Id))},tx,cancellationToken:ct))).ToLookup(x=>x.MediaId) : null;
                foreach(var row in rows) {
                    if(archive is null) await WriteAsync(manifest,Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new{mediaId=row.Id,path=Path.GetFullPath(Path.Combine(row.LibraryPath,row.RelativePath)),availability=row.Availability})+"\n"));
                    else {
                        await using(var entry=archive.CreateEntry($"{row.Id}.xmp").Open()) await WriteAsync(entry,MetadataKeywords.WriteXmp(tagRows![row.Id].Select(x=>x.Name)));
                        await WriteAsync(manifest,Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new{mediaId=row.Id,libraryId=row.LibraryId,relativePath=row.RelativePath,sidecar=$"{row.Id}.xmp"})+"\n"));
                    }
                }
                after=rows[^1].Id;
                await ProgressAsync(job.Id,rows.Length,0,ct);
            }
            if(archive is not null) {
                manifest.Position=0;
                await using(var entry=archive.CreateEntry("paths.jsonl").Open()) await manifest.CopyToAsync(entry,ct);
                await using(var entry=archive.CreateEntry("MERGE-INSTRUCTIONS.txt").Open()) await WriteAsync(entry,Encoding.UTF8.GetBytes(MergeInstructions));
            }
        } finally { if(archive is not null) await manifest.DisposeAsync(); }
        archive?.Dispose();
        await file.DisposeAsync();
        if(used+new FileInfo(ContentPath(job.Id,job.Kind)+".tmp").Length>Quota) throw new JobQuotaException();
        File.Move(ContentPath(job.Id,job.Kind)+".tmp",ContentPath(job.Id,job.Kind),true);
        tx.Commit();
    }

    private async Task ImportAsync(Job job,MetadataJobRequest request,CancellationToken ct)
    {
        await using var db=await database.OpenAsync(ct);
        if(request.MediaIds is not null) {
            foreach(var id in request.MediaIds) await ImportOneAsync(db,job,request,id,ct);
            return;
        }
        // No explicit selection: walk every present item matching the query, the same
        // bounded cursor pattern exports use, so a whole library can be imported without
        // holding the result set in memory.
        var (predicate,p)=request.Query!.Predicate();
        var after=job.LastMediaId;
        while(true) {
            p.Add("after",after);
            var ids=(await db.QueryAsync<long>(new CommandDefinition($"SELECT m.Id FROM Media m WHERE {predicate} AND m.Id>@after ORDER BY m.Id LIMIT 200",p,cancellationToken:ct))).ToArray();
            if(ids.Length==0) break;
            foreach(var id in ids) await ImportOneAsync(db,job,request,id,ct);
            after=ids[^1];
        }
    }

    private async Task ImportOneAsync(SqliteConnection db,Job job,MetadataJobRequest request,long id,CancellationToken ct)
    {
        if(await db.ExecuteScalarAsync<bool>(new CommandDefinition("SELECT EXISTS(SELECT 1 FROM MetadataJobItems WHERE JobId=@jobId AND MediaId=@id)",new{jobId=job.Id,id},cancellationToken:ct))) return;
        // Foreground previews go first; a decoder already in flight remains bounded by its deadline.
        while(await db.ExecuteScalarAsync<bool>(new CommandDefinition("SELECT EXISTS(SELECT 1 FROM ProcessingJobs j WHERE j.State='pending' AND j.MediaType='image' AND j.NextAttemptAt<'1970' AND EXISTS(SELECT 1 FROM Scans WHERE Id=j.ScanId AND State IN ('running','completed'))) OR EXISTS(SELECT 1 FROM ProcessingJobs j WHERE j.State='pending' AND j.MediaType='video' AND j.NextAttemptAt<'1970' AND EXISTS(SELECT 1 FROM Scans WHERE Id=j.ScanId AND State IN ('running','completed')))",cancellationToken:ct))) await Task.Delay(200,ct);
        await options.ProcessingSlots.WaitAsync(ct);
        try { await ImportClaimedAsync(db,job,request,id,ct); }
        finally { options.ProcessingSlots.Release(); }
    }

    private async Task ImportClaimedAsync(SqliteConnection db,Job job,MetadataJobRequest request,long id,CancellationToken ct)
    {
        var code="imported";
        var found=0; var updated=0; var skipped=0;
        try {
            var source=await db.QuerySingleOrDefaultAsync<ImportRow>(new CommandDefinition("SELECT LibraryId,RelativePath,MediaType,SourceRevision FROM Media WHERE Id=@id",new{id},cancellationToken:ct)) ?? throw new IOException();
            var root=options.Libraries.SingleOrDefault(x=>x.Id==source.LibraryId) ?? throw new IOException();
            var path=SourcePaths.Resolve(root,source.RelativePath);
            var fingerprint=$"{source.SourceRevision}:{SourceFingerprint(root,path,request.IncludeSidecars)}";
            if(request.Automatic && await db.ExecuteScalarAsync<bool>(new CommandDefinition("SELECT EXISTS(SELECT 1 FROM MetadataRevisions WHERE MediaId=@id AND IncludeSidecars=@sidecars AND Fingerprint=@fingerprint)",new{id,sidecars=request.IncludeSidecars,fingerprint},cancellationToken:ct))) {
                await RecordImportAsync(db,job.Id,id,"unchanged",0,0,1,ct);
                return;
            }
            using var timeout=CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(30));
            var keywords=new List<string>(source.MediaType=="image"?await Processor.ReadTagsAsync(path,timeout.Token):await ReadVideoAsync(path,timeout.Token));
            // Videos rarely expose dc:subject through simple container tags; an XMP packet
            // embedded by a camera or editor is found the same container-agnostic way any
            // XMP reader locates one, by its self-delimiting <?xpacket?> wrapper.
            if(source.MediaType!="image") keywords.AddRange(await MetadataKeywords.ReadEmbeddedXmpPacketAsync(path,timeout.Token));
            if(request.IncludeSidecars) foreach(var candidate in new[]{path+".xmp",Path.ChangeExtension(path,".xmp")}.Distinct()) {
                if(!File.Exists(candidate)) continue;
                SourcePaths.Check(root,candidate);
                await using var stream=new FileStream(candidate,FileMode.Open,FileAccess.Read,FileShare.Read,65536,FileOptions.Asynchronous);
                if(stream.Length>MetadataKeywords.MaximumMetadataBytes) throw new InvalidDataException();
                var bytes=new byte[(int)stream.Length]; await stream.ReadExactlyAsync(bytes,timeout.Token);
                keywords.AddRange(MetadataKeywords.ReadXmp(bytes));
            }
            var normalized=new Dictionary<string,string>();
            foreach(var keyword in keywords) {
                try {var tag=TagText.Normalize(keyword); normalized.TryAdd(tag.Key,tag.Name);}
                catch(ApiRequestException) {code="invalid_tags";}
                if(normalized.Count>100) throw new InvalidDataException();
            }
            found=keywords.Count>0?1:0;
            if(fingerprint!=$"{source.SourceRevision}:{SourceFingerprint(root,path,request.IncludeSidecars)}") throw new MetadataChangedException();
            // Tags, revision and checkpoint commit together so restart cannot double-count.

            await database.YieldToForegroundAsync(ct);
            using var tx=db.BeginTransaction();
            if(!await db.ExecuteScalarAsync<bool>(new CommandDefinition("SELECT EXISTS(SELECT 1 FROM Media WHERE Id=@id AND SourceRevision=@revision)",new{id,revision=source.SourceRevision},tx,cancellationToken:ct))) throw new MetadataChangedException();
            var before=await db.ExecuteScalarAsync<int>(new CommandDefinition("SELECT COUNT(*) FROM MediaTags WHERE MediaId=@id",new{id},tx,cancellationToken:ct));
            foreach(var tag in normalized) await db.ExecuteAsync(new CommandDefinition("INSERT INTO Tags(Name,NormalizedKey) VALUES(@name,@key) ON CONFLICT(NormalizedKey) DO NOTHING; INSERT INTO MediaTags(MediaId,TagId) SELECT @id,Id FROM Tags WHERE NormalizedKey=@key ON CONFLICT DO NOTHING",new{id,key=tag.Key,name=tag.Value},tx,cancellationToken:ct));
            if(await db.ExecuteScalarAsync<int>(new CommandDefinition("SELECT COUNT(*) FROM MediaTags WHERE MediaId=@id",new{id},tx,cancellationToken:ct))>100) throw new InvalidDataException();
            var after=await db.ExecuteScalarAsync<int>(new CommandDefinition("SELECT COUNT(*) FROM MediaTags WHERE MediaId=@id",new{id},tx,cancellationToken:ct));
            updated=after>before?1:0; skipped=updated==0?1:0;
            if(code=="imported" && found==0) code="no_metadata";
            if(code!="invalid_tags") await db.ExecuteAsync(new CommandDefinition("INSERT INTO MetadataRevisions(MediaId,IncludeSidecars,Fingerprint) VALUES(@id,@sidecars,@fingerprint) ON CONFLICT DO UPDATE SET Fingerprint=excluded.Fingerprint",new{id,sidecars=request.IncludeSidecars,fingerprint},tx,cancellationToken:ct));
            await RecordImportAsync(db,job.Id,id,code,found,updated,skipped,ct,tx);
            tx.Commit();
            return;
        } catch(OperationCanceledException) when(ct.IsCancellationRequested) {throw;}
        catch(JobStoppedException) {throw;}
        catch(SqliteException error) when(error.SqliteErrorCode is 5 or 6) {throw;}
        catch(Exception error) {code=error is MetadataChangedException?"source_changed":error is IOException or UnauthorizedAccessException?"source_unavailable":error is OperationCanceledException?"metadata_timeout":"invalid_metadata";}
        await RecordImportAsync(db,job.Id,id,code,found,0,0,ct);
    }

    private async Task RecordImportAsync(SqliteConnection db,long jobId,long id,string code,int found,int updated,int skipped,CancellationToken ct,SqliteTransaction? transaction=null)
    {
        if(transaction is null) await database.YieldToForegroundAsync(ct);
        using var owned=transaction is null?db.BeginTransaction():null;
        var tx=transaction??owned!;
        // Progress only counts while the job is running; a cancelled job's last item (and the
        // tags read for it) roll back instead of landing on a terminal task.
        if(await db.ExecuteAsync(new CommandDefinition("UPDATE MetadataJobs SET Processed=Processed+1,LastMediaId=MAX(LastMediaId,@id),Found=Found+@found,Updated=Updated+@updated,Skipped=Skipped+@skipped,Failed=Failed+@failed WHERE Id=@jobId AND State='running'",new{jobId,id,found,updated,skipped,failed=code is "imported" or "no_metadata" or "unchanged"?0:1},tx,cancellationToken:ct))==0)
            throw new JobStoppedException();
        await db.ExecuteAsync(new CommandDefinition("INSERT INTO MetadataJobItems(JobId,MediaId,Code,Found,Updated,Skipped) VALUES(@jobId,@id,@code,@found,@updated,@skipped)",new{jobId,id,code,found,updated,skipped},tx,cancellationToken:ct));
        owned?.Commit();
    }

    private async Task<IReadOnlyList<string>> ReadVideoAsync(string path,CancellationToken ct)
    {
        using var process=new Process {StartInfo=new ProcessStartInfo(options.FfprobePath) {RedirectStandardOutput=true,RedirectStandardError=true,UseShellExecute=false,CreateNoWindow=true}};
        foreach(var argument in new[]{"-v","quiet","-threads","1","-max_alloc","4194304","-protocol_whitelist","file,pipe","-f",MediaProcessing.MediaProcessor.VideoDemuxer(path),"-show_entries","format_tags=keywords,subject:stream_tags=keywords,subject","-of","json",path}) process.StartInfo.ArgumentList.Add(argument);
        process.Start();
        using var kill=ct.Register(()=>{try {process.Kill(true);} catch(InvalidOperationException) {}});
        var stderr=process.StandardError.BaseStream.CopyToAsync(Stream.Null,ct);
        using var output=new MemoryStream();
        var buffer=new byte[8192];
        int read;
        while((read=await process.StandardOutput.BaseStream.ReadAsync(buffer,ct))>0) {
            if(output.Length+read>MetadataKeywords.MaximumMetadataBytes) {process.Kill(true);throw new InvalidDataException();}
            await output.WriteAsync(buffer.AsMemory(0,read),ct);
        }
        await process.WaitForExitAsync(ct); await stderr;
        if(process.ExitCode!=0) throw new InvalidDataException();
        using var document=JsonDocument.Parse(output.ToArray());
        var values=new List<string>();
        void Add(System.Text.Json.JsonElement element) {
            if(element.TryGetProperty("tags",out var properties)) values.AddRange(properties.EnumerateObject().SelectMany(x=>x.Value.GetString()!.Split(';',StringSplitOptions.TrimEntries|StringSplitOptions.RemoveEmptyEntries)));
        }
        if(document.RootElement.TryGetProperty("format",out var format)) Add(format);
        if(document.RootElement.TryGetProperty("streams",out var streams)) foreach(var stream in streams.EnumerateArray()) Add(stream);
        return values;
    }

    public override void Dispose()
    {
        ownedProcessor?.Dispose();
        base.Dispose();
    }

    private async Task ProgressAsync(long id,int processed,int failed,CancellationToken ct) {
        await database.YieldToForegroundAsync(ct);
        await using var db=await database.OpenAsync(ct);
        if(await db.ExecuteAsync(new CommandDefinition("UPDATE MetadataJobs SET Processed=Processed+@processed,Failed=Failed+@failed WHERE Id=@id AND State='running'",new{id,processed,failed},cancellationToken:ct))==0)
            throw new JobStoppedException();
    }
    private async Task FinishAsync(long id,string state,string? code,long bytes,CancellationToken ct) {
        for(var attempt=1;;attempt++) {
            try {
                await using var db=await database.OpenAsync(ct);
                await db.ExecuteAsync(new CommandDefinition("UPDATE MetadataJobs SET State=@state,FailureCode=@code,ContentBytes=@bytes,FinishedAt=@now WHERE Id=@id AND State='running'",new{id,state,code,bytes,now=DateTimeOffset.UtcNow.ToString("O")},cancellationToken:ct));
                return;
            } catch(SqliteException error) when(error.SqliteErrorCode is 5 or 6 && attempt<12) { await Task.Delay(5000,ct); }
        }
    }
    public const string MergeInstructions="Luma exported standalone XMP only; originals were not changed. paths.jsonl maps media IDs to library-relative paths. Back up existing metadata and originals. With external software, union dc:subject keywords after trimming, Unicode NFC and invariant case normalization. Preserve unrelated XMP properties and existing spelling, review conflicts, then write with your external tool. Do not blindly replace existing sidecars or embedded metadata. Exports use a SQLite snapshot at processing start (SnapshotAt); later edits require another export.";
    private static string SourceFingerprint(LibraryOptions root,string path,bool sidecars)
    {
        var file=new FileInfo(path);
        var fingerprint=$"{file.Length}:{file.LastWriteTimeUtc.Ticks}";
        if(sidecars) foreach(var candidate in new[]{path+".xmp",Path.ChangeExtension(path,".xmp")}.Distinct()) {
            var adjacent=new FileInfo(candidate);
            if(adjacent.Exists) SourcePaths.Check(root,candidate);
            fingerprint += adjacent.Exists?$"|{adjacent.Length}:{adjacent.LastWriteTimeUtc.Ticks}":"|missing";
        }
        return fingerprint;
    }
    private sealed class MetadataChangedException : IOException;
    private sealed class JobQuotaException : Exception;
    private sealed class JobStoppedException : Exception;
    private sealed class Job { public long Id{get;set;} public string Kind{get;set;}=""; public string State{get;set;}=""; public string Request{get;set;}=""; public string CreatedAt{get;set;}=""; public string? SnapshotAt{get;set;} public string? FinishedAt{get;set;} public long LastMediaId{get;set;} public int Processed{get;set;} public int Failed{get;set;} public int Found{get;set;} public int Updated{get;set;} public int Skipped{get;set;} public string? FailureCode{get;set;} }
    private sealed record ExportRow(long Id,long LibraryId,string RelativePath,string Availability,string LibraryPath);
    private sealed record ExportTag(long MediaId,string Name);
    private sealed record ImportRow(long LibraryId,string RelativePath,string MediaType,long SourceRevision);
}
