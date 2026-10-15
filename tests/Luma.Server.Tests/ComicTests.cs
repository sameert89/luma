using System.IO.Compression;
using Dapper;
using Luma.Server.Features.Panels;
using Luma.Server.Features.Files;
using Luma.Server.Http;
using Microsoft.Extensions.Logging.Abstractions;

namespace Luma.Server.Tests;

public sealed class ComicTests
{
    private static void Zip(string path, params string[] names)
    {
        using var archive = ZipFile.Open(path, ZipArchiveMode.Create);
        foreach (var name in names)
        {
            using var output = archive.CreateEntry(name).Open();
            output.Write("page content"u8);
        }
    }
    [Fact]
    public async Task Zip_pages_are_naturally_ordered_and_only_one_page_is_extracted()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var source = Path.Combine(f.Root.Path, "book.cbz");
        Zip(source, "page10.jpg", "page2.jpg", "page1.jpg", "notes.txt");
        var pages = ComicSources.Inspect(source, false, default);
        Assert.Equal(new[] { "page1.jpg", "page2.jpg", "page10.jpg" }, pages.Select(x => x.Name));
        var output = Path.Combine(f.DirectoryPath, "extracted.jpg");
        await ComicSources.ExtractPageAsync(source, false, pages[1], output, default);
        Assert.Equal("page content", await File.ReadAllTextAsync(output));
        Assert.False(File.Exists(Path.Combine(f.DirectoryPath, "page1.jpg")));
    }
    [Fact]
    public async Task Archive_traversal_and_excessive_entry_counts_are_rejected()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var path = Path.Combine(f.Root.Path, "unsafe.cbz");
        Zip(path, "../outside.jpg");
        Assert.Throws<ApiRequestException>(() => ComicSources.Inspect(path, false, default));
        File.Delete(path);
        Zip(path, Enumerable.Range(0, ComicSources.MaximumEntries + 1).Select(x => $"{x}.jpg").ToArray());
        Assert.Equal("comic_entry_limit", Assert.Throws<ApiRequestException>(() => ComicSources.Inspect(path, false, default)).Code);
    }
    [Fact]
    public async Task Explicit_image_folders_ignore_child_folders_and_sort_pages()
    {
        await using var f = await PipelineFixture.CreateAsync();
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "chapter"));
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "10.jpg"), "page");
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "2.jpg"), "page");
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "chapter", "1.jpg"), "child page");
        Assert.Equal(new[] { "2.jpg", "10.jpg" }, ComicSources.Inspect(f.Root.Path, true, default).Select(x => x.Name));
    }
    [Fact]
    public async Task Discovery_and_page_preparation_use_isolated_workers_and_bounded_decoder_pool()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await f.CreateImageAsync("page2.png");
        var archivePath = Path.Combine(f.Root.Path, "book.cbz");
        using (var archive = ZipFile.Open(archivePath, ZipArchiveMode.Create))
        {
            archive.CreateEntryFromFile(Path.Combine(f.Root.Path, "page2.png"), "page10.png");
            archive.CreateEntryFromFile(Path.Combine(f.Root.Path, "page2.png"), "page2.png");
        }
        var library = new ComicLibrary(f.Database, f.Options);
        using var decoder = new Luma.Server.MediaProcessing.MediaProcessor(f.Options);
        var pages = new ComicPageContent(f.Database, f.Options, library, decoder);
        var worker = new ComicWorker(f.Database, f.Options, library, pages, NullLogger<ComicWorker>.Instance);
        var accepted = await library.QueueAsync(new(1), default);
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("UPDATE ComicJobs SET State='running' WHERE Id=@Id", accepted);
        await worker.ProcessAsync(await db.QuerySingleAsync<ComicJob>("SELECT * FROM ComicJobs"), default);
        Assert.Equal("completed", await db.ExecuteScalarAsync<string>("SELECT State FROM ComicJobs"));
        Assert.Equal(0, await db.ExecuteScalarAsync<long>("SELECT Failed FROM ComicJobs"));
        var listed = await library.ListAsync(null, null, null, null, null, default);
        var comic = Assert.Single(listed.Items);
        Assert.Equal(2, comic.PageCount);
        Assert.NotNull(comic.CoverUrl);
        var path = await pages.PrepareAsync(await library.GetAsync(comic.Id, default), 1, "page", default);
        Assert.True(new FileInfo(path).Length > 0);
        Assert.Equal(2, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM ComicCache"));
        Assert.Equal("page2.png", await db.ExecuteScalarAsync<string>("SELECT EntryName FROM ComicPages WHERE PageIndex=0"));
    }

    private static async Task<long> SeedAsync(PipelineFixture f, string path = "book.cbz")
    {
        await using var db = await f.Database.OpenAsync(default);
        return await db.ExecuteScalarAsync<long>("""
            INSERT INTO Comics(LibraryId,RelativePath,PathKey,Format,Title,PageCount,SourceSize,SourceModifiedTicks,AddedAt)
              VALUES(1,@path,@path,'zip','Book',3,1,1,'2026-01-01') RETURNING Id
            """, new { path });
    }
    [Fact]
    public async Task Reading_time_heartbeats_are_deduplicated_bounded_and_pause_with_zero_delta()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var id = await SeedAsync(f);
        var library = new ComicLibrary(f.Database, f.Options);
        var progress = new ComicProgress(f.Database, library);
        var session = Guid.NewGuid().ToString();
        await progress.UpdateAsync(id, new(session, 1, 0, 20), default);
        await using var db = await f.Database.OpenAsync(default);
        Assert.Equal(0, await db.ExecuteScalarAsync<double>("SELECT ReadingSeconds FROM ReadingProgress"));
        await db.ExecuteAsync("UPDATE ReadingSessions SET UpdatedAt=@time", new { time = DateTimeOffset.UtcNow.AddSeconds(-10).ToString("O") });
        await progress.UpdateAsync(id, new(session, 2, 1, 8, "rtl"), default);
        await progress.UpdateAsync(id, new(session, 2, 2, 8, "rtl"), default);
        Assert.Equal(8, await db.ExecuteScalarAsync<double>("SELECT ReadingSeconds FROM ReadingProgress"));
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT PageIndex FROM ReadingProgress"));
        await progress.UpdateAsync(id, new(session, 3, 2, 0, "rtl"), default);
        var statistics = await progress.StatisticsAsync(default);
        Assert.Equal(1, statistics.Completed);
        Assert.Equal(8, statistics.ReadingSeconds);
        await Assert.ThrowsAsync<ApiRequestException>(() => progress.UpdateAsync(id, new(session, 4, 0, 31), default));
    }
    [Fact]
    public async Task Comic_listing_uses_database_and_cover_cache_without_accessing_the_volume()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var id = await SeedAsync(f);
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("INSERT INTO ComicCache VALUES(@id,1,'cover','comic-cover.webp',10,'now')", new { id });
        var moved = f.Root.Path + "-unavailable";
        Directory.Move(f.Root.Path, moved);
        try
        {
            var result = await new ComicLibrary(f.Database, f.Options).ListAsync("Book", "unread", null, null, null, default);
            Assert.Equal(id, Assert.Single(result.Items).Id);
            Assert.NotNull(result.Items[0].CoverUrl);
        }
        finally { Directory.Move(moved, f.Root.Path); }
    }
    [Fact]
    public async Task Cache_maintenance_retains_comic_pages_and_removes_untracked_files()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var id = await SeedAsync(f);
        var relative = Path.Combine("comics", "page.jpg");
        var path = Path.Combine(f.Options.CachePath, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await File.WriteAllTextAsync(path, "cached page");
        var orphan = Path.Combine(f.Options.CachePath, "orphan.jpg");
        await File.WriteAllTextAsync(orphan, "orphan");
        File.SetLastWriteTimeUtc(path, DateTime.UtcNow.AddHours(-1));
        File.SetLastWriteTimeUtc(orphan, DateTime.UtcNow.AddHours(-1));
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("INSERT INTO ComicCache VALUES(@id,1,'page-0',@relative,11,'now')", new { id, relative });
        await new Luma.Server.MediaProcessing.GeneratedCache(f.Database, f.Options).MaintainAsync(default);
        Assert.True(File.Exists(path));
        Assert.False(File.Exists(orphan));
        await db.ExecuteAsync("UPDATE Comics SET Revision=2");
        var listed = await new ComicLibrary(f.Database, f.Options).ListAsync(null, null, null, null, null, default);
        Assert.Null(Assert.Single(listed.Items).CoverUrl);
    }
    [Fact]
    public async Task Malformed_reader_settings_are_rejected_and_preferences_are_returned()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var id = await SeedAsync(f);
        var library = new ComicLibrary(f.Database, f.Options);
        var progress = new ComicProgress(f.Database, library);
        var session = Guid.NewGuid().ToString();
        await Assert.ThrowsAsync<ApiRequestException>(() => progress.UpdateAsync(id, new(session, 1, 0, 0, Settings: "{"), default));
        await progress.UpdateAsync(id, new(session, 1, 0, 0, Settings: "{\"mode\":\"continuous\"}"), default);
        var listed = await library.ListAsync(null, null, null, null, null, default);
        Assert.Equal("{\"mode\":\"continuous\"}", Assert.Single(listed.Items).Settings);
    }
    [Fact]
    public async Task Controlled_recycle_restore_preserves_comic_identity_and_reading_progress()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var path = "book.cbz";
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, path), "comic");
        var id = await SeedAsync(f, path);
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("INSERT INTO ReadingProgress(ComicId,PageIndex,State,ReadingSeconds) VALUES(@id,1,'reading',123)", new { id });
        f.Root.Writable = true;
        var operations = new FileOperations(f.Database, f.Options);
        var worker = new FileOperationWorker(operations, f.Database, NullLogger<FileOperationWorker>.Instance);
        async Task<string> Execute(FileOperationRequest request)
        {
            var queued = await operations.QueueAsync(request, default);
            await db.ExecuteAsync("UPDATE FileOperations SET State='running' WHERE Id=@Id", queued);
            await worker.ExecuteOperationAsync(await operations.GetAsync(queued.Id, default), false, default);
            Assert.Equal("completed", (await operations.GetAsync(queued.Id, default)).State);
            return queued.Id;
        }
        var recycle = await Execute(new(1, "recycle", path));
        Assert.Equal("missing", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Comics"));
        await Execute(new(1, "restore", path, RecycleId: recycle));
        Assert.Equal(id, await db.ExecuteScalarAsync<long>("SELECT Id FROM Comics"));
        Assert.Equal("present", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Comics"));
        Assert.Equal(123, await db.ExecuteScalarAsync<int>("SELECT ReadingSeconds FROM ReadingProgress"));
    }
}
