using Dapper;
using Luma.Server.Features.Panels;
using Luma.Server.Http;

namespace Luma.Server.Tests;

public sealed class ComicSortingTests
{
    private static async Task SeedAsync(PipelineFixture f)
    {
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("""
            WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<125)
            INSERT INTO Comics(Id,LibraryId,RelativePath,PathKey,Format,Title,PageCount,SourceSize,SourceModifiedTicks,AddedAt)
            SELECT n,1,'Volume '||n||'/book.cbz','Volume '||n||'/book.cbz','zip','Comic '||(126-n),2,1,n%9,
                '2026-10-'||printf('%02d',(n%20)+1) FROM numbers;
            """);
    }

    [Theory]
    [InlineData("title", "asc")]
    [InlineData("title", "desc")]
    [InlineData("added", "asc")]
    [InlineData("added", "desc")]
    [InlineData("modified", "asc")]
    [InlineData("modified", "desc")]
    public async Task Sorting_pages_the_entire_collection_with_stable_ties(string sort, string order)
    {
        await using var f = await PipelineFixture.CreateAsync();
        await SeedAsync(f);
        var library = new ComicLibrary(f.Database, f.Options);
        var ids = new List<long>();
        long? cursor = null;
        do
        {
            var page = await library.ListAsync(null, null, null, null, cursor, default, sort: sort, order: order);
            Assert.InRange(page.Items.Count, 1, 60);
            ids.AddRange(page.Items.Select(x => x.Id));
            cursor = page.NextCursor;
            Assert.True(ids.Count <= 125);
        } while (cursor is not null);
        var numbers = Enumerable.Range(1, 125);
        Func<int, IComparable> key = sort switch
        {
            "title" => n => 126 - n,
            "added" => n => n % 20,
            _ => n => n % 9
        };
        var expected = order == "asc" ? numbers.OrderBy(key).ThenBy(n => n) : numbers.OrderByDescending(key).ThenByDescending(n => n);
        Assert.Equal(expected.Select(x => (long)x), ids);
        Assert.Equal(125, ids.Distinct().Count());
    }

    [Fact]
    public async Task Natural_title_keys_follow_metadata_edits_and_use_the_ordering_index()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await SeedAsync(f);
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("UPDATE Comics SET Title='Comic 0001' WHERE Id=1");
        var library = new ComicLibrary(f.Database, f.Options);
        var page = await library.ListAsync(null, null, null, null, null, default, sort: "title");
        Assert.Equal(new long[] { 1, 125, 124, 123 }, page.Items.Take(4).Select(x => x.Id));
        Assert.Equal(125, (await library.ListAsync(null, null, null, null, null, default)).Items[0].Id);
        var plan = await db.QueryAsync<Plan>("""
            EXPLAIN QUERY PLAN SELECT Id FROM Comics c WHERE c.Availability='present'
              AND (c.TitleSortKey,c.Id)>((SELECT TitleSortKey FROM Comics WHERE Id=60),60)
              ORDER BY c.TitleSortKey,c.Id LIMIT 61
            """);
        Assert.Contains(plan, row => row.Detail.Contains("SEARCH c USING COVERING INDEX IX_Comics_TitleSort", StringComparison.Ordinal));
        Assert.DoesNotContain(plan, row => row.Detail.Contains("TEMP B-TREE", StringComparison.Ordinal));
        var subtreePlan = await db.QueryAsync<Plan>("EXPLAIN QUERY PLAN " + ComicLibrary.ReadSql + " AND c.LibraryId=1 AND c.PathKey>='Volume 2/' AND c.PathKey<'Volume 20'");
        Assert.Contains(subtreePlan, row => row.Detail.Contains("IX_Comics_PathBrowse", StringComparison.Ordinal) && row.Detail.Contains("PathKey>? AND PathKey<?", StringComparison.Ordinal));
        Assert.Equal(60, (await library.ListAsync(null, null, null, null, 999999, default)).Items.Count);
        await Assert.ThrowsAsync<ApiRequestException>(() => library.ListAsync(null, null, null, null, null, default, sort: "random"));
        await Assert.ThrowsAsync<ApiRequestException>(() => library.ListAsync(null, null, null, null, null, default, order: "random"));
    }

    [Theory]
    [InlineData("asc")]
    [InlineData("desc")]
    public async Task Numbered_folders_use_natural_order_across_pages(string order)
    {
        await using var f = await PipelineFixture.CreateAsync();
        await SeedAsync(f);
        var library = new ComicLibrary(f.Database, f.Options);
        var names = new List<string>();
        string? cursor = null;
        do
        {
            var page = await library.FoldersAsync(1, "", cursor, default, order);
            names.AddRange(page.Items.Select(x => x.Name));
            cursor = page.NextCursor;
            Assert.True(names.Count <= 125);
        } while (cursor is not null);
        var expected = Enumerable.Range(1, 125);
        if (order == "desc") expected = expected.Reverse();
        Assert.Equal(expected.Select(n => $"Volume {n}"), names);
    }
    private sealed class Plan { public string Detail { get; set; } = ""; }
}
