using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Media;
using Luma.Server.Features.Tags;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.PixelFormats;

var mode=args[0];
var directory=Path.GetFullPath(args[1]);
var count=args.Length>2?int.Parse(args[2],CultureInfo.InvariantCulture):1500;
Directory.CreateDirectory(directory);
if (mode == "index-benchmark")
{
    // End-to-end first-index throughput on real media, through the production queue and workers:
    // discovery, then thumbnails and embedded keywords running concurrently as they do in Luma.
    // Usage: index-benchmark <work directory> <ProcessingWorkers 1-4> <media folder (opened read-only)>
    var media = Path.GetFullPath(args[3]);
    var run = Path.Combine(directory, DateTime.UtcNow.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture));
    var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Luma:DatabasePath"] = Path.Combine(run, "index.db") }).Build();
    var indexDatabase = new Database(configuration, Host.CreateApplicationBuilder().Environment);
    await new MigrationRunner(indexDatabase).ApplyAsync(default);
    var options = new Luma.Server.Features.Indexing.IndexingOptions { ProcessingWorkers = count, CachePath = Path.Combine(run, "cache"),
        Libraries = [new() { Id = 1, Name = "Benchmark", Path = media }] };
    options.Validate(run, indexDatabase.Path);
    await new Luma.Server.Features.Indexing.IndexingSetup(indexDatabase, options).InitializeAsync(default);
    await using var connection = await indexDatabase.OpenAsync(default);
    var clock = Stopwatch.StartNew();
    var scan = await connection.QuerySingleAsync<Luma.Server.Features.Indexing.ScanRow>(
        "INSERT INTO Scans(LibraryId,State,StartedAt,MetadataMode) VALUES(1,'running',@now,'embedded') RETURNING *", new { now = DateTimeOffset.UtcNow.ToString("O") });
    await new Luma.Server.Features.Indexing.ScanWorker(indexDatabase, options, Microsoft.Extensions.Logging.Abstractions.NullLogger<Luma.Server.Features.Indexing.ScanWorker>.Instance)
        .ScanAsync(scan, options.Libraries[0], default);
    var discovery = clock.Elapsed.TotalSeconds;
    using var processor = new Luma.Server.MediaProcessing.MediaProcessor(options);
    var cache = new Luma.Server.MediaProcessing.GeneratedCache(indexDatabase, options);
    using var processing = new Luma.Server.MediaProcessing.ProcessingWorker(indexDatabase, options, processor, cache,
        Microsoft.Extensions.Logging.Abstractions.NullLogger<Luma.Server.MediaProcessing.ProcessingWorker>.Instance);
    using var keywords = new MetadataJobs(indexDatabase, options, null, processor);
    await processing.StartAsync(default);
    await keywords.StartAsync(default);
    double? thumbnails = null, tags = null;
    while (thumbnails is null || tags is null)
    {
        await Task.Delay(250);
        if (thumbnails is null && await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM ProcessingJobs WHERE State IN ('pending','running')") == 0) thumbnails = clock.Elapsed.TotalSeconds;
        if (tags is null && await connection.ExecuteScalarAsync<bool>("SELECT EXISTS(SELECT 1 FROM MetadataJobs) AND NOT EXISTS(SELECT 1 FROM MetadataJobs WHERE State IN ('queued','running'))")) tags = clock.Elapsed.TotalSeconds;
        var left = await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM ProcessingJobs WHERE State IN ('pending','running')");
        var read = await connection.ExecuteScalarAsync<int>("SELECT COALESCE(SUM(Processed),0) FROM MetadataJobs");
        Console.Write($"\r{clock.Elapsed.TotalSeconds,7:F0}s  jobs left {left,7}  keywords read {read,7}");
    }
    Console.WriteLine();
    await processing.StopAsync(default);
    await keywords.StopAsync(default);
    var photos = await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Media WHERE MediaType='image'");
    var videos = await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Media WHERE MediaType='video'");
    var cacheBytes = await connection.ExecuteScalarAsync<long>("SELECT SizeBytes FROM CacheAccounting");
    var report = JsonSerializer.Serialize(new { media, processingWorkers = options.ProcessingWorkers, imageWorkers = options.ImageWorkers, photos, videos,
        failed = await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM ProcessingJobs WHERE State='failed'"),
        tagged = await connection.ExecuteScalarAsync<int>("SELECT COUNT(DISTINCT MediaId) FROM MediaTags"),
        discoverySeconds = discovery, thumbnailsDoneSeconds = thumbnails, keywordsDoneSeconds = tags,
        mediaPerSecond = (photos + videos) / (thumbnails - discovery), cacheBytes, cacheBytesPerItem = cacheBytes / Math.Max(1, photos + videos),
        environment = System.Runtime.InteropServices.RuntimeInformation.OSDescription, processors = Environment.ProcessorCount },
        new JsonSerializerOptions { WriteIndented = true });
    await File.WriteAllTextAsync(Path.Combine(run, "results.json"), report);
    Console.WriteLine(report);
    return;
}
if (mode == "decode-benchmark")
{
    var source = Path.Combine(directory, "source.jpg");
    using (var image = new Image<Rgb24>(1920, 1080))
    {
        for (var y = 0; y < image.Height; y++) for (var x = 0; x < image.Width; x++)
            image[x, y] = new((byte)(x % 256), (byte)(y % 256), (byte)((x + y) % 256));
        await image.SaveAsJpegAsync(source);
    }
    var thumbnail = Path.Combine(directory, "thumbnail.webp");
    var preview = Path.Combine(directory, "preview.jpg");
    var iterations = Math.Min(count, 200);
    var cold = Stopwatch.StartNew();
    for (var i = 0; i < iterations; i++)
        await Luma.Server.MediaProcessing.MediaProcessor.RunAsync("dotnet", [typeof(Luma.Server.MediaProcessing.MediaProcessor).Assembly.Location,
            "--process-image", source, thumbnail, preview, "preview"], default);
    cold.Stop();
    using var processor = new Luma.Server.MediaProcessing.MediaProcessor(new());
    var reused = Stopwatch.StartNew();
    for (var i = 0; i < iterations; i++) await processor.ProcessAsync(source, "image", thumbnail, preview, default);
    reused.Stop();
    var report = JsonSerializer.Serialize(new { iterations, width = 1920, height = 1080,
        processPerImageSeconds = cold.Elapsed.TotalSeconds, reusedProcessSeconds = reused.Elapsed.TotalSeconds,
        reusedImagesPerSecond = iterations / reused.Elapsed.TotalSeconds }, new JsonSerializerOptions { WriteIndented = true });
    await File.WriteAllTextAsync(Path.Combine(directory, "results.json"), report);
    Console.WriteLine(report);
    return;
}
var builder=Host.CreateApplicationBuilder();
builder.Configuration.AddInMemoryCollection(new Dictionary<string,string?>{{"Luma:DatabasePath",Path.Combine(directory,"fixture.db")}});
var database=new Database(builder.Configuration,builder.Environment);
await new MigrationRunner(database).ApplyAsync(default);
await using var db=await database.OpenAsync(default);
if(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Media")==0)
{
    var watch=Stopwatch.StartNew();
    Directory.CreateDirectory(Path.Combine(directory,"media"));
    await db.ExecuteAsync("""
        INSERT INTO Libraries(Id,Name,Path,CaseSensitive,Availability) VALUES(1,'Sample library',@path,1,'available');
        INSERT INTO Scans(Id,LibraryId,State,StartedAt,FinishedAt,Discovered) VALUES(1,1,'completed','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',@count);
        INSERT INTO Folders(Id,LibraryId,RelativePath,PathKey) VALUES(1,1,'','');
        INSERT INTO FolderAncestry VALUES(1,1);
        INSERT INTO Folders(Id,LibraryId,ParentId,RelativePath,PathKey) VALUES(2,1,1,'Trips','Trips');
        INSERT INTO FolderAncestry VALUES(1,2),(2,2);
        """,new{path=Path.Combine(directory,"media"),count});
    for(var start=1;start<=count;start+=900)
    {
        using var tx=db.BeginTransaction();
        await db.ExecuteAsync("""
            WITH RECURSIVE n(x) AS (SELECT @start UNION ALL SELECT x+1 FROM n WHERE x<@end)
            INSERT INTO Media(Id,LibraryId,FolderId,RelativePath,PathKey,FileName,MediaType,MimeType,Extension,SizeBytes,ModifiedAt,IndexedAt,EffectiveDate,LastSeenScanId,SourceRevision,Width,Height,ProcessingStatus,Preference)
            SELECT x,1,CASE WHEN x%10=0 THEN 2 ELSE 1 END,'photo-'||printf('%07d',x)||'.jpg','photo-'||printf('%07d',x)||'.jpg',
              CASE WHEN x%1000=0 THEN 'holiday-' ELSE 'photo-' END||printf('%07d',x)||'.jpg',CASE WHEN x%5=0 THEN 'video' ELSE 'image' END,'image/jpeg','.jpg',x*1024,
              '2026-01-'||printf('%02d',1+x%28)||'T00:00:00.0000000Z','2026-01-01T00:00:00.0000000Z',
              '2026-01-'||printf('%02d',1+x%28)||'T00:00:00.0000000Z',1,1,640,CASE WHEN x%3=0 THEN 960 ELSE 480 END,'ready',CASE WHEN x%20=0 THEN 'liked' ELSE 'neutral' END FROM n;
            """,new{start,end=Math.Min(start+899,count)},tx);
        tx.Commit();
    }
    await db.ExecuteAsync("INSERT INTO Tags(Id,Name,NormalizedKey) VALUES(1,'Vacation','VACATION'),(2,'Family','FAMILY'); INSERT INTO MediaTags SELECT Id,1 FROM Media WHERE Id%20=0; INSERT INTO MediaTags SELECT Id,2 FROM Media WHERE Id%40=0;");
    await db.ExecuteAsync("ANALYZE; INSERT INTO MediaSearch(MediaSearch) VALUES('optimize');");
    Console.WriteLine($"Seeded {count} media in {watch.Elapsed.TotalSeconds:F1}s");
}
if(mode=="seed")
{
    var cache=Path.Combine(directory,"cache");Directory.CreateDirectory(cache);
    for(var palette=0;palette<12;palette++)
    {
        using var image=new Image<Rgb24>(640,480);
        for(var y=0;y<480;y++)for(var x=0;x<640;x++) image[x,y]=new Rgb24((byte)((x/3+palette*23)%256),(byte)((y/2+palette*41)%256),(byte)((x/5+y/4+palette*13)%256));
        await image.SaveAsync(Path.Combine(cache,$"palette-{palette}.jpg"),new JpegEncoder{Quality=80});
        await image.SaveAsync(Path.Combine(cache,$"palette-{palette}.webp"),new WebpEncoder{Quality=70});
    }
    for(var id=1;id<=count;id++)
    {
        foreach(var variant in new[]{"thumbnail",id%5==0?"poster":"preview"})
        {
            var extension=variant=="thumbnail"?"webp":"jpg";
            var relative=Path.Combine($"{id%256:x2}", $"{id}", $"1-1-{variant}.{extension}");
            var output=Path.Combine(cache,relative);Directory.CreateDirectory(Path.GetDirectoryName(output)!);
            if(!File.Exists(output)) File.Copy(Path.Combine(cache,$"palette-{id%12}.{extension}"),output);
            var bytes=await File.ReadAllBytesAsync(output);
            await db.ExecuteAsync("""
                INSERT INTO CacheEntries(MediaId,SourceRevision,Variant,EncoderVersion,State,RelativePath,SizeBytes,Width,Height,ContentHash,LastAccessAt)
                VALUES(@id,1,@variant,1,'ready',@relative,@size,640,480,@hash,'2026-09-15T00:00:00Z')
                ON CONFLICT(MediaId,SourceRevision,Variant,EncoderVersion) DO UPDATE SET
                  State='ready',RelativePath=excluded.RelativePath,SizeBytes=excluded.SizeBytes,Width=excluded.Width,Height=excluded.Height,ContentHash=excluded.ContentHash
                """,new{id,variant,relative,size=bytes.Length,hash=Convert.ToHexString(SHA256.HashData(bytes))});
        }
    }
    await db.ExecuteAsync("""
        INSERT INTO ProcessingJobs(MediaId,SourceRevision,EncoderVersion,ScanId,MediaType,State,NextAttemptAt)
        SELECT Id,SourceRevision,1,LastSeenScanId,MediaType,'ready','2026-01-01' FROM Media WHERE 1
        ON CONFLICT(MediaId,SourceRevision,EncoderVersion) DO UPDATE SET State='ready',Claim=NULL,LeaseUntil=NULL;
        UPDATE Media SET Availability='present',ProcessingStatus='ready';
        UPDATE Folders SET LastSeenScanId=1,DirectIndexedAt='2026-01-01' WHERE Id IN (1,2);
        """);
    Console.WriteLine($"Fixture ready: {directory}");return;
}
var signer=new CursorSigner(database);await signer.InitializeAsync(default);var browser=new MediaBrowser(database,signer);
if(mode is "gate7-benchmark" or "gate7-traversal" or "gate7-queries")
{
    var schemaVersion=await db.ExecuteScalarAsync<int>("SELECT MAX(Version) FROM SchemaMigrations");
    var sqliteVersion=await db.ExecuteScalarAsync<string>("SELECT sqlite_version()");
    var sampleCount=args.Length>3?int.Parse(args[3],CultureInfo.InvariantCulture):200;
    if(sampleCount is <20 or >1000) throw new ArgumentOutOfRangeException(nameof(sampleCount));
    var warmup=Math.Min(20,Math.Max(5,sampleCount/10));
    var reports=new List<object>();
    if(mode!="gate7-traversal")
    foreach(var sort in new[]{"modified","captured","name","type","size","shuffle"})
    foreach(var group in new[]{"none","folder","date","type"})
    foreach(var selective in new[]{false,true})
    {
        Console.WriteLine($"Measuring {sort}/{group}/selective={selective}");
        var query=new MediaQuery{Limit=60,Sort=sort,GroupBy=group,Seed="gate7-fixed",Tag=selective?["Family"]:null}.Normalize();
        var (predicate,p)=query.Predicate();p.Add("limit",60);
        var ordering=new MediaOrdering(query);
        var sortSql=sort=="shuffle" ? "m.RandomKey,m.Id" : group=="none"?ordering.Order(false):ordering.KeyExpression+" DESC,m.Id DESC";
        var where=sort=="shuffle" ? $"{predicate} AND m.RandomKey>={ordering.Pivot}" : predicate;
        if(group!="none") where+=$" AND {ordering.GroupExpression}=(SELECT MIN({ordering.GroupExpression}) FROM Media m WHERE {predicate})";
        if(sort=="type") {
            var firstType=await db.QuerySingleOrDefaultAsync<string>("SELECT m.MediaType FROM Media m WHERE "+where+" ORDER BY m.MediaType DESC LIMIT 1",p);
            p.Add("typeOrder",firstType);
            where+=" AND m.MediaType=@typeOrder";
            sortSql="m.Id DESC";
        }
        var plan=(await db.QueryAsync("EXPLAIN QUERY PLAN SELECT m.Id FROM Media m WHERE "+where+" ORDER BY "+sortSql+" LIMIT @limit",p)).Select(x=>(string)x.detail).ToArray();
        Console.WriteLine(string.Join("; ",plan));
        for(var i=0;i<warmup;i++)await browser.ListAsync(query,default);
        var samples=new List<double>();
        for(var i=0;i<sampleCount;i++){var timer=Stopwatch.StartNew();await browser.ListAsync(query,default);samples.Add(timer.Elapsed.TotalMilliseconds);}
        samples.Sort();
        reports.Add(new{sort,group,selective,p50=samples[sampleCount/2],p95=samples[(int)Math.Ceiling(sampleCount*.95)-1],p99=samples[(int)Math.Ceiling(sampleCount*.99)-1],sampleCount,warmup,latenciesMs=samples,plan});
        await File.WriteAllTextAsync(Path.Combine(directory,"gate7-query-results.json"),JsonSerializer.Serialize(new{rows=count,synthetic=true,schemaVersion,sqliteVersion,reports},new JsonSerializerOptions{WriteIndented=true}));
    }
    var traversals=new List<object>();
    var traversalFailed=false;
    if(mode!="gate7-queries")
    foreach(var sort in new[]{"modified","captured","name","type","size","shuffle"})
    {
        var seen=new HashSet<long>();string? after=null;var query=new MediaQuery{Limit=200,Sort=sort,Seed="gate7-fixed"}.Normalize();
        var timer=Stopwatch.StartNew();
        Console.WriteLine("Traversing "+sort);
        try {
            do{var page=await browser.ListAsync(query with{Cursor=after},default);foreach(var item in page.Items)if(!seen.Add(item.Id))throw new Exception("Duplicate cursor traversal");after=page.NextCursor;if(seen.Count%100000==0)Console.WriteLine($"{sort}: {seen.Count} rows");}while(after is not null);
        } catch(Luma.Server.Http.ApiRequestException error) {
            traversalFailed=true;
            traversals.Add(new{sort,rows=seen.Count,seconds=timer.Elapsed.TotalSeconds,error=error.Message});
            Console.WriteLine($"{sort} failed after {seen.Count} rows: {error.Message}");
            continue;
        }
        if(seen.Count!=count)throw new Exception("Missing cursor traversal rows");
        traversals.Add(new{sort,rows=seen.Count,seconds=timer.Elapsed.TotalSeconds});
    }
    var randomReports=new List<object>();
    if(mode=="gate7-benchmark")
    foreach(var selective in new[]{false,true}) {
        var query=new MediaQuery{MediaType="image",Tag=selective?["Family"]:null}.Normalize();
        var (predicate,p)=query.Predicate();p.Add("pivot",new MediaOrdering(new MediaQuery{Seed="random-benchmark"}).Pivot);
        var sql=$"SELECT m.Id FROM Media m WHERE {predicate} AND m.RandomKey>=@pivot ORDER BY m.RandomKey,m.Id LIMIT 1";
        var plan=(await db.QueryAsync("EXPLAIN QUERY PLAN "+sql,p)).Select(x=>(string)x.detail).ToArray();
        var samples=new List<double>();for(var i=0;i<1000;i++){var timer=Stopwatch.StartNew();await db.QuerySingleOrDefaultAsync<long?>(sql,p);samples.Add(timer.Elapsed.TotalMilliseconds);}samples.Sort();
        randomReports.Add(new{selective,p50=samples[500],p95=samples[949],p99=samples[989],plan});
    }
    var report=JsonSerializer.Serialize(new{rows=count,synthetic=true,schemaVersion,sqliteVersion,framework=System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,environment=System.Runtime.InteropServices.RuntimeInformation.OSDescription,reports,traversals,randomReports,peakWorkingSetBytes=Process.GetCurrentProcess().PeakWorkingSet64},new JsonSerializerOptions{WriteIndented=true});
    var reportName=mode switch {"gate7-benchmark"=>"gate7-results.json","gate7-traversal"=>"gate7-traversals.json",_=>"gate7-query-results.json"};
    await File.WriteAllTextAsync(Path.Combine(directory,reportName),report);Console.WriteLine("Gate 7 query evidence written to "+directory);if(traversalFailed)Environment.ExitCode=1;return;
}
var measurements=new List<object>();
var queries=new Dictionary<string,MediaQuery>{{"gallery",new()},{"folder",new(){FolderId=2}},{"video",new(){MediaType="video"}},
    {"date",new(){DateFrom="2026-01-14",DateTo="2026-01-15"}},{"tag",new(){Tag=["Vacation"]}},{"twoTags",new(){Tag=["Vacation","Family"]}},
    {"keyword",new(){Q="holiday"}},{"liked",new(){Preference="liked"}},{"combined",new(){MediaType="video",Preference="liked",MinWidth=600,Tag=["Family"]}}};
foreach(var entry in queries)
{
    var query=entry.Value.Normalize();var (predicate,parameters)=query.Predicate();parameters.Add("limit",60);
    var plan=(await db.QueryAsync("EXPLAIN QUERY PLAN SELECT m.Id FROM Media m WHERE "+predicate+" ORDER BY m.ModifiedTicks DESC,m.Id DESC LIMIT @limit",parameters)).Select(x=>(string)x.detail).ToArray();
    for(var i=0;i<20;i++)await browser.ListAsync(query,default);
    var samples=new List<double>();
    for(var i=0;i<200;i++){var timer=Stopwatch.StartNew();await browser.ListAsync(query,default);samples.Add(timer.Elapsed.TotalMilliseconds);}
    samples.Sort();measurements.Add(new{name=entry.Key,p50=samples[100],p95=samples[189],p99=samples[197],plan});
}
var deepTimer=Stopwatch.StartNew();var traversed=0;string? cursor=null;var deep=new MediaQuery{Limit=200}.Normalize();
do{var page=await browser.ListAsync(deep with{Cursor=cursor},default);traversed+=page.Items.Count;cursor=page.NextCursor;}while(cursor is not null && traversed<Math.Min(count,100000));
var bulkTimer=Stopwatch.StartNew();await new TagService(database).BulkAsync(new(Enumerable.Range(1,500).Select(x=>(long)x).ToArray(),[1,2],[]),default);
var result=new{rows=count,environment=System.Runtime.InteropServices.RuntimeInformation.OSDescription,measurements,deepRows=traversed,deepTraversalSeconds=deepTimer.Elapsed.TotalSeconds,bulk500Ms=bulkTimer.Elapsed.TotalMilliseconds,peakWorkingSetBytes=Process.GetCurrentProcess().PeakWorkingSet64};
var json=JsonSerializer.Serialize(result,new JsonSerializerOptions{WriteIndented=true});await File.WriteAllTextAsync(Path.Combine(directory,"results.json"),json);Console.WriteLine(json);
