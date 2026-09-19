using System.Net;
using System.Net.Http.Json;
using Dapper;
using Luma.Server.Features.Indexing;
using Luma.Server.Features.Media;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Luma.Server.Tests;

public sealed class FolderRescanAndSuggestionTests
{
    [Fact]
    public async Task Library_refresh_settings_default_to_watcher_and_validate_updates()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await using var host = Host(f);
        using var client = host.CreateClient();
        var defaults = await client.GetFromJsonAsync<LibraryRefreshSettings>("/api/libraries/1/refresh-settings");
        Assert.Equal(new LibraryRefreshSettings(), defaults);

        var chosen = new LibraryRefreshSettings("periodic", false, 360, 12, 30);
        Assert.Equal(HttpStatusCode.NoContent, (await client.PutAsJsonAsync("/api/libraries/1/refresh-settings", chosen)).StatusCode);
        Assert.Equal(chosen, await client.GetFromJsonAsync<LibraryRefreshSettings>("/api/libraries/1/refresh-settings"));
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/api/libraries/1/refresh-settings", chosen with { WatcherDebounceSeconds = 0 })).StatusCode);
    }

    [Fact]
    public async Task Opening_a_changed_indexed_folder_queues_only_a_shallow_refresh()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await f.ScanAsync();
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "new.jpg"), "not-yet-decodable");
        Directory.SetLastWriteTimeUtc(f.Root.Path, DateTime.UtcNow.AddSeconds(2));
        long root;
        await using (var db = await f.Database.OpenAsync(default))
            root = await db.ExecuteScalarAsync<long>("SELECT Id FROM Folders WHERE ParentId IS NULL");

        await using var host = Host(f);
        using var client = host.CreateClient();
        var response = await client.PostAsync($"/api/folders/{root}/index", null);
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        var scan = (await response.Content.ReadFromJsonAsync<ScanAccepted>())!;
        await AwaitScanAsync(client, scan.Id);

        await using var check = await f.Database.OpenAsync(default);
        Assert.Equal(1, await check.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Media WHERE FileName='new.jpg'"));
        Assert.Equal(0, await check.ExecuteScalarAsync<int>("SELECT Recursive FROM Scans WHERE Id=@Id", scan));
        Assert.Equal(2, await check.ExecuteScalarAsync<int>("SELECT Priority FROM Scans WHERE Id=@Id", scan));
    }

    [Fact]
    public async Task Rescanning_a_folder_covers_everything_beneath_it_and_nothing_else()
    {
        await using var f = await PipelineFixture.CreateAsync();
        foreach (var path in new[] { "top.jpg", "a/one.jpg", "a/b/two.jpg", "c/other.jpg" })
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.Combine(f.Root.Path, path))!);
            await File.WriteAllTextAsync(Path.Combine(f.Root.Path, path), "x");
        }
        await f.ScanAsync();
        File.Delete(Path.Combine(f.Root.Path, "a/b/two.jpg"));
        File.Delete(Path.Combine(f.Root.Path, "c/other.jpg"));
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "a/b/new.jpg"), "x");
        long folder;
        await using (var db = await f.Database.OpenAsync(default))
            folder = await db.ExecuteScalarAsync<long>("SELECT Id FROM Folders WHERE RelativePath='a'");

        await using var host = Host(f);
        using var client = host.CreateClient();
        var response = await client.PostAsJsonAsync($"/api/folders/{folder}/scans", new { metadataMode = "none" });
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        var scan = (await response.Content.ReadFromJsonAsync<ScanAccepted>())!;
        await AwaitScanAsync(client, scan.Id);

        await using var check = await f.Database.OpenAsync(default);
        string? Availability(string name) => check.ExecuteScalar<string>("SELECT Availability FROM Media WHERE FileName=@name", new { name });
        // A nested file appears and a nested deletion is noticed ...
        Assert.Equal("present", Availability("new.jpg"));
        Assert.Equal("missing", Availability("two.jpg"));
        // ... while media outside the folder is left for a library scan to judge.
        Assert.Equal("present", Availability("other.jpg"));
        Assert.Equal("present", Availability("top.jpg"));
    }

    [Fact]
    public async Task Rescanning_a_library_root_folder_is_a_library_scan()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await f.ScanAsync();
        long root;
        await using (var db = await f.Database.OpenAsync(default))
            root = await db.ExecuteScalarAsync<long>("SELECT Id FROM Folders WHERE ParentId IS NULL");
        // Without workers the scan stays queued, so the assertions see its shape rather than its result.
        await using var host = Host(f).WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            foreach (var worker in services.Where(service => service.ServiceType == typeof(IHostedService)).ToArray()) services.Remove(worker);
        }));
        using var client = host.CreateClient();
        var response = await client.PostAsJsonAsync($"/api/folders/{root}/scans", new { metadataMode = "xmp" });
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        var scan = (await response.Content.ReadFromJsonAsync<ScanAccepted>())!;
        await using var check = await f.Database.OpenAsync(default);
        Assert.Null(await check.ExecuteScalarAsync<long?>("SELECT FolderId FROM Scans WHERE Id=@Id", scan));
        Assert.Equal("xmp", await check.ExecuteScalarAsync<string>("SELECT MetadataMode FROM Libraries WHERE Id=1"));
        // A second scan for the same library is refused while one is queued.
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync($"/api/folders/{root}/scans", new { metadataMode = "none" })).StatusCode);
    }

    [Fact]
    public async Task Suggestions_complete_tags_then_file_names_and_say_which_is_which()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await BrowsingTests.SeedAsync(f, 3);
        await using (var db = await f.Database.OpenAsync(default))
            await db.ExecuteAsync("""
                UPDATE Media SET FileName='photo-sunset.jpg',RelativePath='trips/photo-sunset.jpg' WHERE Id=1;
                UPDATE Media SET FileName='beach-photo.jpg',RelativePath='beach-photo.jpg' WHERE Id=2;
                INSERT INTO Tags(Id,Name,NormalizedKey) VALUES(1,'Photography','PHOTOGRAPHY'),(2,'Photos unused','PHOTOS UNUSED');
                INSERT INTO MediaTags(MediaId,TagId) VALUES(1,1);
                """);

        var suggestions = await SearchSuggestions.SuggestAsync(f.Database, "pho", 8, default);
        // Tags come first; a tag that labels nothing is not offered.
        Assert.Equal(("tag", "Photography"), (suggestions[0].Kind, suggestions[0].Label));
        Assert.DoesNotContain(suggestions, x => x.Label == "Photos unused");
        // File names starting with the text, then names containing it, each with its folder.
        var files = suggestions.Where(x => x.Kind == "file").ToList();
        Assert.Equal(["photo-3.jpg", "photo-sunset.jpg", "beach-photo.jpg"], files.Select(x => x.Label));
        Assert.Equal("trips", files.Single(x => x.Label == "photo-sunset.jpg").Detail);

        Assert.Empty(await SearchSuggestions.SuggestAsync(f.Database, "  ", 8, default));
        Assert.Equal(2, (await SearchSuggestions.SuggestAsync(f.Database, "pho", 2, default)).Count);
        await using var host = Host(f);
        using var client = host.CreateClient();
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/search/suggestions?q=a&limit=0")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/search/suggestions?q=pho")).StatusCode);
    }

    [Fact]
    public async Task Suggestions_leave_out_missing_media_and_hidden_folders()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await BrowsingTests.SeedAsync(f, 3);
        await using (var db = await f.Database.OpenAsync(default))
        {
            var hidden = await db.ExecuteScalarAsync<long>("""
                INSERT INTO Folders(LibraryId,ParentId,RelativePath,PathKey,Hidden) VALUES(1,1,'private','private',1) RETURNING Id
                """);
            await db.ExecuteAsync("""
                INSERT INTO FolderAncestry VALUES(@hidden,@hidden),(1,@hidden);
                UPDATE Media SET FolderId=@hidden WHERE Id=1;
                UPDATE Media SET Availability='missing' WHERE Id=2;
                """, new { hidden });
        }
        var labels = (await SearchSuggestions.SuggestAsync(f.Database, "photo", 8, default)).Select(x => x.Label);
        Assert.Equal(["photo-3.jpg"], labels);
    }

    [Fact]
    public async Task Suggestion_queries_seek_indexes_instead_of_scanning_media_or_tags()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await BrowsingTests.SeedAsync(f, 3);
        await using var db = await f.Database.OpenAsync(default);
        async Task<string> Plan(string sql, object parameters) =>
            string.Join('\n', (await db.QueryAsync("EXPLAIN QUERY PLAN " + sql, parameters)).Select(row => (string)row.detail));
        var key = new { key = "PHO", end = "PHO\U0010FFFF", count = 4, remaining = 8, more = 8, fts = "NameKey:\"PHO\"" };
        var tags = await Plan(SearchSuggestions.TagQuery, key);
        Assert.Contains("SEARCH t USING INDEX", tags);
        Assert.DoesNotContain("SCAN t", tags);
        var prefix = await Plan(SearchSuggestions.PrefixQuery, key);
        Assert.Contains("SEARCH m USING INDEX IX_Media_Name (NameKey>? AND NameKey<?)", prefix);
        Assert.DoesNotContain("SCAN m", prefix);
        var substring = await Plan(SearchSuggestions.SubstringQuery, key);
        Assert.Contains("VIRTUAL TABLE INDEX", substring);
        Assert.DoesNotContain("SCAN m", substring);
    }

    private static async Task AwaitScanAsync(HttpClient client, long id)
    {
        for (var attempt = 0; attempt < 200; attempt++)
        {
            var scan = await client.GetFromJsonAsync<ScanProgress>($"/api/scans/{id}");
            if (scan!.State is not ("queued" or "running")) { Assert.Equal("completed", scan.State); return; }
            await Task.Delay(50);
        }
        throw new TimeoutException("The scan did not finish.");
    }

    private static WebApplicationFactory<Program> Host(PipelineFixture f) => new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Testing")
        .UseSetting("Luma:DatabasePath", f.Database.Path).UseSetting("Luma:Indexing:CachePath", f.Options.CachePath)
        .UseSetting("Luma:Indexing:Libraries:0:Id", "1").UseSetting("Luma:Indexing:Libraries:0:Name", "Test").UseSetting("Luma:Indexing:Libraries:0:Path", f.Root.Path));
}
