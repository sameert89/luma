using Dapper;
using Luma.Server.Features.Panels;
using Microsoft.Extensions.Configuration;

namespace Luma.Server.Tests;

public sealed class ComicShelfTests
{
    [Fact]
    public async Task Continue_reading_is_recent_bounded_and_shelf_covers_use_only_indexed_cache_metadata()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await using var db = await f.Database.OpenAsync(default);
        for (var index = 1; index <= 9; index++)
        {
            var path = $"Shelf/Series{index}/book.cbz";
            await db.ExecuteAsync("""
                INSERT INTO Comics(Id,LibraryId,RelativePath,PathKey,Format,Title,PageCount,SourceSize,SourceModifiedTicks,AddedAt)
                VALUES(@index,1,@path,@key,'zip',@path,10,1,1,'2026-01-01');
                INSERT INTO ReadingProgress(ComicId,PageIndex,State,ReadingSeconds,LastReadAt) VALUES(@index,3,'reading',@seconds,@read);
                INSERT INTO ComicCache(ComicId,Revision,Variant,RelativePath,SizeBytes,LastAccessAt) VALUES(@index,1,'cover',@cache,1,'2026-01-01');
                """, new { index, path, key = f.Root.Key(path), seconds = index * 1.5, read = $"2026-01-{index:00}", cache = $"comics/{index}.webp" });
        }
        var sources = new PanelSources(f.Database, f.Options, new ConfigurationBuilder().Build());
        await sources.SaveAsync([new(1, "Shelf")], default);
        var offline = f.Root.Path + ".offline";
        Directory.Move(f.Root.Path, offline);
        try
        {
            var library = new ComicLibrary(f.Database, f.Options);
            var resume = await library.ContinueAsync(default);
            Assert.Equal(new long[] { 9, 8, 7, 6, 5 }, resume.Select(x => x.Id));
            Assert.All(resume, x => { Assert.Equal(3, x.PageIndex); Assert.NotNull(x.CoverUrl); });
            Assert.Equal(5, Assert.Single((await sources.GetAsync(default)).Locations).CoverUrls!.Count);
            var folders = (await library.FoldersAsync(1, "Shelf", null, default)).Items;
            Assert.Equal(9, folders.Count);
            Assert.All(folders, folder => Assert.Single(folder.CoverUrls!));
            await db.ExecuteAsync("UPDATE ReadingProgress SET State='completed' WHERE ComicId=9");
            Assert.Equal(8, (await library.ContinueAsync(default))[0].Id);
        }
        finally { Directory.Move(offline, f.Root.Path); }
    }
}
