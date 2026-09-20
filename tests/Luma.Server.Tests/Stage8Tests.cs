using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dapper;
using Luma.Server.Features.Media;
using Luma.Server.Features.Tags;
using Luma.Server.Features.Indexing;
using Luma.Server.Features.Status;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Luma.Server.Tests;

public sealed class Stage8Tests
{
    [Fact]
    public async Task Watch_progress_persists_and_seeking_to_end_does_not_complete_accidental_playback()
    {
        await using var f = await PipelineFixture.CreateAsync(); await BrowsingTests.SeedAsync(f, 2);
        await using var db = await f.Database.OpenAsync(default); await db.ExecuteAsync("UPDATE Media SET MediaType='video' WHERE Id=1");
        await using var host = Host(f); using var client = host.CreateClient();
        var accidental = await client.PutAsJsonAsync("/api/media/1/progress", new WatchUpdate(99, 100, 2));
        Assert.Equal("unwatched", (await accidental.Content.ReadFromJsonAsync<WatchState>())!.State);
        var partial = await client.PutAsJsonAsync("/api/media/1/progress", new WatchUpdate(40, 100, 15));
        Assert.Equal("in_progress", (await partial.Content.ReadFromJsonAsync<WatchState>())!.State);
        using var otherDevice = host.CreateClient();
        Assert.Equal(40, (await otherDevice.GetFromJsonAsync<WatchState>("/api/media/1/progress"))!.PositionSeconds);
        var complete = await client.PutAsJsonAsync("/api/media/1/progress", new WatchUpdate(98, 100, 15));
        Assert.Equal("completed", (await complete.Content.ReadFromJsonAsync<WatchState>())!.State);
        var detail = await otherDevice.GetFromJsonAsync<MediaSummary>("/api/media/1");
        Assert.Equal("completed", detail!.WatchProgress!.State);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/api/media/1/progress", new WatchUpdate(101, 100, 1))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PutAsJsonAsync("/api/media/2/progress", new WatchUpdate(1, 100, 1))).StatusCode);
        Directory.Move(f.Root.Path, f.Root.Path + "-offline");
        try { Assert.Equal("completed", (await otherDevice.GetFromJsonAsync<MediaSummary>("/api/media/1"))!.WatchProgress!.State); }
        finally { Directory.Move(f.Root.Path + "-offline", f.Root.Path); }
    }

    [Fact]
    public async Task Automatic_import_skips_unchanged_revisions_and_reprocesses_changed_xmp_while_manual_repairs_tags()
    {
        await using var f = await PipelineFixture.CreateAsync(); await f.CreateImageAsync("one.png"); await f.ScanAsync();
        var sidecar = Path.Combine(f.Root.Path, "one.png.xmp");
        await File.WriteAllBytesAsync(sidecar, MetadataKeywords.WriteXmp(["First"]));
        using var worker = new MetadataJobs(f.Database, f.Options); await worker.StartAsync(default);
        try
        {
            async Task<MetadataJobStatus> Import(bool automatic)
            {
                var accepted = await worker.EnqueueAsync("import", new([1], IncludeSidecars: true, Automatic: automatic), default);
                return await AwaitAsync(worker, accepted.Id);
            }
            var first = await Import(true);
            Assert.Equal((1, 1, 1, 0, 0), (first.Processed, first.Found, first.Updated, first.Skipped, first.Failed));
            var unchanged = await Import(true);
            Assert.Equal((1, 0, 0, 1, 0), (unchanged.Processed, unchanged.Found, unchanged.Updated, unchanged.Skipped, unchanged.Failed));
            await File.WriteAllBytesAsync(sidecar, MetadataKeywords.WriteXmp(["Second keyword"]));
            var changed = await Import(true); Assert.Equal(1, changed.Updated); Assert.Equal(1, changed.Found);
            await using var db = await f.Database.OpenAsync(default); await db.ExecuteAsync("DELETE FROM MediaTags");
            var repair = await Import(false); Assert.Equal(1, repair.Updated); Assert.Equal(0, repair.Failed);
            File.Delete(sidecar);
            var removed = await Import(true); Assert.Equal(0, removed.Found); Assert.Equal(1, removed.Skipped); Assert.Equal(0, removed.Failed);
        }
        finally { await worker.StopAsync(default); }
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Interrupted_import_resumes_unfinished_files_without_resetting_counters(bool selected)
    {
        await using var f = await PipelineFixture.CreateAsync(); await f.CreateImageAsync("one.png"); await f.CreateImageAsync("two.png"); await f.ScanAsync();
        await using var db = await f.Database.OpenAsync(default);
        var request = JsonSerializer.Serialize(selected ? new MetadataJobRequest([1, 2]) : new MetadataJobRequest(Query: new MediaQuery { LibraryId = 1 }.Normalize()));
        var id = await db.ExecuteScalarAsync<long>("INSERT INTO MetadataJobs(Kind,State,Request,CreatedAt,Processed,Skipped,LastMediaId) VALUES('import','running',@request,'2026',1,1,@last) RETURNING Id", new { request, last = selected ? 0 : 1 });
        await db.ExecuteAsync("INSERT INTO MetadataJobItems(JobId,MediaId,Code,Skipped) VALUES(@id,1,'no_metadata',1)", new { id });
        using var worker = new MetadataJobs(f.Database, f.Options); await worker.StartAsync(default);
        try
        {
            var status = await AwaitAsync(worker, id); Assert.Equal("completed", status.State);
            Assert.Equal(2, status.Processed); Assert.Equal(2, status.Skipped); Assert.Equal(0, status.Failed);
            Assert.Equal(new long[] { 1, 2 }, status.Items.Select(x => x.MediaId));
        }
        finally { await worker.StopAsync(default); }
    }

    [Theory]
    [InlineData("none", 0)]
    [InlineData("embedded", 1)]
    [InlineData("xmp", 1)]
    public async Task Indexing_enqueues_its_metadata_stage_immediately_and_honors_the_selected_mode(string mode, int expected)
    {
        await using var f = await PipelineFixture.CreateAsync(); await using var host = Host(f); using var client = host.CreateClient();
        var response = await client.PostAsJsonAsync("/api/libraries/1/scans", new StartScanRequest(MetadataMode: mode));
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        await using var db = await f.Database.OpenAsync(default);
        Assert.Equal(expected, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM MetadataJobs"));
        if (expected > 0)
        {
            var request = JsonSerializer.Deserialize<MetadataJobRequest>((await db.ExecuteScalarAsync<string>("SELECT Request FROM MetadataJobs"))!)!;
            Assert.True(request.Automatic); Assert.Equal(mode == "xmp", request.IncludeSidecars); Assert.NotNull(request.ScanId);
        }
        var tasks = (await client.GetFromJsonAsync<BackgroundTask[]>("/api/tasks"))!;
        Assert.Contains(tasks, x => x.Kind == "indexing");
        if (expected > 0) Assert.Contains(tasks, x => x.Kind == "import");
    }

    [Fact]
    public async Task Tag_collections_match_the_shared_filters_without_source_access()
    {
        await using var f = await PipelineFixture.CreateAsync(); await BrowsingTests.SeedAsync(f, 3);
        var tags = new TagService(f.Database); var a = (await tags.CreateAsync("A", default)).Tag; var b = (await tags.CreateAsync("B", default)).Tag;
        var c = (await tags.CreateAsync("C", default)).Tag;
        await tags.BulkAsync(new([1], [a.Id, b.Id], []), default); await tags.BulkAsync(new([2], [b.Id, c.Id], []), default);
        await using var host = Host(f); using var client = host.CreateClient();
        Directory.Move(f.Root.Path, f.Root.Path + "-offline");
        try
        {
            var page = (await client.GetFromJsonAsync<TagGroupPage>("/api/collections/tag-groups?tag=A"))!;
            Assert.Equal(new[] { "A", "B" }, page.Items.Select(x => x.Name));
            var next = (await client.GetFromJsonAsync<TagGroupPage>($"/api/collections/tag-groups?afterId={a.Id}"))!;
            Assert.Equal(new[] { "B", "C" }, next.Items.Select(x => x.Name));
            var media = (await client.GetFromJsonAsync<MediaPage>("/api/media?tag=A&tag=C&tagMode=any&collectionTag=B"))!;
            Assert.Equal(new long[] { 1, 2 }, media.Items.Select(x => x.Id).Order());
        }
        finally { Directory.Move(f.Root.Path + "-offline", f.Root.Path); }
    }

    [Fact]
    public async Task Cancelled_import_stays_cancelled_and_queue_again_creates_a_new_job()
    {
        await using var f = await PipelineFixture.CreateAsync(); await BrowsingTests.SeedAsync(f, 2);
        using var worker = new MetadataJobs(f.Database, f.Options);
        var job = await worker.EnqueueAsync("import", new([1, 2]), default);
        await using (var db = await f.Database.OpenAsync(default))
        {
            await db.ExecuteAsync("INSERT INTO MetadataJobItems(JobId,MediaId,Code) VALUES(@id,1,'no_metadata'); UPDATE MetadataJobs SET Processed=1,Skipped=1,LastMediaId=1 WHERE Id=@id", new { id = job.Id });
        }
        await worker.CancelAsync(job.Id, default);
        await worker.StartAsync(default);
        try
        {
            Assert.Equal("cancelled", (await worker.StatusAsync(job.Id, null, default)).State);
            await Task.Delay(100);
            Assert.Equal("cancelled", (await worker.StatusAsync(job.Id, null, default)).State);
            var queued = await worker.QueueAgainAsync(job.Id, default);
            Assert.NotEqual(job.Id, queued.Id);
            var done = await AwaitAsync(worker, queued.Id);
            Assert.Equal("completed", done.State);
            Assert.Equal(2, done.Processed);
            Assert.Equal(2, done.Items.Count);
            // The stopped record is never revived or advanced by the new run.
            var old = await worker.StatusAsync(job.Id, null, default);
            Assert.Equal("cancelled", old.State);
            Assert.Equal(1, old.Processed);
        }
        finally { await worker.StopAsync(default); }
    }

    [Fact]
    public async Task Cancel_running_import_preserves_cancelled_state_after_worker_stops()
    {
        await using var f = await PipelineFixture.CreateAsync(); await BrowsingTests.SeedAsync(f, 1);
        var slots = (SemaphoreSlim)typeof(IndexingOptions).GetProperty("ProcessingSlots", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!.GetValue(f.Options)!;
        for (var slot = 0; slot < f.Options.ProcessingWorkers; slot++) await slots.WaitAsync();
        using var worker = new MetadataJobs(f.Database, f.Options);
        var job = await worker.EnqueueAsync("import", new([1]), default);
        await worker.StartAsync(default);
        try
        {
            for (var attempt = 0; attempt < 200 && (await worker.StatusAsync(job.Id, null, default)).State != "running"; attempt++) await Task.Delay(10);
            Assert.Equal("running", (await worker.StatusAsync(job.Id, null, default)).State);
            await worker.CancelAsync(job.Id, default);
            await Task.Delay(100);
            Assert.Equal("cancelled", (await worker.StatusAsync(job.Id, null, default)).State);
            Assert.Equal(0, (await worker.StatusAsync(job.Id, null, default)).Processed);
        }
        finally
        {
            slots.Release(f.Options.ProcessingWorkers);
            await worker.StopAsync(default);
        }
        Assert.Equal("cancelled", (await worker.StatusAsync(job.Id, null, default)).State);
    }

    [Fact]
    public async Task Queue_again_preserves_scan_folder_and_metadata_choices()
    {
        await using var f = await PipelineFixture.CreateAsync(); await BrowsingTests.SeedAsync(f, 1);
        long original;
        await using (var db = await f.Database.OpenAsync(default))
        {
            original = await db.ExecuteScalarAsync<long>("INSERT INTO Scans(LibraryId,FolderId,State,Force,RetryFailures,StartedAt,MetadataMode) VALUES(1,1,'cancelled',1,1,'2026-09-19','xmp') RETURNING Id");
        }
        await using var host = Host(f); using var client = host.CreateClient();
        var response = await client.PostAsync($"/api/tasks/scan-{original}/queue", null);
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        var accepted = (await response.Content.ReadFromJsonAsync<ScanAccepted>())!;
        Assert.NotEqual(original, accepted.Id);
        await using (var db = await f.Database.OpenAsync(default))
        {
            var scan = await db.QuerySingleAsync<ScanRow>("SELECT * FROM Scans WHERE Id=@id", new { id = accepted.Id });
            Assert.Equal(1, scan.FolderId); Assert.True(scan.Force); Assert.True(scan.RetryFailures); Assert.Equal("xmp", scan.MetadataMode);
            var request = JsonSerializer.Deserialize<MetadataJobRequest>(await db.QuerySingleAsync<string>("SELECT Request FROM MetadataJobs WHERE ScanId=@id", new { id = accepted.Id })!)!;
            Assert.Equal(1, request.Query!.FolderId); Assert.True(request.IncludeSidecars);
        }
        Assert.Equal(HttpStatusCode.Accepted, (await client.PostAsync($"/api/tasks/scan-{accepted.Id}/cancel", null)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/api/tasks/nonsense/queue", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync("/api/tasks/metadata-999999/cancel", null)).StatusCode);
    }

    [Theory]
    [InlineData("asc")]
    [InlineData("desc")]
    public async Task Folder_name_sort_seeks_both_directions_with_ties_without_reading_originals(string direction)
    {
        await using var f = await PipelineFixture.CreateAsync(); await f.ScanAsync();
        await using (var db = await f.Database.OpenAsync(default))
        {
            await db.ExecuteAsync("INSERT INTO Folders(Id,LibraryId,ParentId,RelativePath,PathKey) VALUES(2,1,1,'Zulu','zulu'),(3,1,1,'alpha','alpha'),(4,1,1,'Beta','beta'),(5,1,1,'ALPHA','ALPHA'),(6,1,1,'hidden','hidden'); UPDATE Folders SET Hidden=1 WHERE Id=6");
            var plan = string.Join(" ", (await db.QueryAsync("EXPLAIN QUERY PLAN SELECT Id FROM Folders WHERE ParentId=1 AND Hidden=0 ORDER BY SortKey,Id LIMIT 2")).Select(row => (string)row.detail));
            Assert.Contains("IX_Folders_Parent_Sort", plan); Assert.DoesNotContain("TEMP B-TREE", plan);
        }
        var signer = new CursorSigner(f.Database); await signer.InitializeAsync(default);
        var browser = new Luma.Server.Features.Libraries.LibraryBrowser(f.Database, signer);
        var offline = f.Root.Path + "-offline"; Directory.Move(f.Root.Path, offline);
        try
        {
            var first = await browser.FoldersAsync(1, null, 2, null, default, "name", direction);
            var second = await browser.FoldersAsync(1, null, 2, first.NextCursor, default, "name", direction);
            Assert.Equal(direction == "asc" ? new long[] { 3, 5, 4, 2 } : new long[] { 2, 4, 5, 3 }, first.Items.Concat(second.Items).Select(x => x.Id));
            Assert.Null(second.NextCursor);
            var previous = await browser.FoldersAsync(1, null, 2, second.PreviousCursor, default, "name", direction);
            Assert.Equal(first.Items.Select(x => x.Id), previous.Items.Select(x => x.Id));
            await Assert.ThrowsAsync<Luma.Server.Http.ApiRequestException>(() => browser.FoldersAsync(1, null, 2, first.NextCursor, default, "name", direction == "asc" ? "desc" : "asc"));
            var legacy = await browser.FoldersAsync(1, null, 2, null, default);
            Assert.Equal(new long[] { 2, 3 }, legacy.Items.Select(x => x.Id));
        }
        finally { Directory.Move(offline, f.Root.Path); }
    }

    [Fact]
    public async Task Clear_finished_persists_queue_dismissal_preserves_history_and_keeps_active_preparation()
    {
        await using var f = await PipelineFixture.CreateAsync(); await BrowsingTests.SeedAsync(f, 1);
        await using var host = Host(f).WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            // Keep the test HTTP server, but prevent workers from claiming synthetic queue rows.
            foreach (var worker in services.Where(service => service.ServiceType == typeof(IHostedService) &&
                (service.ImplementationType?.Assembly == typeof(Program).Assembly || service.ImplementationFactory?.Method.DeclaringType?.Assembly == typeof(Program).Assembly)).ToArray()) services.Remove(worker);
        }));
        using var client = host.CreateClient();
        long preparing;
        await using (var db = await f.Database.OpenAsync(default))
        {
            await db.ExecuteAsync("INSERT INTO MetadataJobs(Kind,State,Request,CreatedAt) VALUES('import','queued','{}','2026'),('import','running','{}','2026'),('import','completed','{}','2026'),('import','failed','{}','2026'),('import','cancelled','{}','2026'),('import','expired','{}','2026'); INSERT INTO MetadataJobItems(JobId,MediaId,Code) VALUES(3,1,'no_metadata')");
            preparing = await db.ExecuteScalarAsync<long>("INSERT INTO Scans(LibraryId,State,StartedAt) VALUES(1,'completed','2026') RETURNING Id");
            await db.ExecuteAsync("INSERT INTO ProcessingJobs(MediaId,SourceRevision,EncoderVersion,ScanId,MediaType,State,NextAttemptAt) VALUES(1,1,1,@preparing,'image','pending','2000'); INSERT INTO Scans(LibraryId,State,StartedAt) VALUES(1,'failed','2026'),(1,'queued','2026')", new { preparing });
        }
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/tasks/clear-finished", null)).StatusCode);
        var tasks = (await client.GetFromJsonAsync<BackgroundTask[]>("/api/tasks"))!;
        Assert.Contains(tasks, x => x.Id == $"scan-{preparing}" && x.State == "running");
        Assert.Contains(tasks, x => x.Kind == "import" && x.State == "queued");
        Assert.Contains(tasks, x => x.Kind == "import" && x.State == "running");
        Assert.All(tasks, x => Assert.Contains(x.State, new[] { "queued", "running" }));
        await using (var db = await f.Database.OpenAsync(default))
        {
            Assert.Equal(6, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM MetadataJobs"));
            Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM MetadataJobItems"));
            Assert.Equal(4, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM MetadataJobs WHERE QueueDismissed=1"));
            Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Media"));
            await db.ExecuteAsync("UPDATE ProcessingJobs SET State='ready' WHERE ScanId=@preparing", new { preparing });
        }
        Assert.Contains((await client.GetFromJsonAsync<BackgroundTask[]>("/api/tasks"))!, x => x.Id == $"scan-{preparing}");
        await client.PostAsync("/api/tasks/clear-finished", null);
        Assert.DoesNotContain((await client.GetFromJsonAsync<BackgroundTask[]>("/api/tasks"))!, x => x.Id == $"scan-{preparing}");
        var metadata = host.Services.GetRequiredService<MetadataJobs>();
        var requeued = await metadata.QueueAgainAsync(5, default);
        Assert.NotEqual(5, requeued.Id);
        var listed = (await client.GetFromJsonAsync<BackgroundTask[]>("/api/tasks"))!;
        Assert.Contains(listed, x => x.Id == $"metadata-{requeued.Id}" && x.State == "queued");
        Assert.DoesNotContain(listed, x => x.Id == "metadata-5");
    }

    private static WebApplicationFactory<Program> Host(PipelineFixture f) => new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Testing")
        .UseSetting("Luma:DatabasePath", f.Database.Path).UseSetting("Luma:Indexing:CachePath", f.Options.CachePath)
        .UseSetting("Luma:Indexing:Libraries:0:Id", "1").UseSetting("Luma:Indexing:Libraries:0:Name", "Test").UseSetting("Luma:Indexing:Libraries:0:Path", f.Root.Path));
    private static async Task<MetadataJobStatus> AwaitAsync(MetadataJobs worker, long id)
    {
        for (var attempt = 0; attempt < 400; attempt++)
        {
            var status = await worker.StatusAsync(id, null, default);
            if (status.State is not ("queued" or "running")) return status;
            await Task.Delay(25);
        }
        throw new TimeoutException("Import did not finish.");
    }
}
