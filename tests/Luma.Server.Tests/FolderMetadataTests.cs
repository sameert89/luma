using System.Net;
using System.Net.Http.Json;
using Dapper;
using Luma.Server.Features.Libraries;
using Luma.Server.Features.Media;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Luma.Server.Tests;

public sealed class FolderMetadataTests
{
    [Fact]
    public void Natural_sort_keys_order_numbers_by_value_and_ignore_case_and_accents()
    {
        string[] names = ["Day 10", "day 2", "Day 1", "Émile", "emily", "Zoo", "Trip 007", "Trip 8", "2024", "300"];
        var sorted = names.OrderBy(SearchText.SortKey, StringComparer.Ordinal).ToArray();
        Assert.Equal(["300", "2024", "Day 1", "day 2", "Day 10", "Émile", "emily", "Trip 007", "Trip 8", "Zoo"], sorted);
        Assert.Equal(SearchText.SortKey("Photos"), SearchText.SortKey("PHOTOS"));
        Assert.Equal("", SearchText.FolderName(""));
        Assert.Equal("Beach", SearchText.FolderName("2024/Trips/Beach"));
    }

    [Fact]
    public async Task Folder_keys_follow_inserts_and_renames_and_feed_the_folder_search_index()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await f.ScanAsync();
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("INSERT INTO Folders(Id,LibraryId,ParentId,RelativePath,PathKey) VALUES(50,1,1,'2024/Day 2','2024/day 2')");
        var keys = await db.QuerySingleAsync<(string NameKey, string SortKey)>("SELECT NameKey,SortKey FROM Folders WHERE Id=50");
        Assert.Equal(("DAY 2", SearchText.SortKey("Day 2")), keys);
        Assert.Equal(50, await db.ExecuteScalarAsync<long>("SELECT rowid FROM FolderSearch WHERE FolderSearch MATCH 'NameKey:\"DAY\"'"));
        await db.ExecuteAsync("UPDATE Folders SET RelativePath='2024/Beach' WHERE Id=50");
        Assert.Equal("BEACH", await db.ExecuteScalarAsync<string>("SELECT NameKey FROM Folders WHERE Id=50"));
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM FolderSearch WHERE FolderSearch MATCH 'NameKey:\"DAY\"'"));
        Assert.Equal(50, await db.ExecuteScalarAsync<long>("SELECT rowid FROM FolderSearch WHERE FolderSearch MATCH 'NameKey:\"BEACH\"'"));
    }

    [Fact]
    public async Task Scans_record_each_directory_modified_time()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var older = Path.Combine(f.Root.Path, "older");
        var newer = Path.Combine(f.Root.Path, "newer");
        Directory.CreateDirectory(older);
        Directory.CreateDirectory(newer);
        var time = new DateTime(2020, 5, 1, 12, 0, 0, DateTimeKind.Utc);
        Directory.SetLastWriteTimeUtc(older, time);
        Directory.SetLastWriteTimeUtc(newer, time.AddDays(3));
        await f.ScanAsync();
        await using var db = await f.Database.OpenAsync(default);
        Assert.Equal(time.Ticks, await db.ExecuteScalarAsync<long>("SELECT ModifiedTicks FROM Folders WHERE RelativePath='older'"));
        Assert.Equal(time.AddDays(3).Ticks, await db.ExecuteScalarAsync<long>("SELECT ModifiedTicks FROM Folders WHERE RelativePath='newer'"));
    }

    [Theory]
    [InlineData("asc")]
    [InlineData("desc")]
    public async Task Folders_sort_by_natural_name_and_by_modified_time_across_pages(string direction)
    {
        await using var f = await PipelineFixture.CreateAsync();
        await f.ScanAsync();
        await using (var db = await f.Database.OpenAsync(default))
            await db.ExecuteAsync("""
                INSERT INTO Folders(Id,LibraryId,ParentId,RelativePath,PathKey) VALUES
                  (2,1,1,'Day 10','day 10'),(3,1,1,'Day 2','day 2'),(4,1,1,'Émile','émile'),(5,1,1,'day 1','day 1'),(6,1,1,'Zoo','zoo');
                UPDATE Folders SET ModifiedTicks=CASE Id WHEN 2 THEN 500 WHEN 3 THEN 100 WHEN 4 THEN 300 WHEN 5 THEN 300 WHEN 6 THEN 200 END WHERE Id>1;
                """);
        var signer = new CursorSigner(f.Database);
        await signer.InitializeAsync(default);
        var browser = new LibraryBrowser(f.Database, signer);
        async Task<long[]> AllAsync(string sort)
        {
            var ids = new List<long>();
            string? cursor = null;
            do
            {
                var page = await browser.FoldersAsync(1, null, 2, cursor, default, sort, direction);
                ids.AddRange(page.Items.Select(x => x.Id));
                cursor = page.NextCursor;
            } while (cursor is not null);
            return [.. ids];
        }
        long[] name = [5, 3, 2, 4, 6];
        long[] modified = [3, 6, 4, 5, 2];
        Assert.Equal(direction == "asc" ? name : [.. name.Reverse()], await AllAsync("name"));
        Assert.Equal(direction == "asc" ? modified : [.. modified.Reverse()], await AllAsync("modified"));
        await Assert.ThrowsAsync<Luma.Server.Http.ApiRequestException>(() => browser.FoldersAsync(1, null, 2, null, default, "size", direction));
    }

    [Fact]
    public async Task Folder_sorts_and_folder_suggestions_seek_indexes()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await f.ScanAsync();
        await using var db = await f.Database.OpenAsync(default);
        async Task<string> Plan(string sql, object? parameters = null) =>
            string.Join('\n', (await db.QueryAsync("EXPLAIN QUERY PLAN " + sql, parameters)).Select(row => (string)row.detail));
        var byName = await Plan("SELECT Id FROM Folders f WHERE ParentId=1 AND Hidden=0 AND (f.SortKey,f.Id)>('A',0) ORDER BY f.SortKey,f.Id LIMIT 2");
        Assert.Contains("IX_Folders_Parent_Sort", byName);
        Assert.DoesNotContain("TEMP B-TREE", byName);
        var byTime = await Plan("SELECT Id FROM Folders f WHERE ParentId=1 AND Hidden=0 AND (f.ModifiedTicks,f.Id)<(5,9) ORDER BY f.ModifiedTicks DESC,f.Id DESC LIMIT 2");
        Assert.Contains("IX_Folders_Parent_Modified", byTime);
        Assert.DoesNotContain("TEMP B-TREE", byTime);
        var key = new { key = "BEA", end = "BEA\U0010FFFF", count = 3, fts = "NameKey:\"BEA\"" };
        var prefix = await Plan(SearchSuggestions.FolderPrefixQuery, key);
        Assert.Contains("SEARCH f USING INDEX IX_Folders_Name (NameKey>? AND NameKey<?)", prefix);
        Assert.DoesNotContain("SCAN f", prefix);
        var substring = await Plan(SearchSuggestions.FolderSubstringQuery, key);
        Assert.Contains("VIRTUAL TABLE INDEX", substring);
        Assert.DoesNotContain("SCAN f", substring);
    }

    [Fact]
    public async Task Suggestions_include_folders_with_their_location_but_not_hidden_ones_or_library_roots()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await BrowsingTests.SeedAsync(f, 1);
        await using (var db = await f.Database.OpenAsync(default))
        {
            await db.ExecuteAsync("""
                UPDATE Libraries SET Name='Photos' WHERE Id=1;
                INSERT INTO Folders(Id,LibraryId,ParentId,RelativePath,PathKey) VALUES
                  (20,1,1,'2024','2024'),(21,1,20,'2024/Beach trip','2024/beach trip'),(22,1,1,'Sunny beaches','sunny beaches'),(23,1,1,'Beach private','beach private');
                INSERT INTO FolderAncestry VALUES(20,20),(1,20),(21,21),(20,21),(1,21),(22,22),(1,22),(23,23),(1,23);
                UPDATE Folders SET Hidden=1 WHERE Id=23;
                """);
        }
        var folders = (await SearchSuggestions.SuggestAsync(f.Database, "beach", 8, default)).Where(x => x.Kind == "folder").ToList();
        // Names starting with the text first, then names containing it; the hidden folder is left out.
        Assert.Equal(["Beach trip", "Sunny beaches"], folders.Select(x => x.Label));
        Assert.Equal(("Photos / 2024", 21L, 1L), (folders[0].Detail, folders[0].Id, folders[0].LibraryId));
        Assert.Equal("Photos", folders[1].Detail);
        // The library root's key is empty and never offered, even for a two-letter prefix.
        Assert.DoesNotContain(await SearchSuggestions.SuggestAsync(f.Database, "ph", 8, default), x => x.Kind == "folder");
    }

    [Fact]
    public async Task The_folders_endpoint_accepts_the_modified_sort()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await f.ScanAsync();
        await using var host = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Testing")
            .UseSetting("Luma:DatabasePath", f.Database.Path).UseSetting("Luma:Indexing:CachePath", f.Options.CachePath)
            .UseSetting("Luma:Indexing:Libraries:0:Id", "1").UseSetting("Luma:Indexing:Libraries:0:Name", "Test").UseSetting("Luma:Indexing:Libraries:0:Path", f.Root.Path));
        using var client = host.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/folders?libraryId=1&sort=modified&order=desc")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/folders?libraryId=1&sort=size")).StatusCode);
    }
}
