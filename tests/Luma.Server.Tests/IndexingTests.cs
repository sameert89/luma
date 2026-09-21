using System.Net;
using System.Net.Http.Json;
using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Indexing;
using Luma.Server.MediaProcessing;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Metadata.Profiles.Exif;
using SixLabors.ImageSharp.PixelFormats;

namespace Luma.Server.Tests;

public sealed class IndexingTests
{
    [Fact]
    public async Task Watcher_hint_discovers_a_new_directory_then_scans_only_that_subtree()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await f.ScanAsync();
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "incoming", "nested"));
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "incoming", "nested", "new.jpg"), "bad");
        using var refresh = new AutomaticLibraryRefresh(f.Database, f.Options, NullLogger<AutomaticLibraryRefresh>.Instance);
        await refresh.QueueDirtyFolderAsync(1, "incoming", f.Root.Key("incoming"), recursive: true, priority: 1, default);

        await refresh.ProcessPendingFolderAsync(default);
        await RunQueuedScanAsync(f);
        await using (var check = await f.Database.OpenAsync(default))
        {
            Assert.Equal(1, await check.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Folders WHERE RelativePath='incoming'"));
            Assert.Equal(0, await check.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Media WHERE FileName='new.jpg'"));
            Assert.Equal(1, await check.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM DirtyFolders"));
        }

        await refresh.ProcessPendingFolderAsync(default);
        await RunQueuedScanAsync(f);
        await using var final = await f.Database.OpenAsync(default);
        Assert.Equal(1, await final.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Media WHERE FileName='new.jpg'"));
        Assert.Equal(0, await final.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM DirtyFolders"));
        Assert.Equal(1, await final.ExecuteScalarAsync<int>("SELECT Recursive FROM Scans ORDER BY Id DESC LIMIT 1"));
    }

    private static async Task RunQueuedScanAsync(PipelineFixture fixture)
    {
        await using var db = await fixture.Database.OpenAsync(default);
        var scan = await db.QuerySingleAsync<ScanRow>("UPDATE Scans SET State='running' WHERE Id=(SELECT Id FROM Scans WHERE State='queued' ORDER BY Id LIMIT 1) RETURNING *");
        await fixture.Scanner.ScanAsync(scan, fixture.Root, default);
    }

    [Fact]
    public async Task Active_library_scan_discovers_requested_folder_before_ordinary_media_without_double_forcing_revisions()
    {
        await using var f = await PipelineFixture.CreateAsync();
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "requested", "nested"));
        await f.ScanAsync();
        await using var db = await f.Database.OpenAsync(default);
        var folderId = await db.ExecuteScalarAsync<long>("SELECT Id FROM Folders WHERE RelativePath='requested'");
        await db.ExecuteAsync("UPDATE Folders SET DirectIndexedAt=NULL WHERE Id=@folderId", new { folderId });
        await f.CreateImageAsync("ordinary.png");
        await f.CreateImageAsync("requested/opened.png");
        await f.CreateImageAsync("requested/nested/later.png");
        var scan = await f.NewScanAsync(force: true);
        f.Scanner.PrioritizeFolder(f.Root.Id, folderId);
        f.Scanner.PrioritizeFolder(f.Root.Id, folderId);
        await f.Scanner.ScanAsync(scan, f.Root, default);

        Assert.Equal("requested/opened.png", await db.ExecuteScalarAsync<string>("SELECT RelativePath FROM Media ORDER BY Id LIMIT 1"));
        Assert.Equal(3, await db.ExecuteScalarAsync<long>("SELECT COUNT(*) FROM Media"));
        Assert.Equal(3, await db.ExecuteScalarAsync<long>("SELECT Discovered FROM Scans WHERE Id=@Id", scan));
        Assert.Equal(1, await db.ExecuteScalarAsync<long>("SELECT MAX(SourceRevision) FROM Media"));
        Assert.NotNull(await db.ExecuteScalarAsync<string>("SELECT DirectIndexedAt FROM Folders WHERE Id=@folderId", new { folderId }));
        var requestedTime = await db.ExecuteScalarAsync<string>("SELECT j.NextAttemptAt FROM ProcessingJobs j JOIN Media m ON m.Id=j.MediaId WHERE m.RelativePath='requested/opened.png'");
        var ordinaryTime = await db.ExecuteScalarAsync<string>("SELECT j.NextAttemptAt FROM ProcessingJobs j JOIN Media m ON m.Id=j.MediaId WHERE m.RelativePath='ordinary.png'");
        Assert.True(DateTimeOffset.Parse(requestedTime!) < DateTimeOffset.Parse(ordinaryTime!));
        Assert.Equal("completed", await db.ExecuteScalarAsync<string>("SELECT State FROM Scans WHERE Id=@Id", scan));
    }

    [Fact]
    public async Task Interrupted_folder_discovery_recovers_without_expanding_to_a_library_scan()
    {
        await using var f = await PipelineFixture.CreateAsync();
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "album"));
        await f.ScanAsync();
        await using var db = await f.Database.OpenAsync(default);
        var folderId = await db.ExecuteScalarAsync<long>("SELECT Id FROM Folders WHERE RelativePath='album'");
        var scan = await f.NewScanAsync();
        await db.ExecuteAsync("UPDATE Scans SET FolderId=@folderId,State='interrupted' WHERE Id=@Id", new { folderId, scan.Id });
        await new IndexingSetup(f.Database, f.Options).InitializeAsync(default);
        Assert.Equal(folderId, await db.ExecuteScalarAsync<long>("SELECT FolderId FROM Scans WHERE State='queued'"));
    }

    [Fact]
    public async Task Folder_discovery_is_direct_and_does_not_reconcile_other_folders()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await f.CreateImageAsync("outside.png");
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "album", "nested"));
        await f.CreateImageAsync("album/old.png");
        await f.CreateImageAsync("album/nested/retained.png");
        await f.ScanAsync();
        await using var db = await f.Database.OpenAsync(default);
        var folderId = await db.ExecuteScalarAsync<long>("SELECT Id FROM Folders WHERE RelativePath='album'");
        await db.ExecuteAsync("UPDATE Media SET Preference='liked'");
        File.Delete(Path.Combine(f.Root.Path, "outside.png"));
        File.Delete(Path.Combine(f.Root.Path, "album", "old.png"));
        await f.CreateImageAsync("album/new.png");
        await f.CreateImageAsync("album/nested/undiscovered.png");
        var scan = await f.NewScanAsync();
        scan.FolderId = folderId;
        await db.ExecuteAsync("UPDATE Scans SET FolderId=@FolderId WHERE Id=@Id", scan);
        await f.Scanner.ScanAsync(scan, f.Root, default);
        Assert.Equal("missing", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Media WHERE RelativePath='album/old.png'"));
        Assert.Equal("present", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Media WHERE RelativePath='outside.png'"));
        Assert.Equal("present", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Media WHERE RelativePath='album/nested/retained.png'"));
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Media WHERE RelativePath='album/nested/undiscovered.png'"));
        Assert.Equal("liked", await db.ExecuteScalarAsync<string>("SELECT Preference FROM Media WHERE RelativePath='album/old.png'"));
        await f.ProcessAllAsync();
        Assert.Equal("ready", await db.ExecuteScalarAsync<string>("SELECT ProcessingStatus FROM Media WHERE RelativePath='album/new.png'"));
    }

    [Fact]
    public async Task Idle_folder_endpoint_resumes_partial_indexing_and_is_idempotent_when_complete()
    {
        await using var f = await PipelineFixture.CreateAsync();
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "album"));
        await f.CreateImageAsync("album/photo.png");
        var scan = await f.ScanAsync();
        await using var db = await f.Database.OpenAsync(default);
        var folderId = await db.ExecuteScalarAsync<long>("SELECT Id FROM Folders WHERE RelativePath='album'");
        await db.ExecuteAsync("UPDATE Scans SET State='cancelled' WHERE Id=@Id; UPDATE ProcessingJobs SET State='waiting'", scan);
        await using var host = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Testing")
            .UseSetting("Luma:DatabasePath", f.Database.Path).UseSetting("Luma:Indexing:CachePath", f.Options.CachePath)
            .UseSetting("Luma:Indexing:Libraries:0:Id", "1").UseSetting("Luma:Indexing:Libraries:0:Name", "Fixture")
            .UseSetting("Luma:Indexing:Libraries:0:Path", f.Root.Path).UseSetting("Luma:Indexing:Libraries:0:ScanOnStartup", "false"));
        using var client = host.CreateClient();
        var response = await client.PostAsync($"/api/folders/{folderId}/index", null);
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        var accepted = await response.Content.ReadFromJsonAsync<ScanAccepted>();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        while (await db.ExecuteScalarAsync<string>("SELECT ProcessingStatus FROM Media") != "ready") await Task.Delay(100, timeout.Token);
        Assert.Equal(folderId, await db.ExecuteScalarAsync<long>("SELECT FolderId FROM Scans WHERE Id=@Id", accepted));
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/folders/{folderId}/index", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync("/api/folders/9999/index", null)).StatusCode);
        var count = await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Scans");
        await db.ExecuteAsync("UPDATE Folders SET DirectIndexedAt=NULL WHERE Id=@folderId; INSERT INTO Scans(LibraryId,State,StartedAt) VALUES(1,'running','now')", new { folderId });
        await f.CreateImageAsync("album/prioritized.png");
        await f.CreateImageAsync("ordinary.png");
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsync($"/api/folders/{folderId}/index", null)).StatusCode);
        Assert.Equal(count + 1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Scans"));
        var active = await db.QuerySingleAsync<ScanRow>("SELECT * FROM Scans WHERE State='running'");
        await host.Services.GetRequiredService<ScanWorker>().ScanAsync(active, f.Root, default);
        var prioritizedId = await db.ExecuteScalarAsync<long>("SELECT Id FROM Media WHERE RelativePath='album/prioritized.png'");
        var ordinaryId = await db.ExecuteScalarAsync<long>("SELECT Id FROM Media WHERE RelativePath='ordinary.png'");
        Assert.True(prioritizedId < ordinaryId, "The folder POST must hand its priority to the existing library scan.");
    }

    [Fact]
    public async Task Reused_decoder_recovers_from_invalid_media_and_periodic_recycling()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await f.CreateImageAsync("image.png");
        using var decoder = new MediaProcessor(f.Options);
        var thumbnail = Path.Combine(f.DirectoryPath, "thumb.webp");
        var preview = Path.Combine(f.DirectoryPath, "preview.jpg");
        var invalid = Path.Combine(f.DirectoryPath, "invalid.png");
        await File.WriteAllTextAsync(invalid, "invalid image");
        await Assert.ThrowsAsync<ProcessingException>(() => decoder.ProcessAsync(invalid, "image", thumbnail, preview, default));
        for (var i = 0; i < 130; i++)
        {
            var result = await decoder.ProcessAsync(Path.Combine(f.Root.Path, "image.png"), "image", thumbnail, preview, default);
            Assert.Equal(128, result.Metadata!.Width);
            Assert.Equal(2, result.Variants.Count);
        }
    }

    [Fact]
    public async Task Cache_write_failure_is_retryable_and_does_not_report_source_loss()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await f.CreateImageAsync("image.png");
        await f.ScanAsync();
        f.Options.CachePath = Path.Combine(f.DirectoryPath, "blocked-cache");
        await File.WriteAllTextAsync(f.Options.CachePath, "not a directory");
        await f.ProcessAllAsync();
        await using var db = await f.Database.OpenAsync(default);
        Assert.Equal("cache_io", await db.ExecuteScalarAsync<string>("SELECT FailureCode FROM ProcessingJobs"));
        Assert.Equal("pending", await db.ExecuteScalarAsync<string>("SELECT State FROM ProcessingJobs"));
        Assert.Equal("present", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Media"));
    }

    [Fact]
    public async Task Cancel_after_traversal_stops_remaining_processing()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "one.jpg"), "bad");
        var scan = await f.ScanAsync();
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("UPDATE ProcessingJobs SET NextAttemptAt='2100'");
        await using var host = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Testing")
            .UseSetting("Luma:DatabasePath", f.Database.Path).UseSetting("Luma:Indexing:CachePath", f.Options.CachePath)
            .UseSetting("Luma:Indexing:Libraries:0:Id", "1").UseSetting("Luma:Indexing:Libraries:0:Name", "Fixture")
            .UseSetting("Luma:Indexing:Libraries:0:Path", f.Root.Path).UseSetting("Luma:Indexing:Libraries:0:ScanOnStartup", "false"));
        using var client = host.CreateClient();
        Assert.Equal(HttpStatusCode.Accepted, (await client.PostAsync($"/api/scans/{scan.Id}/cancel", null)).StatusCode);
        Assert.Equal("cancelled", await db.ExecuteScalarAsync<string>("SELECT State FROM Scans WHERE Id=@Id", scan));
        Assert.Equal("waiting", await db.ExecuteScalarAsync<string>("SELECT State FROM ProcessingJobs"));
        Assert.Equal("present", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Media"));
    }

    [UnixFact]
    public async Task Symlinks_are_not_traversed_and_cannot_be_configured_as_roots()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var outside = Path.Combine(f.DirectoryPath, "outside");
        Directory.CreateDirectory(outside);
        await File.WriteAllTextAsync(Path.Combine(outside, "hidden.jpg"), "bad");
        var link = Path.Combine(f.Root.Path, "link");
        Directory.CreateSymbolicLink(link, outside);
        File.CreateSymbolicLink(Path.Combine(f.Root.Path, "linked.jpg"), Path.Combine(outside, "hidden.jpg"));
        await f.ScanAsync();
        await using var db = await f.Database.OpenAsync(default);
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Media"));
        Assert.Throws<IOException>(() => SourcePaths.Resolve(f.Root, "link/hidden.jpg"));
        f.Options.Libraries = [new() { Id = 2, Name = "Link", Path = link }];
        Assert.Throws<InvalidOperationException>(() => f.Options.Validate(f.DirectoryPath, f.Database.Path));
    }

    [Fact]
    public async Task Cancellation_after_partial_discovery_preserves_unseen_records_until_recovery()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var oldPath = Path.Combine(f.Root.Path, "old.jpg");
        await File.WriteAllTextAsync(oldPath, "bad");
        await f.ScanAsync();
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("UPDATE Media SET Preference='liked'");
        File.Delete(oldPath);
        for (var i = 0; i < 500; i++) await File.WriteAllTextAsync(Path.Combine(f.Root.Path, $"{i}.jpg"), "bad");
        var scan = await f.NewScanAsync();
        using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var traversal = Task.Run(() => f.Scanner.ScanAsync(scan, f.Root, cancellation.Token));
        while (await db.ExecuteScalarAsync<int>("SELECT Discovered FROM Scans WHERE Id=@Id", scan) < 1)
            await Task.Delay(1, cancellation.Token);
        await cancellation.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => traversal);
        Assert.Equal("present", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Media WHERE FileName='old.jpg'"));
        await new IndexingSetup(f.Database, f.Options).InitializeAsync(default);
        var resumed = await db.QuerySingleAsync<ScanRow>("UPDATE Scans SET State='running' WHERE State='queued' RETURNING *");
        await f.Scanner.ScanAsync(resumed, f.Root, default);
        Assert.Equal(501, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Media"));
        Assert.Equal("missing", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Media WHERE FileName='old.jpg'"));
        Assert.Equal("liked", await db.ExecuteScalarAsync<string>("SELECT Preference FROM Media WHERE FileName='old.jpg'"));
    }

    [Fact]
    public async Task Cache_pressure_evicts_previews_first_without_regeneration_loop_and_cleans_orphans()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await f.CreateImageAsync("image.png");
        await f.ScanAsync();
        await f.RequestPreviewsAsync();
        await f.ProcessAllAsync();
        await using var db = await f.Database.OpenAsync(default);
        var bytes = await db.ExecuteScalarAsync<long>("SELECT SizeBytes FROM CacheAccounting");
        f.Options.CacheQuotaBytes = bytes * 100 / 95;
        var orphan = Path.Combine(f.Options.CachePath, "orphan.tmp");
        await File.WriteAllTextAsync(orphan, "partial");
        File.SetLastWriteTimeUtc(orphan, DateTime.UtcNow.AddMinutes(-15));
        await f.Cache.MaintainAsync(default);
        Assert.False(File.Exists(orphan));
        Assert.Equal("evicted", await db.ExecuteScalarAsync<string>("SELECT State FROM CacheEntries WHERE Variant='preview'"));
        Assert.Equal("ready", await db.ExecuteScalarAsync<string>("SELECT State FROM CacheEntries WHERE Variant='thumbnail'"));
        Assert.Equal("ready", await db.ExecuteScalarAsync<string>("SELECT State FROM ProcessingJobs"));
        await f.Cache.MaintainAsync(default);
        Assert.Equal("ready", await db.ExecuteScalarAsync<string>("SELECT State FROM ProcessingJobs"));
    }

    [Fact]
    public async Task Exif_orientation_capture_time_alpha_and_first_frames_are_applied()
    {
        await using var f = await PipelineFixture.CreateAsync();
        using (var rotated = new Image<Rgba32>(80, 40, new Rgba32(255, 0, 0)))
        {
            rotated.Metadata.ExifProfile = new ExifProfile();
            rotated.Metadata.ExifProfile.SetValue(ExifTag.Orientation, (ushort)6);
            rotated.Metadata.ExifProfile.SetValue(ExifTag.DateTimeOriginal, "2020:01:02 12:00:00");
            rotated.Metadata.ExifProfile.SetValue(ExifTag.OffsetTimeOriginal, "+05:30");
            await rotated.SaveAsJpegAsync(Path.Combine(f.Root.Path, "rotated.jpg"));
        }
        using (var transparent = new Image<Rgba32>(640, 480))
            await transparent.SaveAsPngAsync(Path.Combine(f.Root.Path, "transparent.png"));
        foreach (var extension in new[] { "gif", "tiff" })
        {
            using var frames = new Image<Rgba32>(100, 50, new Rgba32(255, 0, 0));
            using var second = new Image<Rgba32>(100, 50, new Rgba32(0, 0, 255));
            frames.Frames.AddFrame(second.Frames.RootFrame);
            await frames.SaveAsync(Path.Combine(f.Root.Path, "frames." + extension));
        }
        await f.ScanAsync();
        await f.ProcessAllAsync();
        await using var db = await f.Database.OpenAsync(default);
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM CacheEntries WHERE Variant='preview'"));
        var thumbnails = (await db.QueryAsync<(string FileName, string RelativePath)>("SELECT m.FileName,c.RelativePath FROM CacheEntries c JOIN Media m ON m.Id=c.MediaId WHERE c.Variant='thumbnail'")).ToDictionary(x => x.FileName, x => x.RelativePath);
        using (var thumbnail = await Image.LoadAsync<Rgba32>(Path.Combine(f.Options.CachePath, thumbnails["rotated.jpg"])))
            Assert.Equal((40, 80), (thumbnail.Width, thumbnail.Height));
        using (var thumbnail = await Image.LoadAsync<Rgba32>(Path.Combine(f.Options.CachePath, thumbnails["transparent.png"])))
            Assert.Equal((320, 240, 0), (thumbnail.Width, thumbnail.Height, (int)thumbnail[0, 0].A));
        foreach (var extension in new[] { "gif", "tiff" })
        {
            using var first = await Image.LoadAsync<Rgba32>(Path.Combine(f.Options.CachePath, thumbnails["frames." + extension]));
            Assert.True(first[0, 0].R > 240 && first[0, 0].B < 15);
        }
        await f.RequestPreviewsAsync();
        await f.ProcessAllAsync();
        var metadata = await db.QuerySingleAsync<OrientedMetadata>("SELECT Width,Height,CapturedAt FROM Media WHERE FileName='rotated.jpg'");
        Assert.Equal(40, metadata.Width);
        Assert.Equal(80, metadata.Height);
        Assert.Equal(DateTimeOffset.Parse("2020-01-02T06:30:00Z"), DateTimeOffset.Parse(metadata.CapturedAt));
        var paths = (await db.QueryAsync<(string FileName, string RelativePath)>("SELECT m.FileName,c.RelativePath FROM CacheEntries c JOIN Media m ON m.Id=c.MediaId WHERE c.Variant='preview'")).ToDictionary(x => x.FileName, x => x.RelativePath);
        using var preview = await Image.LoadAsync<Rgba32>(Path.Combine(f.Options.CachePath, paths["rotated.jpg"]));
        Assert.Equal((40, 80), (preview.Width, preview.Height));
        using var alpha = await Image.LoadAsync<Rgba32>(Path.Combine(f.Options.CachePath, paths["transparent.png"]));
        Assert.InRange(alpha[0, 0].R, 27, 33);
        Assert.InRange(alpha[0, 0].B, 43, 49);
        foreach (var extension in new[] { "gif", "tiff" })
        {
            using var first = await Image.LoadAsync<Rgba32>(Path.Combine(f.Options.CachePath, paths["frames." + extension]));
            Assert.Single(first.Frames);
            Assert.True(first[0, 0].R > 240 && first[0, 0].B < 15);
        }
    }

    [Fact]
    public async Task Oversized_image_is_rejected_before_pixel_decoding()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await f.CreateImageAsync("huge.bmp");
        var path = Path.Combine(f.Root.Path, "huge.bmp");
        var bytes = await File.ReadAllBytesAsync(path);
        BitConverter.GetBytes(10001).CopyTo(bytes, 18);
        BitConverter.GetBytes(10000).CopyTo(bytes, 22);
        await File.WriteAllBytesAsync(path, bytes);
        await f.ScanAsync();
        await f.ProcessAllAsync();
        await using var db = await f.Database.OpenAsync(default);
        Assert.Equal("dimensions_exceeded", await db.ExecuteScalarAsync<string>("SELECT FailureCode FROM ProcessingJobs"));
        Assert.Empty(Directory.EnumerateFiles(f.Options.CachePath, "*", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task Transient_failures_have_three_bounded_retries_and_explicit_retry_resets_them()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "video.mp4"), "fixture");
        f.Options.FfprobePath = Path.Combine(f.DirectoryPath, "missing-tool");
        await f.ScanAsync();
        await using var db = await f.Database.OpenAsync(default);
        foreach (var delay in new[] { 5, 30, 300, 300 })
        {
            await db.ExecuteAsync("UPDATE ProcessingJobs SET NextAttemptAt='2000'");
            await f.ProcessAllAsync();
            var next = DateTimeOffset.Parse((await db.ExecuteScalarAsync<string>("SELECT NextAttemptAt FROM ProcessingJobs"))!);
            Assert.InRange((next - DateTimeOffset.UtcNow).TotalSeconds, delay - 3, delay + 1);
        }
        Assert.Equal("failed", await db.ExecuteScalarAsync<string>("SELECT State FROM ProcessingJobs"));
        Assert.Equal(4, await db.ExecuteScalarAsync<int>("SELECT Attempts FROM ProcessingJobs"));
        await f.ScanAsync(retry: true);
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT Attempts FROM ProcessingJobs"));
        Assert.Equal("pending", await db.ExecuteScalarAsync<string>("SELECT State FROM ProcessingJobs"));
    }

    private sealed class OrientedMetadata
    {
        public int Width { get; set; }
        public int Height { get; set; }
        public string CapturedAt { get; set; } = "";
    }

    [Fact]
    public async Task Mixed_readonly_sources_generate_cache_and_corruption_is_isolated()
    {
        await using var fixture = await PipelineFixture.CreateAsync();
        await fixture.CreateMixedAsync();
        var originals = Directory.GetFiles(fixture.Root.Path);
        var before = originals.ToDictionary(x => x, File.ReadAllBytes);
        foreach (var path in originals) File.SetAttributes(path, FileAttributes.ReadOnly);
        var scan = await fixture.ScanAsync();
        await fixture.ProcessAllAsync();
        await using var db = await fixture.Database.OpenAsync(default);
        Assert.Equal(13, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Media"));
        Assert.Equal(12, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Media WHERE ProcessingStatus='ready'"));
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM ProcessingFailures WHERE Code='invalid_media'"));
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT Skipped FROM Scans WHERE Id=@scan", new { scan = scan.Id }));
        Assert.Equal("completed", await db.ExecuteScalarAsync<string>("SELECT State FROM Scans WHERE Id=@scan", new { scan = scan.Id }));
        Assert.Equal(18, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM CacheEntries WHERE State='ready'"));
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM CacheEntries WHERE Variant='preview'"));
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Folders WHERE RelativePath='empty/nested'"));
        Assert.Equal(3, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM FolderAncestry WHERE DescendantId=(SELECT Id FROM Folders WHERE RelativePath='empty/nested')"));
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM CacheEntries WHERE Width>128 OR Height>96"));
        Assert.Equal(await db.ExecuteScalarAsync<long>("SELECT SUM(SizeBytes) FROM CacheEntries"),
            await db.ExecuteScalarAsync<long>("SELECT SizeBytes FROM CacheAccounting"));
        foreach (var original in before) Assert.Equal(original.Value, await File.ReadAllBytesAsync(original.Key));
        Assert.Empty(Directory.EnumerateFiles(fixture.Options.CachePath, "*.tmp", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task Incremental_identity_missing_reappearance_force_and_retry_preserve_preferences()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "one.jpg"), "corrupt");
        await f.ScanAsync();
        await f.ProcessAllAsync();
        await using var db = await f.Database.OpenAsync(default);
        var id = await db.ExecuteScalarAsync<long>("SELECT Id FROM Media");
        await db.ExecuteAsync("UPDATE Media SET Preference='liked'");
        await f.ScanAsync();
        Assert.Equal(1, await db.ExecuteScalarAsync<long>("SELECT SourceRevision FROM Media"));
        Assert.Equal("failed", await db.ExecuteScalarAsync<string>("SELECT State FROM ProcessingJobs"));
        await f.ScanAsync(retry: true);
        Assert.Equal("pending", await db.ExecuteScalarAsync<string>("SELECT State FROM ProcessingJobs"));
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "one.jpg"), "replacement corrupt bytes");
        await f.ScanAsync();
        Assert.Equal(2, await db.ExecuteScalarAsync<long>("SELECT SourceRevision FROM Media"));
        Assert.Equal("liked", await db.ExecuteScalarAsync<string>("SELECT Preference FROM Media"));
        File.Move(Path.Combine(f.Root.Path, "one.jpg"), Path.Combine(f.Root.Path, "two.jpg"));
        await f.ScanAsync();
        Assert.Equal("missing", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Media WHERE Id=@id", new { id }));
        Assert.Equal(2, await db.ExecuteScalarAsync<long>("SELECT COUNT(*) FROM Media"));
        File.Move(Path.Combine(f.Root.Path, "two.jpg"), Path.Combine(f.Root.Path, "one.jpg"));
        await f.ScanAsync();
        Assert.Equal("present", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Media WHERE Id=@id", new { id }));
        Assert.Equal("liked", await db.ExecuteScalarAsync<string>("SELECT Preference FROM Media WHERE Id=@id", new { id }));
        await f.ScanAsync(force: true);
        Assert.Equal(3, await db.ExecuteScalarAsync<long>("SELECT SourceRevision FROM Media WHERE Id=@id", new { id }));
    }

    [Fact]
    public async Task Interrupted_traversal_restarts_without_missing_reconciliation_or_duplicate_media()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "one.jpg"), "bad");
        await f.ScanAsync();
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("UPDATE Media SET Preference='liked'");
        var interrupted = await f.NewScanAsync();
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => f.Scanner.ScanAsync(interrupted, f.Root, cancelled.Token));
        Assert.Equal("present", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Media"));
        await db.ExecuteAsync("UPDATE ProcessingJobs SET State='running',LeaseUntil='2099',Claim='crashed'");
        await new IndexingSetup(f.Database, f.Options).InitializeAsync(default);
        Assert.Equal("interrupted", await db.ExecuteScalarAsync<string>("SELECT State FROM Scans WHERE Id=@Id", interrupted));
        Assert.Equal("pending", await db.ExecuteScalarAsync<string>("SELECT State FROM ProcessingJobs"));
        var resumed = await db.QuerySingleAsync<ScanRow>("UPDATE Scans SET State='running' WHERE State='queued' RETURNING *");
        await f.Scanner.ScanAsync(resumed, f.Root, default);
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Media"));
        Assert.Equal("liked", await db.ExecuteScalarAsync<string>("SELECT Preference FROM Media"));
    }

    [Fact]
    public async Task Indexing_prepares_thumbnails_and_previews_follow_demand_even_mid_job()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await f.CreateImageAsync("image.png");
        await f.ScanAsync();
        await f.ProcessAllAsync();
        await using var db = await f.Database.OpenAsync(default);
        Assert.Equal("thumbnail", await db.ExecuteScalarAsync<string>("SELECT group_concat(Variant) FROM CacheEntries"));
        Assert.Equal("ready", await db.ExecuteScalarAsync<string>("SELECT State FROM ProcessingJobs"));
        // A preview requested while a thumbnail-only job runs is prepared right after it publishes.
        await f.ScanAsync(force: true);
        var job = await f.ClaimAsync();
        Assert.False(job!.WantPreview);
        await f.RequestPreviewsAsync();
        await f.Processor.ProcessAsync(job, "image", default);
        Assert.Equal("pending", await db.ExecuteScalarAsync<string>("SELECT State FROM ProcessingJobs WHERE SourceRevision=2"));
        await f.ProcessAllAsync();
        Assert.Equal(2, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM CacheEntries WHERE SourceRevision=2 AND State='ready'"));
        Assert.Equal("ready", await db.ExecuteScalarAsync<string>("SELECT State FROM ProcessingJobs WHERE SourceRevision=2"));
        // Asking again once the preview exists is a no-op.
        await f.RequestPreviewsAsync();
        Assert.Equal("ready", await db.ExecuteScalarAsync<string>("SELECT State FROM ProcessingJobs WHERE SourceRevision=2"));
    }

    [Fact]
    public async Task Upgrade_releases_eager_previews_keeps_thumbnails_and_retries_congestion_failures()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await f.CreateImageAsync("one.png");
        await f.CreateImageAsync("two.png");
        await f.ScanAsync();
        await f.RequestPreviewsAsync();
        await f.ProcessAllAsync();
        await using var db = await f.Database.OpenAsync(default);
        // Simulate an earlier release: a pipeline-congestion failure, and the migration not yet applied.
        await db.ExecuteAsync("UPDATE ProcessingJobs SET State='failed',FailureCode='processing_timeout',Attempts=3 WHERE MediaId=2");
        await db.ExecuteAsync("UPDATE Media SET ProcessingStatus='failed' WHERE Id=2");
        var preview = await db.ExecuteScalarAsync<string>("SELECT RelativePath FROM CacheEntries WHERE Variant='preview' AND MediaId=1");
        var thumbnailBytes = await db.ExecuteScalarAsync<long>("SELECT SUM(SizeBytes) FROM CacheEntries WHERE Variant='thumbnail'");
        var migration = typeof(MigrationRunner).Assembly.GetManifestResourceNames().Single(x => x.EndsWith("0016_OnDemandPreviews.sql"));
        using (var reader = new StreamReader(typeof(MigrationRunner).Assembly.GetManifestResourceStream(migration)!))
            await db.ExecuteAsync((await reader.ReadToEndAsync()).Replace("ALTER TABLE ProcessingJobs ADD COLUMN WantPreview INTEGER NOT NULL DEFAULT 0;", ""));
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM CacheEntries WHERE Variant='preview' AND State='ready'"));
        Assert.Equal(2, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM CacheEntries WHERE Variant='thumbnail' AND State='ready'"));
        Assert.Equal(thumbnailBytes, await db.ExecuteScalarAsync<long>("SELECT SizeBytes FROM CacheAccounting"));
        Assert.Equal("pending", await db.ExecuteScalarAsync<string>("SELECT State FROM ProcessingJobs WHERE MediaId=2"));
        Assert.Equal("pending", await db.ExecuteScalarAsync<string>("SELECT ProcessingStatus FROM Media WHERE Id=2"));
        Assert.True(File.Exists(Path.Combine(f.Options.CachePath, preview!)));
        await f.Cache.MaintainAsync(default);
        Assert.False(File.Exists(Path.Combine(f.Options.CachePath, preview!)));
    }

    [Fact]
    public async Task Missing_and_corrupt_cache_regenerate_without_changing_media_identity()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await f.CreateImageAsync("image.png");
        await f.ScanAsync();
        await f.RequestPreviewsAsync();
        await f.ProcessAllAsync();
        await using var db = await f.Database.OpenAsync(default);
        var entries = (await db.QueryAsync<CacheEntry>("SELECT * FROM CacheEntries")).ToArray();
        Assert.Equal(2, entries.Length);
        File.Delete(Path.Combine(f.Options.CachePath, entries[0].RelativePath));
        await File.WriteAllTextAsync(Path.Combine(f.Options.CachePath, entries[1].RelativePath), "broken");
        await f.Cache.MaintainAsync(default);
        Assert.Equal("pending", await db.ExecuteScalarAsync<string>("SELECT State FROM ProcessingJobs"));
        Assert.Equal(0, await db.ExecuteScalarAsync<long>("SELECT SizeBytes FROM CacheAccounting"));
        await f.ProcessAllAsync();
        Assert.Equal(2, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM CacheEntries WHERE State='ready'"));
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Media WHERE SourceRevision=1"));
        // Source disappearance does not invalidate generated content during cache verification.
        File.Delete(Path.Combine(f.Root.Path, "image.png"));
        await f.ScanAsync();
        await f.Cache.MaintainAsync(default);
        Assert.Equal(2, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM CacheEntries WHERE State='ready'"));
    }

    [Fact]
    public async Task Source_loss_waits_for_scan_and_stale_claim_cannot_publish()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await f.CreateImageAsync("image.png");
        await f.ScanAsync();
        var job = await f.ClaimAsync();
        File.Move(Path.Combine(f.Root.Path, "image.png"), Path.Combine(f.Root.Path, "saved"));
        await f.Processor.ProcessAsync(job!, "image", default);
        await using var db = await f.Database.OpenAsync(default);
        Assert.Equal("waiting", await db.ExecuteScalarAsync<string>("SELECT State FROM ProcessingJobs"));
        File.Move(Path.Combine(f.Root.Path, "saved"), Path.Combine(f.Root.Path, "image.png"));
        await f.ScanAsync();
        var stale = await f.ClaimAsync();
        await f.ScanAsync(force: true);
        Assert.False(await f.Cache.PublishAsync(stale!, new(10, 10, null, null), [], default));
        await f.ProcessAllAsync();
        Assert.Equal(2, await db.ExecuteScalarAsync<long>("SELECT SourceRevision FROM Media"));
        Assert.Equal("ready", await db.ExecuteScalarAsync<string>("SELECT ProcessingStatus FROM Media"));
    }

    [Fact]
    public async Task Unavailable_root_does_not_mark_existing_media_missing()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "one.jpg"), "bad");
        await f.ScanAsync();
        var scan = await f.NewScanAsync();
        var moved = f.Root.Path + "-offline";
        Directory.Move(f.Root.Path, moved);
        try
        {
            await Assert.ThrowsAnyAsync<IOException>(() => f.Scanner.ScanAsync(scan, f.Root, default));
            await using var db = await f.Database.OpenAsync(default);
            Assert.Equal("present", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Media"));
            Assert.Equal("running", await db.ExecuteScalarAsync<string>("SELECT State FROM Scans WHERE Id=@Id", scan));
        }
        finally { Directory.Move(moved, f.Root.Path); }
    }

    [Fact]
    public async Task Scan_api_has_conflict_idempotent_cancel_and_sanitized_diagnostics()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await using var host = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Testing")
            .UseSetting("Luma:DatabasePath", f.Database.Path).UseSetting("Luma:Indexing:CachePath", f.Options.CachePath)
            .UseSetting("Luma:Indexing:Libraries:0:Id", "1").UseSetting("Luma:Indexing:Libraries:0:Name", "Fixture")
            .UseSetting("Luma:Indexing:Libraries:0:Path", f.Root.Path).UseSetting("Luma:Indexing:Libraries:0:ScanOnStartup", "false"));
        using var client = host.CreateClient();
        var beforeScan = await client.GetFromJsonAsync<IndexingStatus>("/api/indexing");
        Assert.Null(Assert.Single(beforeScan!.Libraries).LatestScanId);
        var scan = await f.NewScanAsync(); // Holds root ownership without a discovery worker claiming it.
        var conflict = await client.PostAsJsonAsync("/api/libraries/1/scans", new StartScanRequest());
        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
        Assert.Contains("conflict", await conflict.Content.ReadAsStringAsync());
        Assert.DoesNotContain(f.Root.Path, await conflict.Content.ReadAsStringAsync());
        for (var i = 0; i < 2; i++) Assert.Equal(HttpStatusCode.Accepted, (await client.PostAsync($"/api/scans/{scan.Id}/cancel", null)).StatusCode);
        var progress = await client.GetFromJsonAsync<ScanProgress>($"/api/scans/{scan.Id}");
        Assert.Equal("cancelled", progress!.State);
        await using (var db = await f.Database.OpenAsync(default))
            await db.ExecuteAsync("""
                WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<101)
                INSERT INTO ProcessingFailures(ScanId,MediaId,Code,OccurredAt) SELECT @Id,NULL,'source_unavailable','2026-09-15T00:00:00Z' FROM n
                """, scan);
        var firstFailures = await client.GetFromJsonAsync<ScanProgress>($"/api/scans/{scan.Id}");
        Assert.Equal(100, firstFailures!.Failures.Count);
        Assert.NotNull(firstFailures.NextFailureId);
        var lastFailures = await client.GetFromJsonAsync<ScanProgress>($"/api/scans/{scan.Id}?afterFailureId={firstFailures.NextFailureId}");
        Assert.Single(lastFailures!.Failures);
        Assert.Null(lastFailures.NextFailureId);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync("/api/libraries/999/scans", new StartScanRequest())).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync($"/api/scans/{scan.Id}?afterFailureId=-1")).StatusCode);
        var start = await client.PostAsJsonAsync("/api/libraries/1/scans", new StartScanRequest());
        Assert.Equal(HttpStatusCode.Accepted, start.StatusCode);
        Assert.NotNull(start.Headers.Location);
        var indexing = await client.GetFromJsonAsync<IndexingStatus>("/api/indexing");
        Assert.Single(indexing!.Libraries);
    }

    [Fact]
    public async Task Quota_pressure_pauses_generation_and_lease_is_released()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await f.CreateImageAsync("image.png");
        await f.ScanAsync();
        f.Options.ReserveFreeBytes = long.MaxValue / 2;
        await f.ProcessAllAsync();
        await using var db = await f.Database.OpenAsync(default);
        Assert.True(f.Cache.UnderPressure);
        Assert.Equal("pending", await db.ExecuteScalarAsync<string>("SELECT State FROM ProcessingJobs"));
        Assert.Null(await db.ExecuteScalarAsync<string>("SELECT Claim FROM ProcessingJobs"));
        Assert.Equal(0, await db.ExecuteScalarAsync<long>("SELECT COUNT(*) FROM CacheEntries"));
    }

    [Theory]
    [InlineData(0, 128)]
    [InlineData(5, 128)]
    [InlineData(2, 15)]
    [InlineData(2, 1025)]
    public void Invalid_worker_and_queue_limits_are_rejected(int workers, int capacity)
    {
        var options = new IndexingOptions { ProcessingWorkers = workers, QueueCapacity = capacity };
        Assert.Throws<InvalidOperationException>(() => options.Validate(Path.GetTempPath(), Path.Combine(Path.GetTempPath(), "luma.db")));
    }

    [Fact]
    public async Task Overlapping_roots_and_data_within_media_are_rejected()
    {
        await using var f = await PipelineFixture.CreateAsync();
        f.Options.Libraries.Add(new() { Id = 2, Name = "nested", Path = Path.Combine(f.Root.Path, "nested") });
        Assert.Throws<InvalidOperationException>(() => f.Options.Validate(f.DirectoryPath, f.Database.Path));
        f.Options.Libraries.RemoveAt(1);
        f.Options.CachePath = Path.Combine(f.Root.Path, "cache");
        Assert.Throws<InvalidOperationException>(() => f.Options.Validate(f.DirectoryPath, f.Database.Path));
    }

    // The migrations analyse Media before a library exists, so a fresh install starts with
    // statistics describing an empty table. Left there, the planner costs every browse query
    // against zero rows and walks the library instead of seeking a sort index.
    [Fact]
    public async Task Scanning_brings_query_statistics_up_to_the_size_of_the_library()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await using var db = await f.Database.OpenAsync(default);
        const string planned = "SELECT MAX(CAST(stat AS INTEGER)) FROM sqlite_stat1 WHERE tbl='Media'";
        Assert.Equal(0, await db.ExecuteScalarAsync<long>(planned));

        foreach (var name in new[] { "one.png", "two.png", "three.png" }) await f.CreateImageAsync(name);
        await f.ScanAsync();

        Assert.Equal(3, await db.ExecuteScalarAsync<long>("SELECT COUNT(*) FROM Media"));
        Assert.Equal(3, await db.ExecuteScalarAsync<long>(planned));
    }

    [Fact]
    public async Task Tool_cancellation_kills_child_process_promptly()
    {
        using var stop = new CancellationTokenSource(TimeSpan.FromMilliseconds(300));
        var start = System.Diagnostics.Stopwatch.StartNew();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => MediaProcessor.RunAsync("ffmpeg",
            ["-v", "error", "-re", "-f", "lavfi", "-i", "testsrc=size=64x64:rate=1", "-f", "null", "-"], stop.Token));
        Assert.True(start.Elapsed < TimeSpan.FromSeconds(10));
    }
}

internal sealed class UnixFactAttribute : FactAttribute
{
    public UnixFactAttribute()
    {
        if (OperatingSystem.IsWindows()) Skip = "Symlink behavior runs on Linux; Windows CI does not grant symlink privileges.";
    }
}

internal sealed class PipelineFixture : IAsyncDisposable
{
    public string DirectoryPath { get; } = Path.Combine(Path.GetTempPath(), "luma-pipeline", Guid.NewGuid().ToString("N"));
    public LibraryOptions Root { get; private set; } = null!;
    public IndexingOptions Options { get; private set; } = null!;
    public Database Database { get; private set; } = null!;
    public ScanWorker Scanner { get; private set; } = null!;
    public GeneratedCache Cache { get; private set; } = null!;
    public ProcessingWorker Processor { get; private set; } = null!;
    private MediaProcessor decoder = null!;

    public static async Task<PipelineFixture> CreateAsync()
    {
        var f = new PipelineFixture();
        f.Root = new() { Id = 1, Name = "Fixture", Path = Path.Combine(f.DirectoryPath, "media"), ScanOnStartup = false };
        Directory.CreateDirectory(f.Root.Path);
        f.Options = new() { Libraries = [f.Root], CachePath = Path.Combine(f.DirectoryPath, "cache") };
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Luma:DatabasePath"] = Path.Combine(f.DirectoryPath, "data", "luma.db") }).Build();
        f.Database = new(config, new TestEnvironment { ContentRootPath = f.DirectoryPath });
        f.Options.Validate(f.DirectoryPath, f.Database.Path);
        await new MigrationRunner(f.Database).ApplyAsync(default);
        await new IndexingSetup(f.Database, f.Options).InitializeAsync(default);
        f.Scanner = new(f.Database, f.Options, NullLogger<ScanWorker>.Instance);
        f.Cache = new(f.Database, f.Options);
        f.decoder = new(f.Options);
        f.Processor = new(f.Database, f.Options, f.decoder, f.Cache, NullLogger<ProcessingWorker>.Instance);
        return f;
    }

    public Task CreateImageAsync(string name) => MediaProcessor.RunAsync("ffmpeg",
        ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=128x96", "-frames:v", "1", "-threads", "1", Path.Combine(Root.Path, name)], default);
    public async Task CreateMixedAsync()
    {
        Directory.CreateDirectory(Path.Combine(Root.Path, "empty", "nested"));
        foreach (var extension in new[] { "jpg", "png", "webp", "gif", "bmp", "tiff" }) await CreateImageAsync("image." + extension);
        foreach (var extension in new[] { "mp4", "m4v", "mov", "mkv", "webm", "avi" })
            await MediaProcessor.RunAsync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=128x96:r=4", "-t", "1",
                "-c:v", extension == "webm" ? "libvpx" : "mpeg4", "-threads", "1", "-f", extension == "m4v" ? "mp4" : extension == "mkv" ? "matroska" : extension,
                Path.Combine(Root.Path, "video." + extension)], default);
        await File.WriteAllTextAsync(Path.Combine(Root.Path, "broken.jpg"), "not a photo");
        await File.WriteAllTextAsync(Path.Combine(Root.Path, "unsupported.heic"), "unsupported");
    }
    public async Task<ScanRow> NewScanAsync(bool force = false, bool retry = false)
    {
        await using var db = await Database.OpenAsync(default);
        return await db.QuerySingleAsync<ScanRow>("""
            INSERT INTO Scans(LibraryId,State,Force,RetryFailures,StartedAt) VALUES(1,'running',@force,@retry,@now) RETURNING *
            """, new { force, retry, now = DateTimeOffset.UtcNow.ToString("O") });
    }
    public async Task<ScanRow> ScanAsync(bool force = false, bool retry = false)
    {
        var scan = await NewScanAsync(force, retry);
        await Scanner.ScanAsync(scan, Root, default);
        return scan;
    }
    public async Task<ProcessingJob?> ClaimAsync()
    {
        await using var db = await Database.OpenAsync(default);
        return await db.QuerySingleOrDefaultAsync<ProcessingJob>("""
            UPDATE ProcessingJobs SET State='running',Claim='test',LeaseUntil='2099' WHERE rowid=(SELECT rowid FROM ProcessingJobs
            WHERE State='pending' AND NextAttemptAt<=@now ORDER BY MediaId LIMIT 1) RETURNING *
            """, new { now = DateTimeOffset.UtcNow.ToString("O") });
    }
    // Indexing prepares thumbnails; opening an image in the viewer requests its large preview.
    public async Task RequestPreviewsAsync()
    {
        await using var db = await Database.OpenAsync(default);
        var ids = (await db.QueryAsync<long>("SELECT Id FROM Media WHERE MediaType='image'")).ToArray();
        if (ids.Length > 0) await (await BrowsingTests.BrowserAsync(this)).PrioritizeAsync(new(ids, true), default);
    }
    public async Task ProcessAllAsync()
    {
        while (await ClaimAsync() is { } job)
        {
            await using var db = await Database.OpenAsync(default);
            var type = await db.ExecuteScalarAsync<string>("SELECT MediaType FROM Media WHERE Id=@MediaId", job);
            await Processor.ProcessAsync(job, type!, default);
        }
    }
    public ValueTask DisposeAsync()
    {
        Scanner.Dispose();
        Processor.Dispose();
        decoder.Dispose();
        SqliteConnection.ClearAllPools();
        foreach (var path in Directory.EnumerateFiles(DirectoryPath, "*", SearchOption.AllDirectories)) File.SetAttributes(path, FileAttributes.Normal);
        Directory.Delete(DirectoryPath, true);
        return ValueTask.CompletedTask;
    }
    private sealed class TestEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Testing";
        public string ApplicationName { get; set; } = "Luma.Server";
        public string ContentRootPath { get; set; } = "";
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = new Microsoft.Extensions.FileProviders.NullFileProvider();
    }
}
