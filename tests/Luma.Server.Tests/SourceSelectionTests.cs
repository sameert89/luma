using Dapper;
using Luma.Server.Features.Files;
using Luma.Server.Features.Media;
using Luma.Server.Features.Panels;
using Luma.Server.Http;
using Microsoft.Extensions.Configuration;

namespace Luma.Server.Tests;

public sealed class SourceSelectionTests
{
    [Fact]
    public async Task Comic_folders_can_be_browsed_before_indexing_and_searched_without_originals()
    {
        await using var f = await PipelineFixture.CreateAsync();
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "Archive", "Manga"));
        await f.CreateImageAsync("Archive/Manga/page.jpg");
        var sources = new PanelSources(f.Database, f.Options, new ConfigurationBuilder().Build());
        Assert.Contains((await sources.FoldersAsync(1, "", null, 0, default)).Items, x => x.RelativePath == "Archive");
        Assert.Contains((await sources.FoldersAsync(1, "Archive", null, 0, default)).Items, x => x.RelativePath == "Archive/Manga");
        await Assert.ThrowsAsync<ApiRequestException>(() => sources.FoldersAsync(1, "../outside", null, 0, default));
        await f.ScanAsync();
        var offline = f.Root.Path + ".offline";
        Directory.Move(f.Root.Path, offline);
        try { Assert.Contains((await sources.FoldersAsync(1, "", "Manga", 0, default)).Items, x => x.RelativePath == "Archive/Manga"); }
        finally { Directory.Move(offline, f.Root.Path); }
    }
    [Fact]
    public async Task Flick_suggestions_exclude_photos_and_comic_suggestions_only_match_titles()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await f.CreateImageAsync("clip-photo.jpg");
        await f.CreateImageAsync("clip-video.jpg");
        await f.ScanAsync();
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("UPDATE Media SET MediaType='video' WHERE FileName='clip-video.jpg'");
        var suggestions = await SearchSuggestions.SuggestAsync(f.Database, "clip", 8, default, "video");
        Assert.Equal("clip-video.jpg", Assert.Single(suggestions.Where(x => x.Kind == "file")).Label);
        await db.ExecuteAsync("""
            INSERT INTO Comics(LibraryId,RelativePath,PathKey,Format,Title,Author,PageCount,SourceSize,SourceModifiedTicks,AddedAt)
            VALUES(1,'moon.cbz','MOON.CBZ','zip','Moon','Sun',3,1,1,'2026-01-01')
            """);
        var comics = new ComicLibrary(f.Database, f.Options);
        Assert.Equal("comic", Assert.Single(await comics.SuggestAsync("Moon", 8, default)).Kind);
        Assert.Empty(await comics.SuggestAsync("Sun", 8, default));
    }
}
