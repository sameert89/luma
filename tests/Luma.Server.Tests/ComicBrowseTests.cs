using Dapper;
using Luma.Server.Features.Panels;

namespace Luma.Server.Tests;

public sealed class ComicBrowseTests
{
    [Fact]
    public async Task Search_and_suggestions_match_title_author_series_and_normalized_tags_without_duplicate_books()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("""
            INSERT INTO Comics(LibraryId,RelativePath,PathKey,Format,Title,Author,Series,PageCount,SourceSize,SourceModifiedTicks,AddedAt)
            VALUES(1,'book.cbz','book.cbz','zip','Title','Author','Series',2,1,1,'2026-10-30');
            INSERT INTO Tags(Name,NormalizedKey) VALUES('हिंदी','हिंदी'),('Action','ACTION'),('Adventure','ADVENTURE');
            INSERT INTO ComicTags SELECT c.Id,t.Id FROM Comics c,Tags t;
            """);
        // Use the application's normalization for mixed-case/non-ASCII tag keys.
        foreach (var row in await db.QueryAsync<Luma.Server.Features.Media.TagSummary>("SELECT Id,Name FROM Tags"))
            await db.ExecuteAsync("UPDATE Tags SET NormalizedKey=@key WHERE Id=@Id", new { row.Id, key = Luma.Server.Features.Media.SearchText.Key(row.Name) });
        var library = new ComicLibrary(f.Database, f.Options);
        foreach (var term in new[] { "Title", "AUTHOR", "Series", "act", "हिंदी", "  adventure  " })
        {
            var comic = Assert.Single((await library.ListAsync(term, null, null, null, null, default)).Items);
            Assert.Equal(3, comic.TagCount);
            Assert.Equal(2, comic.Tags!.Count);
            Assert.Single(await library.SuggestAsync(term, 8, default));
        }
        Assert.Empty((await library.ListAsync("unrelated", null, null, null, null, default)).Items);
        await db.ExecuteAsync("UPDATE Comics SET Availability='missing'");
        Assert.Empty(await library.SuggestAsync("Action", 8, default));
    }

    [Fact]
    public async Task Recently_added_returns_ten_newest_visible_books_in_stable_date_order_and_preserves_progress()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("""
            WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<15)
            INSERT INTO Comics(Id,LibraryId,RelativePath,PathKey,Format,Title,PageCount,SourceSize,SourceModifiedTicks,AddedAt)
            SELECT n,1,n||'.cbz',n||'.cbz','zip','Comic '||n,10,1,1,CASE WHEN n=1 THEN '2026-10-31' ELSE '2026-10-30' END FROM numbers;
            UPDATE Comics SET Availability='missing' WHERE Id=15;
            INSERT INTO ReadingProgress(ComicId,PageIndex,State) VALUES(1,3,'reading');
            """);
        var library = new ComicLibrary(f.Database, f.Options);
        var recent = await library.RecentAsync(default);
        Assert.Equal(new long[] { 1, 14, 13, 12, 11, 10, 9, 8, 7, 6 }, recent.Select(x => x.Id));
        Assert.Equal(3, recent[0].PageIndex);
        await db.ExecuteAsync("INSERT INTO ApplicationState(Key,Value) VALUES('panelSourcesConfigured','1'); INSERT INTO PanelSources(LibraryId,RelativePath,PathKey) VALUES(1,'elsewhere','elsewhere')");
        Assert.Empty(await library.RecentAsync(default));
    }
}
