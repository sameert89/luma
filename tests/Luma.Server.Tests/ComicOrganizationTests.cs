using Dapper;
using Luma.Server.Features.Libraries;
using Luma.Server.Features.Media;
using Luma.Server.Features.Panels;
using Luma.Server.Features.Tags;
using Microsoft.Extensions.Configuration;

namespace Luma.Server.Tests;

public sealed class ComicOrganizationTests
{
    [Fact]
    public async Task Mixed_unread_and_read_comics_keep_real_reading_seconds_and_resume_pages()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("""
            INSERT INTO Comics(Id,LibraryId,RelativePath,PathKey,Format,Title,PageCount,SourceSize,SourceModifiedTicks,AddedAt)
            VALUES (101,1,'unread.cbz','unread.cbz','zip','Unread',10,1,1,'2026-01-01'),
                   (102,1,'read.cbz','read.cbz','zip','Read',10,1,1,'2026-01-01');
            INSERT INTO ReadingProgress(ComicId,PageIndex,State,ReadingSeconds) VALUES(102,6,'reading',1.5);
            """);
        var library = new ComicLibrary(f.Database, f.Options);
        // Warm the shared deserializer with a real value, then read a mixed page including an unread zero.
        Assert.Equal(1.5, (await library.GetAsync(102, default)).ReadingSeconds);
        var rows = (await library.ListAsync(null, null, null, null, null, default)).Items;
        Assert.Equal(0, rows.Single(x => x.Id == 101).ReadingSeconds);
        Assert.Equal(6, rows.Single(x => x.Id == 102).PageIndex);
        Assert.Equal(1.5, rows.Single(x => x.Id == 102).ReadingSeconds);
        await db.ExecuteAsync("UPDATE ReadingProgress SET ReadingSeconds=0 WHERE ComicId=102");
        Assert.Equal(0, (await library.ListAsync(null, null, null, null, null, default)).Items.Single(x => x.Id == 102).ReadingSeconds);
        var progress = new ComicProgress(f.Database, library);
        await progress.UpdateAsync(101, new(Guid.NewGuid().ToString(), 1, 4, 0), default);
        Assert.Equal(4, (await library.GetAsync(101, default)).PageIndex);
    }

    [Fact]
    public async Task Exclusion_preserves_existing_media_and_tags_and_stops_future_gallery_discovery()
    {
        await using var f = await PipelineFixture.CreateAsync();
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "Comics"));
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "ComicsExtra"));
        await f.CreateImageAsync("Comics/page.jpg");
        await f.CreateImageAsync("ComicsExtra/photo.jpg");
        await f.ScanAsync();
        await using var db = await f.Database.OpenAsync(default);
        var id = await db.ExecuteScalarAsync<long>("SELECT Id FROM Media WHERE RelativePath='Comics/page.jpg'");
        var tags = new TagService(f.Database);
        var tag = (await tags.CreateAsync("Comic exclusive", default)).Tag;
        await tags.BulkAsync(new([id], [tag.Id], []), default);
        var sources = new PanelSources(f.Database, f.Options, new ConfigurationBuilder().Build());
        await sources.SaveAsync([new(1, "Comics")], default);
        Assert.Equal("waiting", await db.ExecuteScalarAsync<string>("SELECT State FROM ProcessingJobs WHERE MediaId=@id", new { id }));
        await db.ExecuteAsync("UPDATE ProcessingJobs SET State='pending' WHERE MediaId=@id", new { id });
        await sources.InitializeAsync(default);
        Assert.Equal("waiting", await db.ExecuteScalarAsync<string>("SELECT State FROM ProcessingJobs WHERE MediaId=@id", new { id }));
        var (predicate, parameters) = new MediaQuery().Normalize().Predicate();
        Assert.Equal(1, await db.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM Media m WHERE {predicate}", parameters));
        Assert.Empty(await tags.FindAsync("Comic", 20, default));
        Assert.DoesNotContain(await SearchSuggestions.SuggestAsync(f.Database, "Comic", 20, default), x => x.Kind == "tag" && x.Id == tag.Id);
        await f.CreateImageAsync("Comics/new.jpg");
        await f.ScanAsync();
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Media WHERE RelativePath='Comics/new.jpg'"));
        Assert.Equal("present", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Media WHERE Id=@id", new { id }));
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM MediaTags WHERE MediaId=@id", new { id }));
        await sources.SaveAsync([new(1, "Comics", ExcludeFromGallery: false)], default);
        Assert.Equal(2, await db.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM Media m WHERE {predicate}", parameters));
        Assert.Equal(tag.Id, Assert.Single(await tags.FindAsync("Comic", 20, default)).Id);
        Assert.Equal(id, await db.ExecuteScalarAsync<long>("SELECT Id FROM Media WHERE RelativePath='Comics/page.jpg'"));
    }

    [Fact]
    public async Task Multiple_locations_in_one_library_queue_without_duplicate_comic_identity()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var sources = new PanelSources(f.Database, f.Options, new ConfigurationBuilder().Build());
        await sources.SaveAsync([new(1, "Manga"), new(1, "Western"), new(1, "Manga")], default);
        await using var db = await f.Database.OpenAsync(default);
        Assert.Equal(2, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM ComicJobs WHERE State='queued'"));
        Assert.Equal(2, (await sources.GetAsync(default)).Locations.Count);
    }

    [Fact]
    public async Task Comic_hierarchy_series_search_and_tags_work_without_original_media()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await using var db = await f.Database.OpenAsync(default);
        foreach (var path in new[] { "Base/Manga/DBZ/01.cbz", "Base/Manga/DBZ/02.cbz", "Base/Western/03.cbz", "Base/root.cbz" })
            await db.ExecuteAsync("""
                INSERT INTO Comics(LibraryId,RelativePath,PathKey,Format,Title,Series,PageCount,SourceSize,SourceModifiedTicks,AddedAt)
                VALUES(1,@path,@key,'zip',@path,'Dragon Ball',3,1,1,'2026-01-01')
                """, new { path, key = f.Root.Key(path) });
        var library = new ComicLibrary(f.Database, f.Options);
        var offline = f.Root.Path + ".offline";
        Directory.Move(f.Root.Path, offline);
        try
        {
            Assert.Empty((await library.FoldersAsync(1, "Absent", null, default)).Items);
            Assert.Equal(new[] { "Manga", "Western" }, (await library.FoldersAsync(1, "Base", null, default)).Items.Select(x => x.Name));
            Assert.Equal("Base/Manga/DBZ", Assert.Single((await library.FoldersAsync(1, "Base/Manga", null, default)).Items).RelativePath);
            Assert.Single((await library.ListAsync(null, null, null, null, null, default, 1, "Base")).Items);
            Assert.Equal(2, (await library.ListAsync(null, null, null, null, null, default, 1, "Base/Manga/DBZ")).Items.Count);
            Assert.Equal(4, (await library.SuggestAsync("Dragon", 8, default)).Count);
            Assert.Equal(4, (await library.ListAsync("Dragon", null, null, null, null, default)).Items.Count);
            var tags = new TagService(f.Database);
            var tag = (await tags.CreateAsync("Shonen", default)).Tag;
            var id = await db.ExecuteScalarAsync<long>("SELECT MIN(Id) FROM Comics");
            await library.UpdateTagsAsync(id, new([tag.Id], []), default);
            Assert.Equal(tag.Id, Assert.Single(await library.TagsAsync(id, default)).Id);
            Assert.Empty(await tags.FindAsync("Shonen", 20, default));
            Assert.Single((await library.ListAsync(null, null, null, null, null, default, tag: "Shonen")).Items);
            var target = (await tags.CreateAsync("Action", default)).Tag;
            await tags.RenameAsync(tag.Id, "Action", default);
            Assert.Equal(target.Id, Assert.Single(await library.TagsAsync(id, default)).Id);
            await tags.DeleteAsync(target.Id, default);
            Assert.Empty(await library.TagsAsync(id, default));
            await db.ExecuteAsync("INSERT INTO Comics(LibraryId,RelativePath,PathKey,Format,Title,PageCount,SourceSize,SourceModifiedTicks,AddedAt) VALUES(1,'Base',@key,'folder','Root image book',1,1,1,'2026-01-01')", new { key = f.Root.Key("Base") });
            Assert.Equal(2, (await library.ListAsync(null, null, null, null, null, default, 1, "Base")).Items.Count);
        }
        finally { Directory.Move(offline, f.Root.Path); }
    }
}
