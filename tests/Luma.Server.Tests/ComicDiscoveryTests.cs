using System.IO.Compression;
using Dapper;
using Luma.Server.Features.Indexing;
using Luma.Server.Features.Panels;
using Luma.Server.MediaProcessing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace Luma.Server.Tests;

public sealed class ComicDiscoveryTests
{
    private static async Task ConfigureAsync(PipelineFixture f, bool images = false, bool exclude = true)
    {
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "Comics"));
        await new PanelSources(f.Database, f.Options, new ConfigurationBuilder().Build()).SaveAsync([new(1, "Comics", images, exclude)], default);
    }
    private static async Task BookAsync(PipelineFixture f, string path)
    {
        await f.CreateImageAsync("fixture.png");
        var full = Path.Combine(f.Root.Path, path);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        using var zip = ZipFile.Open(full, ZipArchiveMode.Create);
        zip.CreateEntryFromFile(Path.Combine(f.Root.Path, "fixture.png"), "page.png");
    }
    private static async Task<ComicJob> RunAsync(PipelineFixture f)
    {
        var library = new ComicLibrary(f.Database, f.Options);
        using var processor = new MediaProcessor(f.Options);
        var pages = new ComicPageContent(f.Database, f.Options, library, processor);
        using var worker = new ComicWorker(f.Database, f.Options, library, pages, NullLogger<ComicWorker>.Instance);
        await using var db = await f.Database.OpenAsync(default);
        var job = await db.QuerySingleAsync<ComicJob>("UPDATE ComicJobs SET State='running' WHERE Id=(SELECT Id FROM ComicJobs WHERE State='queued' ORDER BY Id LIMIT 1) RETURNING *");
        await worker.ProcessAsync(job, default);
        return await db.QuerySingleAsync<ComicJob>("SELECT * FROM ComicJobs WHERE Id=@Id", job);
    }
    private static async Task HintAsync(PipelineFixture f, string path, bool recursive = false)
    {
        using var refresh = new AutomaticLibraryRefresh(f.Database, f.Options, NullLogger<AutomaticLibraryRefresh>.Instance);
        await refresh.QueueDirtyFolderAsync(1, path, f.Root.Key(path), recursive, 1, default);
        await new ComicDiscovery(f.Database, f.Options).ProcessPendingAsync(default);
    }

    [Fact]
    public async Task Timestamp_refresh_skips_unchanged_folder_and_queues_only_the_changed_folder()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await ConfigureAsync(f);
        await BookAsync(f, "Comics/one.cbz");
        Assert.Equal("completed", (await RunAsync(f)).State);
        var discovery = new ComicDiscovery(f.Database, f.Options);
        await discovery.RefreshAsync(new(1, "Comics"), default);
        await using var db = await f.Database.OpenAsync(default);
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM ComicDirtyFolders"));
        await BookAsync(f, "Comics/two.cbz");
        Directory.SetLastWriteTimeUtc(Path.Combine(f.Root.Path, "Comics"), DateTime.UtcNow.AddSeconds(2));
        await discovery.RefreshAsync(new(1, "Comics"), default);
        await discovery.ProcessPendingAsync(default);
        var job = await RunAsync(f);
        Assert.True(job.Shallow);
        Assert.True(job.Automatic);
        Assert.Equal("Comics", job.Source);
        Assert.Equal(1, job.Processed); // The old archive was not reopened/rebuilt.
        Assert.Equal(2, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Comics WHERE Availability='present'"));
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT Revision FROM Comics WHERE RelativePath='Comics/one.cbz'"));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Shared_watcher_waits_for_stability_and_coalesces_comic_changes_without_gallery_consuming_them(bool exclude)
    {
        await using var f = await PipelineFixture.CreateAsync();
        await ConfigureAsync(f, exclude: exclude);
        await RunAsync(f);
        await BookAsync(f, "Comics/new.cbz");
        using var refresh = new AutomaticLibraryRefresh(f.Database, f.Options, NullLogger<AutomaticLibraryRefresh>.Instance);
        refresh.ApplySettings(1, new(WatcherDebounceSeconds: 0, FileStabilitySeconds: 0));
        var path = Path.Combine(f.Root.Path, "Comics", "new.cbz");
        refresh.Observe(f.Root, path, WatcherChangeTypes.Created);
        refresh.Observe(f.Root, path, WatcherChangeTypes.Changed);
        await refresh.FlushStableChangesAsync(default);
        await using var db = await f.Database.OpenAsync(default);
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM ComicDirtyFolders"));
        await refresh.FlushStableChangesAsync(default);
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM ComicDirtyFolders"));
        Assert.Equal(exclude ? 0 : 1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM DirtyFolders")); // Comic-only trees need no Gallery traversal.
        await db.ExecuteAsync("DELETE FROM DirtyFolders"); // Gallery can also consume its own work independently.
        await new ComicDiscovery(f.Database, f.Options).ProcessPendingAsync(default);
        var job = await RunAsync(f);
        Assert.True(job.Shallow);
        Assert.Equal(1, job.Processed);
        Assert.Single((await new ComicLibrary(f.Database, f.Options).ListAsync(null, null, null, null, null, default)).Items);
        refresh.ApplySettings(1, new(Mode: "manual", WatcherDebounceSeconds: 0));
        refresh.Observe(f.Root, path, WatcherChangeTypes.Changed);
        await refresh.FlushStableChangesAsync(default);
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM ComicDirtyFolders"));
    }

    [Fact]
    public async Task New_subtree_is_recursive_but_known_sibling_is_not_scanned()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await ConfigureAsync(f);
        await BookAsync(f, "Comics/Known/old.cbz");
        await RunAsync(f);
        await BookAsync(f, "Comics/Known/not-yet.cbz");
        await BookAsync(f, "Comics/New/Nested/new.cbz");
        await HintAsync(f, ""); // A parent directory timestamp notification must remain shallow.
        var job = await RunAsync(f);
        Assert.Equal(1, job.Processed);
        await using var db = await f.Database.OpenAsync(default);
        Assert.Equal(2, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Comics WHERE Availability='present'"));
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Comics WHERE RelativePath LIKE '%not-yet%'"));
        Assert.Equal("Comics/New/Nested/new.cbz", await db.ExecuteScalarAsync<string>("SELECT RelativePath FROM Comics ORDER BY Id DESC LIMIT 1"));
    }

    [Fact]
    public async Task Shallow_refresh_reconciles_deleted_books_and_subtrees_but_preserves_progress_and_unrelated_books()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await ConfigureAsync(f);
        await BookAsync(f, "Comics/Gone/Nested/gone.cbz");
        await BookAsync(f, "Comics/Stay/stay.cbz");
        await BookAsync(f, "Comics/direct.cbz");
        await RunAsync(f);
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("INSERT INTO ReadingProgress(ComicId,PageIndex,ReadingSeconds) SELECT Id,0,42 FROM Comics");
        Directory.Delete(Path.Combine(f.Root.Path, "Comics", "Gone"), true);
        File.Delete(Path.Combine(f.Root.Path, "Comics", "direct.cbz"));
        await HintAsync(f, "Comics");
        Assert.Equal("completed", (await RunAsync(f)).State);
        Assert.Equal(2, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Comics WHERE Availability='missing'"));
        Assert.Equal("Comics/Stay/stay.cbz", await db.ExecuteScalarAsync<string>("SELECT RelativePath FROM Comics WHERE Availability='present'"));
        Assert.Equal(126, await db.ExecuteScalarAsync<int>("SELECT SUM(ReadingSeconds) FROM ReadingProgress"));
        await BookAsync(f, "Comics/direct.cbz");
        await HintAsync(f, "Comics");
        await RunAsync(f);
        Assert.Equal(3, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Comics"));
        Assert.Equal(42, await db.ExecuteScalarAsync<int>("SELECT ReadingSeconds FROM ReadingProgress p JOIN Comics c ON c.Id=p.ComicId WHERE c.RelativePath='Comics/direct.cbz'"));
    }

    [Fact]
    public async Task Durable_hints_wait_for_active_jobs_and_survive_a_new_discovery_instance()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await ConfigureAsync(f);
        await HintAsync(f, "Comics");
        await using var db = await f.Database.OpenAsync(default);
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM ComicDirtyFolders"));
        await RunAsync(f);
        await new ComicDiscovery(f.Database, f.Options).ProcessPendingAsync(default);
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM ComicDirtyFolders"));
        Assert.True((await RunAsync(f)).Automatic);
    }

    [Fact]
    public async Task Ancestor_events_are_restricted_to_configured_sources_and_unrelated_events_are_ignored()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await ConfigureAsync(f);
        await RunAsync(f);
        await BookAsync(f, "Comics/inside.cbz");
        await BookAsync(f, "Outside/outside.cbz");
        await HintAsync(f, "Outside", true);
        await using var db = await f.Database.OpenAsync(default);
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM ComicJobs WHERE State='queued'"));
        await HintAsync(f, "", true);
        var job = await RunAsync(f);
        Assert.Equal("Comics", job.Source);
        Assert.True(job.Recursive);
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Comics"));
    }

    [Fact]
    public async Task Periodic_comic_only_source_needs_no_gallery_folder_and_keeps_its_own_schedule()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await ConfigureAsync(f);
        await RunAsync(f);
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("UPDATE Libraries SET RefreshMode='periodic',LastPeriodicScanAt=datetime('now')");
        using var refresh = new AutomaticLibraryRefresh(f.Database, f.Options, NullLogger<AutomaticLibraryRefresh>.Instance);
        await refresh.QueuePeriodicScanAsync(default);
        var job = await RunAsync(f);
        Assert.Equal("Comics", job.Source);
        Assert.True(job.Automatic);
        Assert.True(job.Recursive);
        await refresh.QueuePeriodicScanAsync(default);
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM ComicJobs WHERE State='queued'"));
        await db.ExecuteAsync("UPDATE Libraries SET RefreshMode='manual'; UPDATE PanelSources SET LastPeriodicScanAt=NULL");
        await refresh.QueuePeriodicScanAsync(default);
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM ComicJobs WHERE State='queued'"));
    }

    [Fact]
    public async Task Refresh_on_open_can_be_disabled_and_cannot_scan_outside_selected_locations()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await ConfigureAsync(f);
        await RunAsync(f);
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("UPDATE Libraries SET RefreshOnOpen=0");
        await BookAsync(f, "Comics/new.cbz");
        var discovery = new ComicDiscovery(f.Database, f.Options);
        await discovery.RefreshAsync(new(1, "Comics"), default);
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM ComicDirtyFolders"));
        await db.ExecuteAsync("UPDATE Libraries SET RefreshOnOpen=1");
        await discovery.RefreshAsync(new(1, ""), default);
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM ComicDirtyFolders"));
    }

    [Fact]
    public async Task Replacement_and_image_edit_invalidate_caches_while_preserving_identity_and_progress()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await ConfigureAsync(f, true);
        await BookAsync(f, "Comics/book.cbz");
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "Comics", "Images"));
        await f.CreateImageAsync("Comics/Images/page.png");
        await RunAsync(f);
        await using var db = await f.Database.OpenAsync(default);
        var original = (await db.QueryAsync<ComicRow>("SELECT * FROM Comics ORDER BY Id")).ToArray();
        await db.ExecuteAsync("INSERT INTO ReadingProgress(ComicId,ReadingSeconds) SELECT Id,23 FROM Comics; INSERT INTO Tags(Name,NormalizedKey) VALUES('local','local'); INSERT INTO ComicTags SELECT Id,(SELECT Id FROM Tags WHERE Name='local') FROM Comics; UPDATE Comics SET Title='My title'");
        File.SetLastWriteTimeUtc(Path.Combine(f.Root.Path, "Comics", "book.cbz"), DateTime.UtcNow.AddSeconds(3));
        var imageDirectory = Path.Combine(f.Root.Path, "Comics", "Images");
        var directoryTime = Directory.GetLastWriteTimeUtc(imageDirectory);
        File.SetLastWriteTimeUtc(Path.Combine(imageDirectory, "page.png"), DateTime.UtcNow.AddSeconds(4));
        Directory.SetLastWriteTimeUtc(imageDirectory, directoryTime);
        await HintAsync(f, "Comics", true);
        Assert.Equal(2, (await RunAsync(f)).Processed);
        var updated = (await db.QueryAsync<ComicRow>("SELECT * FROM Comics ORDER BY Id")).ToArray();
        Assert.Equal(original.Select(x => x.Id), updated.Select(x => x.Id));
        Assert.All(updated, x => { Assert.Equal(2, x.Revision); Assert.Equal("My title", x.Title); });
        Assert.Equal(2, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM ComicTags"));
        Assert.Equal(46, await db.ExecuteScalarAsync<int>("SELECT SUM(ReadingSeconds) FROM ReadingProgress"));
        await HintAsync(f, "Comics", true);
        Assert.Equal(0, (await RunAsync(f)).Processed);
    }

    [Fact]
    public async Task Rejected_archive_or_unavailable_root_never_reconciles_missing_entries()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await ConfigureAsync(f);
        await BookAsync(f, "Comics/one.cbz");
        await RunAsync(f);
        File.Delete(Path.Combine(f.Root.Path, "Comics", "one.cbz"));
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "Comics", "broken.cbz"), "invalid");
        await HintAsync(f, "Comics");
        Assert.Equal(1, (await RunAsync(f)).Failed);
        await using var db = await f.Database.OpenAsync(default);
        Assert.Equal("present", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Comics"));
        await HintAsync(f, "Comics");
        Directory.Move(f.Root.Path, f.Root.Path + "-offline");
        try
        {
            Assert.Equal("failed", (await RunAsync(f)).State);
            Assert.Equal("present", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Comics"));
        }
        finally { Directory.Move(f.Root.Path + "-offline", f.Root.Path); }
    }
    [Fact]
    public async Task Unchanged_folder_refresh_does_not_wait_for_the_sqlite_writer()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await ConfigureAsync(f);
        await RunAsync(f);
        await using var blocker = await f.Database.OpenAsync(default);
        using var tx = blocker.BeginTransaction(deferred: false);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        await new ComicDiscovery(f.Database, f.Options).RefreshAsync(new(1, "Comics"), timeout.Token);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Deleted_watched_subtree_is_reconciled_without_requiring_its_parent_event(bool recursive)
    {
        await using var f = await PipelineFixture.CreateAsync();
        await ConfigureAsync(f);
        await BookAsync(f, "Comics/Gone/Nested/book.cbz");
        await RunAsync(f);
        await HintAsync(f, "Comics/Gone", recursive);
        Directory.Delete(Path.Combine(f.Root.Path, "Comics", "Gone"), true);
        Assert.Equal("completed", (await RunAsync(f)).State);
        await using var db = await f.Database.OpenAsync(default);
        Assert.Equal("missing", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Comics"));
    }

    [Fact]
    public async Task Cancelled_job_never_reconciles_or_commits_a_folder_checkpoint()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await ConfigureAsync(f);
        await BookAsync(f, "Comics/one.cbz");
        await RunAsync(f);
        await HintAsync(f, "Comics");
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("UPDATE ComicJobs SET State='cancelled' WHERE State='queued'");
        var job = await db.QuerySingleAsync<ComicJob>("SELECT * FROM ComicJobs WHERE State='cancelled'");
        var library = new ComicLibrary(f.Database, f.Options);
        using var processor = new MediaProcessor(f.Options);
        using var worker = new ComicWorker(f.Database, f.Options, library, new(f.Database, f.Options, library, processor), NullLogger<ComicWorker>.Instance);
        await worker.ProcessAsync(job, default);
        Assert.Equal("present", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Comics"));
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM ComicFolders WHERE LastJobId=@Id", job));
    }

    [Fact]
    public async Task Restored_subfolder_is_recursively_discovered_even_if_its_own_timestamp_is_unchanged()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await ConfigureAsync(f);
        await BookAsync(f, "Comics/Restored/Nested/book.cbz");
        await RunAsync(f);
        var folder = Path.Combine(f.Root.Path, "Comics", "Restored");
        var temporary = Path.Combine(f.DirectoryPath, "away");
        Directory.Move(folder, temporary);
        await HintAsync(f, "Comics");
        await RunAsync(f);
        await using var db = await f.Database.OpenAsync(default);
        Assert.Equal("missing", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Comics"));
        Directory.Move(temporary, folder);
        await HintAsync(f, "Comics");
        await RunAsync(f);
        Assert.Equal("present", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Comics"));
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Comics"));
    }

    [Fact]
    public async Task Overlapping_locations_merge_image_folder_opt_in_for_the_same_watcher_target()
    {
        await using var f = await PipelineFixture.CreateAsync();
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "Comics", "Images"));
        await new PanelSources(f.Database, f.Options, new ConfigurationBuilder().Build()).SaveAsync([new(1, "Comics"), new(1, "Comics/Images", true)], default);
        await RunAsync(f);
        await RunAsync(f);
        await f.CreateImageAsync("Comics/Images/page.png");
        await HintAsync(f, "Comics/Images");
        var job = await RunAsync(f);
        Assert.True(job.ImageFolders);
        Assert.True(job.Shallow);
        Assert.Equal(1, job.Processed);
        await using var db = await f.Database.OpenAsync(default);
        Assert.Equal("folder", await db.ExecuteScalarAsync<string>("SELECT Format FROM Comics"));
    }

    [Fact]
    public async Task Gallery_reconciled_copy_notifications_still_queue_panels_discovery()
    {
        await using var f = await PipelineFixture.CreateAsync();
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "Comics"));
        await f.CreateImageAsync("original.png");
        await f.ScanAsync();
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("INSERT INTO PanelSources(LibraryId,RelativePath,PathKey,ImageFolders,ExcludeFromGallery) VALUES(1,'Comics',@key,1,0)", new { key = f.Root.Key("Comics") });
        f.Root.Writable = true;
        var operations = new Luma.Server.Features.Files.FileOperations(f.Database, f.Options);
        using var fileWorker = new Luma.Server.Features.Files.FileOperationWorker(operations, f.Database, NullLogger<Luma.Server.Features.Files.FileOperationWorker>.Instance);
        var accepted = await operations.QueueAsync(new(1, "copy", "original.png", "Comics/page.png"), default);
        await db.ExecuteAsync("UPDATE FileOperations SET State='running' WHERE Id=@Id", accepted);
        await fileWorker.ExecuteOperationAsync(await operations.GetAsync(accepted.Id, default), false, default);
        Assert.Equal("completed", (await operations.GetAsync(accepted.Id, default)).State);
        using var refresh = new AutomaticLibraryRefresh(f.Database, f.Options, NullLogger<AutomaticLibraryRefresh>.Instance);
        refresh.ApplySettings(1, new(WatcherDebounceSeconds: 0, FileStabilitySeconds: 0));
        refresh.Observe(f.Root, Path.Combine(f.Root.Path, "Comics", "page.png"), WatcherChangeTypes.Created);
        await refresh.FlushStableChangesAsync(default);
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM DirtyFolders"));
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM ComicDirtyFolders"));
        await new ComicDiscovery(f.Database, f.Options).ProcessPendingAsync(default);
        var job = await RunAsync(f);
        Assert.True(job.ImageFolders);
        Assert.Equal(1, job.Processed);
    }

    [Fact]
    public async Task Parent_refresh_preserves_a_known_image_comic_until_its_directory_is_removed()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await ConfigureAsync(f, images: true);
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "Comics", "Images"));
        await f.CreateImageAsync("Comics/Images/page.png");
        await RunAsync(f);
        await HintAsync(f, "Comics");
        Assert.Equal(0, (await RunAsync(f)).Processed);
        await using var db = await f.Database.OpenAsync(default);
        Assert.Equal("present", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Comics"));
        // Archive-only passes also leave observed image comics intact.
        await db.ExecuteAsync("UPDATE PanelSources SET ImageFolders=0");
        await HintAsync(f, "Comics");
        await RunAsync(f);
        Assert.Equal("present", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Comics"));
        await HintAsync(f, "Comics", true);
        await RunAsync(f);
        Assert.Equal("present", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Comics"));
        Directory.Delete(Path.Combine(f.Root.Path, "Comics", "Images"), true);
        await HintAsync(f, "Comics");
        await RunAsync(f);
        Assert.Equal("missing", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Comics"));
    }

}
