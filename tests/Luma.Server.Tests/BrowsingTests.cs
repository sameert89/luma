using System.Net;
using System.Net.Http.Json;
using Dapper;
using Luma.Server.Features.Media;
using Luma.Server.Features.Libraries;
using Luma.Server.Features.Tags;
using Luma.Server.Features.Indexing;
using Luma.Server.Http;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Luma.Server.Tests;

public sealed class BrowsingTests
{
    [Fact]
    public async Task Keyword_search_matches_partial_words_across_paths_filenames_and_tags_without_accessing_sources()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await SeedAsync(f, 3);
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("UPDATE Media SET FileName='IMG_01.jpg',RelativePath='Holidays/Beach/IMG_01.jpg' WHERE Id=1");
        var tags = new TagService(f.Database);
        var tag = (await tags.CreateAsync("Family vacation", default)).Tag;
        await tags.BulkAsync(new([1], [tag.Id], []), default);
        Directory.Move(f.Root.Path, f.Root.Path + "-offline");
        var browser = await BrowserAsync(f);
        foreach (var keyword in new[] { "holid", "Beach", "vacat", "IMG_01 holid famil", "FAMIL beach", "01 be", "Holidays/Beach" })
            Assert.Equal(1, Assert.Single((await browser.ListAsync(new MediaQuery { Q = keyword }.Normalize(), default)).Items).Id);
        Assert.Empty((await browser.ListAsync(new MediaQuery { Q = "holid unrelated" }.Normalize(), default)).Items);
        Assert.Empty((await browser.ListAsync(new MediaQuery { Q = "vacat", MediaType = "video" }.Normalize(), default)).Items);
        Assert.Empty((await browser.ListAsync(new MediaQuery { Path = "vacat" }.Normalize(), default)).Items);

        var (predicate, parameters) = new MediaQuery { Q = "holid famil" }.Normalize().Predicate();
        var plan = await db.QueryAsync("EXPLAIN QUERY PLAN SELECT m.Id FROM Media m WHERE " + predicate, parameters);
        var details = string.Join('\n', plan.Select(row => (string)row.detail));
        Assert.Contains("MediaSearch VIRTUAL TABLE INDEX", details);
        Assert.Contains("IX_MediaTags_Tag", details);
    }

    [Fact]
    public async Task Album_covers_use_ready_current_descendants_without_accessing_sources()
    {
        await using var f = await PipelineFixture.CreateAsync();
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "album", "nested"));
        await f.CreateImageAsync("album/nested/image.png");
        await f.ScanAsync();
        var signer = new CursorSigner(f.Database);
        await signer.InitializeAsync(default);
        var browser = new LibraryBrowser(f.Database, signer);
        Assert.Null(Assert.Single(await browser.LibrariesAsync(default)).CoverUrl);
        await f.ProcessAllAsync();
        Directory.Move(f.Root.Path, f.Root.Path + "-offline");
        var library = Assert.Single(await browser.LibrariesAsync(default));
        Assert.NotNull(library.CoverUrl);
        var album = Assert.Single((await browser.FoldersAsync(1, null, 1, null, default)).Items);
        Assert.Equal(library.CoverUrl, album.CoverUrl);
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("UPDATE Media SET SourceRevision=SourceRevision+1");
        Assert.Null(Assert.Single(await browser.LibrariesAsync(default)).CoverUrl);
        Assert.Null(Assert.Single((await browser.FoldersAsync(1, null, 1, null, default)).Items).CoverUrl);
        await db.ExecuteAsync("UPDATE Media SET SourceRevision=SourceRevision-1,Availability='missing'");
        Assert.Null(Assert.Single(await browser.LibrariesAsync(default)).CoverUrl);
    }

    [Fact]
    public async Task Missing_preview_does_not_wait_for_the_database_writer()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await SeedAsync(f, 1);
        using var access = new CacheAccessLog(f.Database);
        using var content = new CacheContent(f.Database, f.Options, access);
        await using var db = await f.Database.OpenAsync(default);
        using var writer = db.BeginTransaction();
        var watch = System.Diagnostics.Stopwatch.StartNew();
        var error = await Assert.ThrowsAsync<ApiRequestException>(() => content.ServeAsync(1, 1, "preview", 1, new Microsoft.AspNetCore.Http.DefaultHttpContext(), default));
        Assert.Contains("preview", error.Message);
        Assert.True(watch.Elapsed < TimeSpan.FromSeconds(1), $"Request waited {watch.Elapsed} for a writer");
    }

    [Fact]
    public async Task Keyset_pages_handle_ties_forward_backward_changed_limits_and_tampering()
    {
        await using var f = await PipelineFixture.CreateAsync(); await SeedAsync(f, 1001);
        var browser = await BrowserAsync(f); var query = new MediaQuery { Limit = 37 }.Normalize();
        var first = await browser.ListAsync(query, default); Assert.Null(first.PreviousCursor);
        var ids = new List<long>(); var page = first;
        do
        {
            ids.AddRange(page.Items.Select(x => x.Id));
            if (page.NextCursor is null) break;
            page = await browser.ListAsync(query with { Cursor = page.NextCursor }, default);
        } while (true);
        Assert.Equal(Enumerable.Range(1, 1001).Select(x => (long)x).Reverse(), ids);
        var backward = await browser.ListAsync(query with { Cursor = page.PreviousCursor }, default);
        Assert.Equal(Enumerable.Range(3, 37).Select(x => (long)x).Reverse(), backward.Items.Select(x => x.Id));
        var changedLimit = await browser.ListAsync(query with { Limit = 10, Cursor = first.NextCursor }, default);
        Assert.Equal(964, changedLimit.Items[0].Id);
        var changedFilter = await Assert.ThrowsAsync<ApiRequestException>(() => browser.ListAsync(new MediaQuery { Q = "photo", Cursor = first.NextCursor }.Normalize(), default));
        Assert.Equal("invalid_cursor", changedFilter.Code);
        var tampered = first.NextCursor![..^8] + "tampered";
        Assert.Equal("invalid_cursor", (await Assert.ThrowsAsync<ApiRequestException>(() => browser.ListAsync(query with { Cursor = tampered }, default))).Code);
    }

    [Fact]
    public async Task Filters_combine_literal_unicode_text_dimensions_dates_preferences_and_tags()
    {
        await using var f = await PipelineFixture.CreateAsync(); await SeedAsync(f, 20);
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("UPDATE Media SET FileName='Café 100%_Photo.JPG',RelativePath='Trips/Café 100%_Photo.JPG',Preference='liked' WHERE Id=2");
        var browser = await BrowserAsync(f);
        var tags = new TagService(f.Database);
        var vacation = (await tags.CreateAsync("Vacation", default)).Tag;
        var family = (await tags.CreateAsync("Family", default)).Tag;
        await tags.BulkAsync(new([2, 4], [vacation.Id], []), default);
        await tags.BulkAsync(new([2], [family.Id], []), default);
        var matches = await browser.ListAsync(new MediaQuery
        {
            Q = "cafe\u0301",
            Path = "trips",
            StartsWith = "CAFÉ",
            EndsWith = ".jpg",
            Extension = ["JPG"],
            Preference = "liked",
            MinWidth = 600,
            Height = 960,
            MinAspectRatio = .6,
            MaxAspectRatio = .7,
            Orientation = "portrait",
            Tag = ["VACATION", "family"],
            DateFrom = "2025-12-31",
            DateTo = "2026-01-02",
            MinSizeBytes = 1024,
            MaxSizeBytes = 3000
        }.Normalize(), default);
        Assert.Equal(2, Assert.Single(matches.Items).Id);
        Assert.Equal(2, Assert.Single((await browser.ListAsync(new MediaQuery { Q = "100%_" }.Normalize(), default)).Items).Id);
        Assert.Empty((await browser.ListAsync(new MediaQuery { Tag = ["unknown"] }.Normalize(), default)).Items);
        Assert.Equal(2, (await browser.ListAsync(new MediaQuery { Tag = ["VACATION", "unknown"], TagMode = "any" }.Normalize(), default)).Items.Count);
        Assert.Equal(18, (await browser.ListAsync(new MediaQuery { Tagged = false }.Normalize(), default)).Items.Count);
        Assert.Equal(4, (await browser.ListAsync(new MediaQuery { MediaType = "video" }.Normalize(), default)).Items.Count);
        Assert.Throws<ApiRequestException>(() => new MediaQuery { Tagged = false, Tag = ["Vacation"] }.Normalize());
        Assert.Throws<ApiRequestException>(() => new MediaQuery { MinSizeBytes = 20, MaxSizeBytes = 10 }.Normalize());
        Assert.Throws<ApiRequestException>(() => new MediaQuery { MinAspectRatio = double.NaN }.Normalize());
    }

    [Fact]
    public async Task Recursive_folder_queries_and_neighbors_keep_the_same_filter()
    {
        await using var f = await PipelineFixture.CreateAsync(); await SeedAsync(f, 10);
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("""
            INSERT INTO Folders(Id,LibraryId,ParentId,RelativePath,PathKey) VALUES(2,1,1,'child','child');
            INSERT INTO FolderAncestry VALUES(1,2),(2,2);
            UPDATE Media SET FolderId=2 WHERE Id<=5;
            """);
        var browser = await BrowserAsync(f);
        Assert.Equal(5, (await browser.ListAsync(new MediaQuery { FolderId = 1 }.Normalize(), default)).Items.Count);
        Assert.Equal(10, (await browser.ListAsync(new MediaQuery { FolderId = 1, Recursive = true }.Normalize(), default)).Items.Count);
        var neighbors = await browser.NeighborsAsync(7, new MediaQuery { MediaType = "image", FolderId = 1 }.Normalize(), default);
        Assert.Equal(8, neighbors.Previous!.Id); Assert.Equal(6, neighbors.Next!.Id);
        await Assert.ThrowsAsync<ApiRequestException>(() => browser.ListAsync(new MediaQuery { LibraryId = 2, FolderId = 1 }.Normalize(), default));
    }

    [Fact]
    public async Task Media_of_a_library_removed_from_configuration_drops_out_of_unscoped_queries()
    {
        await using var f = await PipelineFixture.CreateAsync(); await f.CreateImageAsync("image.png"); await f.ScanAsync();
        await using var host = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Testing")
            .UseSetting("Luma:DatabasePath", f.Database.Path).UseSetting("Luma:Indexing:CachePath", f.Options.CachePath));
        using var client = host.CreateClient();
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("UPDATE Libraries SET Enabled=1");
        Assert.Single((await client.GetFromJsonAsync<MediaPage>("/api/media"))!.Items);
        await db.ExecuteAsync("UPDATE Libraries SET Enabled=0");
        Assert.Empty((await client.GetFromJsonAsync<MediaPage>("/api/media"))!.Items);
    }

    [Fact]
    public async Task Browsing_and_cache_work_with_sources_absent_and_missing_cache_only_queues_work()
    {
        await using var f = await PipelineFixture.CreateAsync(); await f.CreateImageAsync("image.png"); await f.ScanAsync(); await f.RequestPreviewsAsync(); await f.ProcessAllAsync();
        await using var host = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Testing")
            .UseSetting("Luma:DatabasePath", f.Database.Path).UseSetting("Luma:Indexing:CachePath", f.Options.CachePath));
        using var client = host.CreateClient();
        Directory.Move(f.Root.Path, f.Root.Path + "-offline");
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("UPDATE Libraries SET Enabled=1,Availability='unavailable'");
        var libraries = await client.GetAsync("/api/libraries"); Assert.Equal(HttpStatusCode.OK, libraries.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/folders?libraryId=1")).StatusCode);
        var page = await client.GetFromJsonAsync<MediaPage>("/api/media"); var media = Assert.Single(page!.Items);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/api/media/{media.Id}")).StatusCode);
        var content = await client.GetAsync(media.Preview.Url); Assert.Equal(HttpStatusCode.OK, content.StatusCode);
        Assert.Equal("image/jpeg", content.Content.Headers.ContentType?.MediaType); Assert.Contains("immutable", content.Headers.CacheControl!.ToString());
        using var conditional = new HttpRequestMessage(HttpMethod.Get, media.Preview.Url); conditional.Headers.IfNoneMatch.Add(content.Headers.ETag!);
        Assert.Equal(HttpStatusCode.NotModified, (await client.SendAsync(conditional)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/media/{media.Id}/cache/99/preview?v=1")).StatusCode);
        var path = await db.ExecuteScalarAsync<string>("SELECT RelativePath FROM CacheEntries WHERE Variant='preview'");
        await File.WriteAllTextAsync(Path.Combine(f.Options.CachePath, path!), "corrupt");
        var missing = await client.GetAsync(media.Preview.Url); Assert.Equal(HttpStatusCode.ServiceUnavailable, missing.StatusCode);
        Assert.Contains("cache_unavailable", await missing.Content.ReadAsStringAsync()); Assert.NotNull(missing.Headers.RetryAfter);
        await client.GetAsync(media.Preview.Url);
        for (var attempt = 0; attempt < 100 && await db.ExecuteScalarAsync<string>("SELECT State FROM ProcessingJobs") != "pending"; attempt++)
            await Task.Delay(20);
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM ProcessingJobs"));
        Assert.Equal("pending", await db.ExecuteScalarAsync<string>("SELECT State FROM ProcessingJobs"));
        var tag = await client.PostAsJsonAsync("/api/tags", new CreateTagRequest("Offline editing")); Assert.Equal(HttpStatusCode.Created, tag.StatusCode);
        var created = await tag.Content.ReadFromJsonAsync<TagSummary>();
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsJsonAsync("/api/media/tags", new BulkTagsRequest([media.Id], [created!.Id], []))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.PutAsJsonAsync($"/api/media/{media.Id}/preference", new PreferenceRequest("liked"))).StatusCode);
        Assert.Equal(media.Id, Assert.Single((await client.GetFromJsonAsync<MediaPage>("/api/media?tag=offline%20editing&preference=liked"))!.Items).Id);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/media?unknown=1")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/media?limit=0")).StatusCode);
    }

    [Fact]
    public async Task Visible_media_priority_wakes_waiting_processing_without_touching_sources()
    {
        await using var f = await PipelineFixture.CreateAsync(); await SeedAsync(f, 3);
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("""
            INSERT INTO ProcessingJobs(MediaId,SourceRevision,EncoderVersion,ScanId,MediaType,State,NextAttemptAt)
            VALUES(1,1,@version,1,'image','waiting','2100-01-01T00:00:00.0000000Z');
            """, new { version = IndexingOptions.EncoderVersion });
        var browser = await BrowserAsync(f);
        await browser.PrioritizeAsync(new MediaPriorityRequest([1]), default);
        Assert.Equal("pending", await db.ExecuteScalarAsync<string>("SELECT State FROM ProcessingJobs WHERE MediaId=1"));
        var next = DateTimeOffset.Parse((await db.ExecuteScalarAsync<string>("SELECT NextAttemptAt FROM ProcessingJobs WHERE MediaId=1"))!);
        Assert.True(next < DateTimeOffset.UtcNow, $"NextAttemptAt was {next:O}");
    }

    [Fact]
    public async Task Visible_media_priority_prepares_in_the_requested_order()
    {
        await using var f = await PipelineFixture.CreateAsync(); await SeedAsync(f, 20);
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("""
            WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20)
            INSERT INTO ProcessingJobs(MediaId,SourceRevision,EncoderVersion,ScanId,MediaType,State,NextAttemptAt)
            SELECT x,1,@version,1,'image','pending','2026-01-01T00:00:00.0000000Z' FROM n;
            """, new { version = IndexingOptions.EncoderVersion });
        var requested = new long[] { 14, 3, 20, 7, 11 };
        await (await BrowserAsync(f)).PrioritizeAsync(new MediaPriorityRequest(requested), default);
        // The worker claims the earliest NextAttemptAt, then the lowest media ID.
        var queue = (await db.QueryAsync<long>("""
            SELECT MediaId FROM ProcessingJobs WHERE State='pending' ORDER BY NextAttemptAt,MediaId LIMIT 5
            """)).ToArray();
        Assert.Equal(requested, queue);
    }

    [Fact]
    public async Task Opening_media_moves_it_ahead_of_an_older_gallery_priority_batch()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await SeedAsync(f, 3);
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("""
            INSERT INTO ProcessingJobs(MediaId,SourceRevision,EncoderVersion,ScanId,MediaType,State,NextAttemptAt)
            SELECT Id,SourceRevision,@version,1,MediaType,'pending',@now FROM Media;
            """, new { version = IndexingOptions.EncoderVersion, now = DateTimeOffset.UtcNow.ToString("O") });
        var browser = await BrowserAsync(f);
        await browser.PrioritizeAsync(new MediaPriorityRequest([1, 2, 3]), default);
        await Task.Delay(5);
        await browser.PrioritizeAsync(new MediaPriorityRequest([3]), default);
        Assert.Equal(new long[] { 3, 1, 2 }, (await db.QueryAsync<long>(
            "SELECT MediaId FROM ProcessingJobs ORDER BY NextAttemptAt,MediaId")).ToArray());
    }

    [Fact]
    public async Task Visible_media_priority_adopts_media_left_by_a_cancelled_scan()
    {
        await using var f = await PipelineFixture.CreateAsync(); await SeedAsync(f, 3);
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("""
            INSERT INTO Scans(Id,LibraryId,FolderId,State,StartedAt,FinishedAt) VALUES(9,1,1,'cancelled',@now,@now);
            INSERT INTO ProcessingJobs(MediaId,SourceRevision,EncoderVersion,ScanId,MediaType,State,NextAttemptAt)
            VALUES(1,1,@version,9,'image','waiting','2100-01-01T00:00:00.0000000Z');
            """, new { version = IndexingOptions.EncoderVersion, now = DateTimeOffset.UtcNow.ToString("O") });
        var browser = await BrowserAsync(f);
        await browser.PrioritizeAsync(new MediaPriorityRequest([1]), default);
        Assert.Equal("pending", await db.ExecuteScalarAsync<string>("SELECT State FROM ProcessingJobs WHERE MediaId=1"));
        var claimed = await f.ClaimAsync();
        Assert.Equal(1, claimed?.MediaId);
        // Without a scan that can run the work there is nothing to adopt, and the job stays put.
        await db.ExecuteAsync("UPDATE Scans SET State='cancelled'; UPDATE ProcessingJobs SET State='waiting',ScanId=9,Claim=NULL WHERE MediaId=1");
        await browser.PrioritizeAsync(new MediaPriorityRequest([1]), default);
        Assert.Equal("waiting", await db.ExecuteScalarAsync<string>("SELECT State FROM ProcessingJobs WHERE MediaId=1"));
        Assert.Equal(9, await db.ExecuteScalarAsync<long>("SELECT ScanId FROM ProcessingJobs WHERE MediaId=1"));
    }

    [Fact]
    public async Task Unicode_tag_identity_and_bulk_limits_are_atomic_and_idempotent()
    {
        await using var f = await PipelineFixture.CreateAsync(); await SeedAsync(f, 500); var service = new TagService(f.Database);
        var first = await service.CreateAsync("  Café  ", default); var second = await service.CreateAsync("CAFE\u0301", default);
        Assert.Equal(first.Tag.Id, second.Tag.Id); Assert.Equal("Café", second.Tag.Name); Assert.False(second.Created);
        Assert.Equal((await service.CreateAsync("i", default)).Tag.Id, (await service.CreateAsync("I", default)).Tag.Id);
        Assert.NotEqual((await service.CreateAsync("İ", default)).Tag.Id, (await service.CreateAsync("i", default)).Tag.Id);
        Assert.NotEqual((await service.CreateAsync("ß", default)).Tag.Id, (await service.CreateAsync("ss", default)).Tag.Id);
        Assert.Throws<ApiRequestException>(() => TagText.Normalize("\n")); Assert.Throws<ApiRequestException>(() => TagText.Normalize(new string('a', 101)));
        var all = Enumerable.Range(1, 500).Select(x => (long)x).ToArray();
        await service.BulkAsync(new(all, [first.Tag.Id], []), default); await service.BulkAsync(new(all, [first.Tag.Id], []), default);
        await using var db = await f.Database.OpenAsync(default); Assert.Equal(500, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM MediaTags"));
        await Assert.ThrowsAsync<ApiRequestException>(() => service.BulkAsync(new([1, 9999], [], [first.Tag.Id]), default));
        Assert.Equal(500, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM MediaTags"));
        var ids = new List<long>(); for (var i = 0; i < 100; i++) ids.Add((await service.CreateAsync($"tag-{i}", default)).Tag.Id);
        await service.BulkAsync(new([1], ids.Take(50).ToArray(), []), default); await service.BulkAsync(new([1], ids.Skip(50).Take(49).ToArray(), []), default);
        Assert.Equal(100, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM MediaTags WHERE MediaId=1"));
        await Assert.ThrowsAsync<ApiRequestException>(() => service.BulkAsync(new([1, 2], [ids[^1]], []), default));
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM MediaTags WHERE TagId=@id", new { id = ids[^1] }));
    }

    [Fact]
    public async Task Renaming_a_tag_fixes_its_spelling_or_merges_into_an_existing_one()
    {
        await using var f = await PipelineFixture.CreateAsync(); await SeedAsync(f, 3); var service = new TagService(f.Database);
        var typo = (await service.CreateAsync("Vacaton", default)).Tag;
        var renamed = await service.RenameAsync(typo.Id, "Vacation", default);
        Assert.Equal(typo.Id, renamed.Id); Assert.Equal("Vacation", renamed.Name);
        await Assert.ThrowsAsync<ApiRequestException>(() => service.RenameAsync(typo.Id, "\n", default));
        await Assert.ThrowsAsync<ApiRequestException>(() => service.RenameAsync(99999, "Anything", default));

        // Renaming into an existing tag's spelling merges the two instead of colliding.
        var family = (await service.CreateAsync("Family", default)).Tag;
        await service.BulkAsync(new([1, 2], [renamed.Id], []), default);
        await service.BulkAsync(new([2, 3], [family.Id], []), default);
        var merged = await service.RenameAsync(renamed.Id, "family", default);
        Assert.Equal(family.Id, merged.Id); Assert.Equal("Family", merged.Name);
        await using var db = await f.Database.OpenAsync(default);
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Tags WHERE Id=@id", new { id = renamed.Id }));
        Assert.Equal([1L, 2L, 3L], await db.QueryAsync<long>("SELECT MediaId FROM MediaTags WHERE TagId=@id ORDER BY MediaId", new { id = family.Id }));
    }

    [Fact]
    public async Task Deleting_a_tag_removes_it_and_every_assignment()
    {
        await using var f = await PipelineFixture.CreateAsync(); await SeedAsync(f, 2); var service = new TagService(f.Database);
        var tag = (await service.CreateAsync("Temporary", default)).Tag;
        await service.BulkAsync(new([1, 2], [tag.Id], []), default);
        await service.DeleteAsync(tag.Id, default);
        await using var db = await f.Database.OpenAsync(default);
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Tags WHERE Id=@id", new { id = tag.Id }));
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM MediaTags WHERE TagId=@id", new { id = tag.Id }));
        await Assert.ThrowsAsync<ApiRequestException>(() => service.DeleteAsync(tag.Id, default));
    }

    internal static async Task<MediaBrowser> BrowserAsync(PipelineFixture f)
    { var signer = new CursorSigner(f.Database); await signer.InitializeAsync(default); return new(f.Database, signer); }
    internal static async Task SeedAsync(PipelineFixture f, int count)
    {
        await f.ScanAsync(); await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("""
            WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<@count)
            INSERT INTO Media(Id,LibraryId,FolderId,RelativePath,PathKey,FileName,MediaType,MimeType,Extension,SizeBytes,ModifiedAt,IndexedAt,EffectiveDate,LastSeenScanId,Width,Height)
            SELECT x,1,1,'photo-'||x||'.jpg','photo-'||x||'.jpg','photo-'||x||'.jpg',CASE WHEN x%5=0 THEN 'video' ELSE 'image' END,'image/jpeg','.jpg',x*1024,
              '2026-01-01T00:00:00.0000000Z','2026-01-01T00:00:00.0000000Z','2026-01-01T00:00:00.0000000Z',1,640,960 FROM n
            """, new { count });
    }
}
