using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using SixLabors.ImageSharp;
using Dapper;
using Luma.Server.Features.Libraries;
using Luma.Server.Features.Media;
using Luma.Server.Features.Tags;
using Luma.Server.Http;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Luma.Server.Tests;

public sealed class Gate7Tests
{
    [Fact]
    public async Task Name_cursors_support_full_length_unicode_filenames()
    {
        await using var f = await PipelineFixture.CreateAsync(); await BrowsingTests.SeedAsync(f, 2);
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("UPDATE Media SET FileName=@name", new { name = new string('写', 251) + ".jpg" });
        var browser = await BrowsingTests.BrowserAsync(f);
        var query = new MediaQuery { Sort = "name", Limit = 1 }.Normalize();
        var first = await browser.ListAsync(query, default);
        Assert.True(first.NextCursor!.Length > 2048);
        var next = await browser.ListAsync(query with { Cursor = first.NextCursor }, default);
        Assert.Equal(2, Assert.Single(first.Items).Id); Assert.Equal(1, Assert.Single(next.Items).Id);
    }
    [Theory]
    [InlineData("modified")]
    [InlineData("captured")]
    [InlineData("name")]
    [InlineData("type")]
    [InlineData("size")]
    [InlineData("shuffle")]
    public async Task Every_sort_traverses_grouped_filtered_ties_in_both_directions_and_neighbors(string sort)
    {
        await using var f = await PipelineFixture.CreateAsync();
        await BrowsingTests.SeedAsync(f, 91);
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("UPDATE Media SET SizeBytes=(Id%7)*1024,FileName='name-'||(Id%9)||'.jpg',EffectiveDate='2026-01-'||printf('%02d',1+Id%3)||'T00:00:00.0000000Z',RandomKey=Id*100000000000000000");
        var browser = await BrowsingTests.BrowserAsync(f);
        foreach (var group in new[] { "none", "folder", "date", "type" }) foreach (var order in new[] { "asc", "desc" }) foreach (var mediaType in new string?[] { null, "image" })
        {
            var query = new MediaQuery { Limit = 7, Sort = sort, Order = order, GroupBy = group, Seed = "release-fixture", MediaType = mediaType }.Normalize();
            var all = await browser.ListAsync(query with { Limit = 200 }, default);
            var ids = new List<long>(); var page = await browser.ListAsync(query, default);
            while (true)
            {
                ids.AddRange(page.Items.Select(x => x.Id));
                if (page.NextCursor is null) break;
                var next = await browser.ListAsync(query with { Cursor = page.NextCursor }, default);
                var previous = await browser.ListAsync(query with { Cursor = next.PreviousCursor }, default);
                Assert.Equal(page.Items.Select(x => x.Id), previous.Items.Select(x => x.Id));
                page = next;
            }
            Assert.Equal(mediaType is null ? 91 : 73, ids.Count); Assert.Equal(ids.Count, ids.Distinct().Count());
            Assert.Equal(all.Items.Select(x => x.Id), ids);
            for (var i = 1; i < ids.Count - 1; i += 17)
            {
                var neighbors = await browser.NeighborsAsync(ids[i], query, default);
                Assert.Equal(ids[i - 1], neighbors.Previous!.Id); Assert.Equal(ids[i + 1], neighbors.Next!.Id);
            }
            if (sort == "shuffle") Assert.Equal(ids, (await browser.ListAsync(query with { Limit = 200 }, default)).Items.Select(x => x.Id));
            else
            {
                var direction = order == "asc" ? "ASC" : "DESC";
                var key = sort switch { "captured" => "EffectiveTicks", "name" => "NameKey", "type" => "MediaType", "size" => "SizeBytes", _ => "ModifiedTicks" };
                var groupKey = group switch { "folder" => "FolderId ASC,", "date" => "EffectiveTicks/864000000000 ASC,", "type" => "CASE MediaType WHEN 'image' THEN 0 ELSE 1 END ASC,", _ => "" };
                var expected = await db.QueryAsync<long>($"SELECT Id FROM Media WHERE @mediaType IS NULL OR MediaType=@mediaType ORDER BY {groupKey}{key} {direction},Id {direction}", new { mediaType });
                Assert.Equal(expected, ids);
            }
        }
    }

    [Fact]
    public async Task Tag_grouping_pages_tags_in_name_order_and_lists_an_item_under_each_of_its_tags()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await BrowsingTests.SeedAsync(f, 6);
        // Created out of alphabetical order: the groups follow the tag name, not the tag ID.
        var tags = new TagService(f.Database);
        var sunset = (await tags.CreateAsync("Sunset", default)).Tag;
        var alps = (await tags.CreateAsync("Alps", default)).Tag;
        var beach = (await tags.CreateAsync("Beach", default)).Tag;
        await tags.BulkAsync(new([1, 2], [beach.Id], []), default);
        await tags.BulkAsync(new([2, 3], [sunset.Id], []), default);
        await tags.BulkAsync(new([4], [alps.Id], []), default);
        var browser = await BrowsingTests.BrowserAsync(f);
        var query = new MediaQuery { Limit = 2, GroupBy = "tag" }.Normalize();
        // Ties on the modified sort fall back to ID descending; 5 and 6 carry no tag and no group.
        var expected = new[] { "Alps 4", "Beach 2", "Beach 1", "Sunset 3", "Sunset 2" };
        var listed = new List<string>();
        var page = await browser.ListAsync(query, default);
        Assert.Equal($"tag:{alps.Id}", page.Items[0].GroupKey);
        while (true)
        {
            listed.AddRange(page.Items.Select(x => $"{x.GroupLabel} {x.Id}"));
            if (page.NextCursor is null) break;
            var next = await browser.ListAsync(query with { Cursor = page.NextCursor }, default);
            var previous = await browser.ListAsync(query with { Cursor = next.PreviousCursor }, default);
            Assert.Equal(page.Items.Select(x => x.Id), previous.Items.Select(x => x.Id));
            page = next;
        }
        Assert.Equal(expected, listed);
        // The viewer follows the first of an item's tags, so its neighbors are that group's.
        var neighbors = await browser.NeighborsAsync(2, query, default);
        Assert.Equal(4, neighbors.Previous!.Id); Assert.Equal(1, neighbors.Next!.Id);
        Assert.Null((await browser.NeighborsAsync(5, query, default)).Next);
        // Shuffle rotates within each group and still traverses every group exactly once.
        var shuffle = new MediaQuery { Limit = 2, GroupBy = "tag", Sort = "shuffle", Seed = "release-fixture" }.Normalize();
        var all = await browser.ListAsync(shuffle with { Limit = 50 }, default);
        var shuffled = new List<string>();
        page = await browser.ListAsync(shuffle, default);
        while (true)
        {
            shuffled.AddRange(page.Items.Select(x => $"{x.GroupLabel} {x.Id}"));
            if (page.NextCursor is null) break;
            page = await browser.ListAsync(shuffle with { Cursor = page.NextCursor }, default);
        }
        Assert.Equal(all.Items.Select(x => $"{x.GroupLabel} {x.Id}"), shuffled);
        Assert.Equal(expected.Order(StringComparer.Ordinal), shuffled.Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task Cover_candidates_are_automatic_until_overridden_and_reset_returns_to_them()
    {
        await using var f = await PipelineFixture.CreateAsync();
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "album"));
        for (var i = 0; i < 6; i++) await f.CreateImageAsync(Path.Combine("album", $"{i}.png"));
        await f.ScanAsync(); await f.ProcessAllAsync();
        var signer = new CursorSigner(f.Database); await signer.InitializeAsync(default);
        var browser = new LibraryBrowser(f.Database, signer);
        await using var db = await f.Database.OpenAsync(default);
        var album = Assert.Single((await browser.FoldersAsync(1, null, 10, null, default)).Items);
        // Automatic: up to five candidates with their thumbnail dimensions, newest first.
        Assert.False(album.CoverOverride);
        Assert.Equal(5, album.CoverImages!.Count);
        Assert.All(album.CoverImages, image => Assert.Equal((128, 96), (image.Width, image.Height)));
        Assert.Equal(album.CoverUrl, album.CoverImages[0].Url);
        Assert.Equal(5, Assert.Single(await browser.LibrariesAsync(default)).CoverImages!.Count);
        // A manual cover is the folder's only cover image, and is flagged as an override.
        var chosen = await db.ExecuteScalarAsync<long>("SELECT MIN(Id) FROM Media");
        await browser.SetCoverAsync(album.Id, chosen, default);
        album = Assert.Single((await browser.FoldersAsync(1, null, 10, null, default)).Items);
        Assert.True(album.CoverOverride);
        Assert.Contains($"/media/{chosen}/", Assert.Single(album.CoverImages!).Url);
        Assert.False(Assert.Single(await browser.LibrariesAsync(default)).CoverOverride);
        Assert.True((await browser.FoldersAsync(null, album.Id, 10, null, default)).Current.CoverOverride);
        // Reset returns to automatic selection; the media are untouched.
        var files = Directory.GetFiles(Path.Combine(f.Root.Path, "album")).ToDictionary(x => x, File.ReadAllBytes);
        await browser.SetCoverAsync(album.Id, null, default);
        album = Assert.Single((await browser.FoldersAsync(1, null, 10, null, default)).Items);
        Assert.False(album.CoverOverride);
        Assert.Equal(5, album.CoverImages!.Count);
        foreach (var file in files) Assert.Equal(file.Value, await File.ReadAllBytesAsync(file.Key));
    }

    [Fact]
    public async Task Custom_covers_persist_validate_reset_and_fall_back_when_stale_without_sources()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await f.CreateImageAsync("one.png"); await f.CreateImageAsync("two.png"); await f.ScanAsync(); await f.ProcessAllAsync();
        var signer = new CursorSigner(f.Database); await signer.InitializeAsync(default);
        var browser = new LibraryBrowser(f.Database, signer);
        await using var db = await f.Database.OpenAsync(default);
        var ids = (await db.QueryAsync<long>("SELECT Id FROM Media ORDER BY Id")).ToArray();
        await browser.SetCoverAsync(1, ids[0], default);
        Directory.Move(f.Root.Path, f.Root.Path + "-offline");
        Assert.Contains($"/media/{ids[0]}/", Assert.Single(await browser.LibrariesAsync(default)).CoverUrl);
        Assert.Equal(ids[0], await db.ExecuteScalarAsync<long>("SELECT CoverMediaId FROM Folders WHERE Id=1"));
        await Assert.ThrowsAsync<ApiRequestException>(() => browser.SetCoverAsync(1, 99999, default));
        await db.ExecuteAsync("UPDATE Media SET Availability='missing' WHERE Id=@id", new { id = ids[0] });
        Assert.Contains($"/media/{ids[1]}/", Assert.Single(await browser.LibrariesAsync(default)).CoverUrl);
        await browser.SetCoverAsync(1, null, default);
        Assert.Null(await db.ExecuteScalarAsync<long?>("SELECT CoverMediaId FROM Folders WHERE Id=1"));
    }

    [Fact]
    public async Task Random_returns_filtered_cached_content_without_sources_and_has_explicit_empty_errors()
    {
        await using var f = await PipelineFixture.CreateAsync(); await f.CreateImageAsync("one.png"); await f.ScanAsync(); await f.RequestPreviewsAsync(); await f.ProcessAllAsync();
        await using var host = Host(f); using var client = host.CreateClient();
        Directory.Move(f.Root.Path, f.Root.Path + "-offline");
        await using var db = await f.Database.OpenAsync(default); await db.ExecuteAsync("UPDATE Libraries SET Enabled=1");
        var response = await client.GetAsync("/api/random?mediaType=image&libraryId=1");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode); Assert.Equal("image/jpeg", response.Content.Headers.ContentType!.MediaType);
        Assert.Equal("no-store", response.Headers.CacheControl!.ToString());
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/random?mediaType=video")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/random?q=absent")).StatusCode);
        await db.ExecuteAsync("UPDATE CacheEntries SET State='evicted' WHERE Variant='preview'");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.GetAsync("/api/random")).StatusCode);
    }

    [Fact]
    public async Task Metadata_import_unions_normalized_tags_idempotently_and_exports_snapshot_paths_and_xmp()
    {
        await using var f = await PipelineFixture.CreateAsync(); await f.CreateImageAsync("one.png"); await f.ScanAsync();
        using (var image = SixLabors.ImageSharp.Image.Load(Path.Combine(f.Root.Path, "one.png")))
        {
            image.Metadata.ExifProfile = new SixLabors.ImageSharp.Metadata.Profiles.Exif.ExifProfile();
            image.Metadata.ExifProfile.SetValue(SixLabors.ImageSharp.Metadata.Profiles.Exif.ExifTag.XPKeywords, "EXIFembedded;CAFE\u0301");
            image.Metadata.XmpProfile = new SixLabors.ImageSharp.Metadata.Profiles.Xmp.XmpProfile(MetadataKeywords.WriteXmp(["XMPembedded", "Café"]));
            image.Save(Path.Combine(f.Root.Path, "one.png"));
        }
        await File.WriteAllBytesAsync(Path.Combine(f.Root.Path, "one.png.xmp"), MetadataKeywords.WriteXmp(["Café", "CAFE\u0301", "A & B"]));
        await using var host = Host(f); using var client = host.CreateClient();
        await using var db = await f.Database.OpenAsync(default); await db.ExecuteAsync("UPDATE Libraries SET Enabled=1");
        var tag = (await new TagService(f.Database).CreateAsync("existing", default)).Tag;
        await new TagService(f.Database).BulkAsync(new([1], [tag.Id], []), default);
        for (var retry = 0; retry < 2; retry++)
        {
            var accepted = await client.PostAsJsonAsync("/api/imports/tags", new MetadataJobRequest([1], IncludeSidecars: true));
            Assert.Equal(HttpStatusCode.Accepted, accepted.StatusCode);
            var job = await AwaitJobAsync(client, (await accepted.Content.ReadFromJsonAsync<JobAccepted>())!.Id);
            Assert.Equal("completed", job.State); Assert.Equal(0, job.Failed);
        }
        Assert.Equal(5, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM MediaTags"));
        var export = await client.PostAsJsonAsync("/api/exports/xmp", new MetadataJobRequest([1]));
        var exported = await AwaitJobAsync(client, (await export.Content.ReadFromJsonAsync<JobAccepted>())!.Id);
        Assert.Equal("completed", exported.State); Assert.NotNull(exported.SnapshotAt);
        await new TagService(f.Database).BulkAsync(new([1], [], [tag.Id]), default);
        using var archive = new ZipArchive(new MemoryStream(await client.GetByteArrayAsync(exported.ContentUrl)));
        using var xmp = new MemoryStream(); await archive.GetEntry("1.xmp")!.Open().CopyToAsync(xmp);
        Assert.Equal(new[] { "A & B", "Café", "EXIFembedded", "existing", "XMPembedded" }, MetadataKeywords.ReadXmp(xmp.ToArray()));
        using var manifest = new StreamReader(archive.GetEntry("paths.jsonl")!.Open());
        Assert.Contains("one.png", await manifest.ReadToEndAsync()); Assert.NotNull(archive.GetEntry("MERGE-INSTRUCTIONS.txt"));
        await db.ExecuteAsync("UPDATE Media SET Preference='disliked',Availability='missing'");
        Directory.Move(f.Root.Path, f.Root.Path + "-offline");
        var dislikes = await client.PostAsJsonAsync("/api/exports/dislikes", new MetadataJobRequest());
        var disliked = await AwaitJobAsync(client, (await dislikes.Content.ReadFromJsonAsync<JobAccepted>())!.Id);
        Assert.Equal("completed", disliked.State);
        var json = await client.GetStringAsync(disliked.ContentUrl);
        Assert.Contains("missing", json);
        using var record = System.Text.Json.JsonDocument.Parse(json);
        Assert.Equal(Path.Combine(f.Root.Path, "one.png"), record.RootElement.GetProperty("path").GetString());
    }

    [Fact]
    public void Xmp_handles_escaping_and_rejects_external_entities()
    {
        Assert.Equal(new[] { "< & >", "Café" }, MetadataKeywords.ReadXmp(MetadataKeywords.WriteXmp(["< & >", "Café"])));
        Assert.Throws<System.Xml.XmlException>(() => MetadataKeywords.ReadXmp(Encoding.UTF8.GetBytes("<!DOCTYPE x [<!ENTITY e SYSTEM 'file:///etc/passwd'>]><x>&e;</x>")));
    }

    [Fact]
    public async Task Embedded_xmp_packet_is_found_near_either_end_of_a_container_regardless_of_format()
    {
        var directory = Path.Combine(Path.GetTempPath(), "luma-xmp-scan", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var packet = "<?xpacket begin=\"\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>" + Encoding.UTF8.GetString(MetadataKeywords.WriteXmp(["Wildlife", "Café"])) + "<?xpacket end=\"w\"?>";
        var packetBytes = Encoding.UTF8.GetBytes(packet);
        var junk = new byte[1024]; Random.Shared.NextBytes(junk);

        var front = Path.Combine(directory, "front.mp4");
        await File.WriteAllBytesAsync(front, [.. packetBytes, .. junk]);
        Assert.Equal(new[] { "Wildlife", "Café" }, await MetadataKeywords.ReadEmbeddedXmpPacketAsync(front, default));

        // A packet only reachable in a bounded tail scan, past a head window full of junk.
        var back = Path.Combine(directory, "back.mp4");
        var padding = new byte[10 * 1024 * 1024]; Random.Shared.NextBytes(padding);
        await File.WriteAllBytesAsync(back, [.. padding, .. packetBytes]);
        Assert.Equal(new[] { "Wildlife", "Café" }, await MetadataKeywords.ReadEmbeddedXmpPacketAsync(back, default));

        var none = Path.Combine(directory, "none.mp4");
        await File.WriteAllBytesAsync(none, junk);
        Assert.Empty(await MetadataKeywords.ReadEmbeddedXmpPacketAsync(none, default));
        Directory.Delete(directory, true);
    }

    [Fact]
    public async Task Folder_import_reads_all_direct_media_and_sidecars_without_importing_other_folders()
    {
        await using var f = await PipelineFixture.CreateAsync();
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "album", "nested"));
        foreach (var path in new[] { "album/one.png", "album/two.png", "album/nested/other.png", "outside.png" })
        {
            await f.CreateImageAsync(path);
            await File.WriteAllBytesAsync(Path.Combine(f.Root.Path, path + ".xmp"), MetadataKeywords.WriteXmp(["Imported"]));
        }
        await f.ScanAsync();
        await using var db = await f.Database.OpenAsync(default);
        var folderId = await db.ExecuteScalarAsync<long>("SELECT Id FROM Folders WHERE RelativePath='album'");
        await using var host = Host(f);
        using var client = host.CreateClient();
        var accepted = await client.PostAsJsonAsync("/api/imports/tags", new MetadataJobRequest(
            Query: new MediaQuery { LibraryId = 1, FolderId = folderId }, IncludeSidecars: true));
        Assert.Equal(HttpStatusCode.Accepted, accepted.StatusCode);
        var job = await AwaitJobAsync(client, (await accepted.Content.ReadFromJsonAsync<JobAccepted>())!.Id);
        Assert.Equal("completed", job.State);
        Assert.Equal(2, job.Processed);
        Assert.Equal(0, job.Failed);
        Assert.Equal(2, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM MediaTags mt JOIN Media m ON m.Id=mt.MediaId WHERE m.FolderId=@folderId", new { folderId }));
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM MediaTags mt JOIN Media m ON m.Id=mt.MediaId WHERE m.FolderId<>@folderId", new { folderId }));
    }

    [Fact]
    public async Task Import_without_a_selection_walks_every_matching_item_and_reads_embedded_video_xmp()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await f.CreateImageAsync("one.png");
        var clipPath = Path.Combine(f.Root.Path, "clip.mp4");
        await Luma.Server.MediaProcessing.MediaProcessor.RunAsync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=128x96:r=4", "-t", "1", "-c:v", "mpeg4", "-threads", "1", clipPath], default);
        // ffprobe reads the structured atoms at the front and ignores trailing bytes it
        // does not recognise, so appending a raw XMP packet does not disturb probing.
        var videoPacket = "<?xpacket begin=\"\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>" + Encoding.UTF8.GetString(MetadataKeywords.WriteXmp(["Wildlife"])) + "<?xpacket end=\"w\"?>";
        await File.AppendAllTextAsync(clipPath, videoPacket);
        await f.ScanAsync();
        await using var host = Host(f); using var client = host.CreateClient();
        await using var db = await f.Database.OpenAsync(default); await db.ExecuteAsync("UPDATE Libraries SET Enabled=1");
        var accepted = await client.PostAsJsonAsync("/api/imports/tags", new MetadataJobRequest());
        Assert.Equal(HttpStatusCode.Accepted, accepted.StatusCode);
        var job = await AwaitJobAsync(client, (await accepted.Content.ReadFromJsonAsync<JobAccepted>())!.Id);
        Assert.Equal("completed", job.State); Assert.Equal(2, job.Processed); Assert.Equal(0, job.Failed);
        var videoId = await db.ExecuteScalarAsync<long>("SELECT Id FROM Media WHERE MediaType='video'");
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM MediaTags mt JOIN Tags t ON t.Id=mt.TagId WHERE mt.MediaId=@videoId AND t.Name='Wildlife'", new { videoId }));
    }

    [Fact]
    public async Task Import_reports_invalid_tags_and_unavailable_items_without_losing_valid_unions()
    {
        await using var f = await PipelineFixture.CreateAsync(); await f.CreateImageAsync("one.png"); await f.CreateImageAsync("two.png"); await f.ScanAsync();
        await File.WriteAllBytesAsync(Path.Combine(f.Root.Path, "one.png.xmp"), MetadataKeywords.WriteXmp(["Valid", new string('x', 101)]));
        File.Move(Path.Combine(f.Root.Path, "two.png"), Path.Combine(f.Root.Path, "two-offline.png"));
        await using var host = Host(f); using var client = host.CreateClient();
        var accepted = await client.PostAsJsonAsync("/api/imports/tags", new MetadataJobRequest([1, 2], IncludeSidecars: true));
        var job = await AwaitJobAsync(client, (await accepted.Content.ReadFromJsonAsync<JobAccepted>())!.Id);
        Assert.Equal("completed", job.State); Assert.Equal(2, job.Processed); Assert.Equal(2, job.Failed);
        Assert.Contains(job.Items, item => item.Code == "invalid_tags"); Assert.Contains(job.Items, item => item.Code == "source_unavailable");
        await using var db = await f.Database.OpenAsync(default);
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM MediaTags mt JOIN Tags t ON t.Id=mt.TagId WHERE t.Name='Valid'"));
    }

    [Fact]
    public async Task Metadata_queue_and_selection_are_bounded_and_quota_exhaustion_is_visible()
    {
        await using var f = await PipelineFixture.CreateAsync(); await BrowsingTests.SeedAsync(f, 1);
        using (var service = new MetadataJobs(f.Database, f.Options))
        {
            for (var i = 0; i < 16; i++) await service.EnqueueAsync("xmp", new MetadataJobRequest([1]), default);
            Assert.Equal("rate_limited", (await Assert.ThrowsAsync<ApiRequestException>(() => service.EnqueueAsync("xmp", new MetadataJobRequest([1]), default))).Code);
            await Assert.ThrowsAsync<ApiRequestException>(() => service.EnqueueAsync("import", new MetadataJobRequest(new long[501]), default));
        }
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("DELETE FROM MetadataJobs; INSERT INTO MetadataJobs(Kind,State,Request,CreatedAt,FinishedAt,ContentBytes) VALUES('xmp','completed','{}',@now,@now,1073741824)", new { now = DateTimeOffset.UtcNow.ToString("O") });
        await using var host = Host(f); using var client = host.CreateClient();
        var accepted = await client.PostAsJsonAsync("/api/exports/xmp", new MetadataJobRequest([1]));
        var job = await AwaitJobAsync(client, (await accepted.Content.ReadFromJsonAsync<JobAccepted>())!.Id);
        Assert.Equal("failed", job.State); Assert.Equal("job_quota_exceeded", job.FailureCode); Assert.Null(job.ContentUrl);
    }
    [Fact]
    public async Task Random_serves_an_original_until_its_preview_is_prepared()
    {
        await using var f = await PipelineFixture.CreateAsync(); await f.CreateImageAsync("one.png"); await f.ScanAsync(); await f.ProcessAllAsync();
        await using var host = Host(f); using var client = host.CreateClient();
        var response = await client.GetAsync("/api/random");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode); Assert.Equal("image/png", response.Content.Headers.ContentType!.MediaType);
        Assert.Equal("no-store", response.Headers.CacheControl!.ToString());
        await using var db = await f.Database.OpenAsync(default);
        Assert.True(await db.ExecuteScalarAsync<bool>("SELECT WantPreview FROM ProcessingJobs"));
    }

    private static WebApplicationFactory<Program> Host(PipelineFixture f) => new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Testing")
        .UseSetting("Luma:DatabasePath", f.Database.Path).UseSetting("Luma:Indexing:CachePath", f.Options.CachePath)
        .UseSetting("Luma:Indexing:Libraries:0:Id", "1").UseSetting("Luma:Indexing:Libraries:0:Name", "Test").UseSetting("Luma:Indexing:Libraries:0:Path", f.Root.Path));
    private static async Task<MetadataJobStatus> AwaitJobAsync(HttpClient client, long id)
    {
        for (var attempt = 0; attempt < 200; attempt++)
        {
            var status = (await client.GetFromJsonAsync<MetadataJobStatus>($"/api/jobs/{id}"))!;
            if (status.State is not ("queued" or "running")) return status;
            await Task.Delay(50);
        }
        throw new TimeoutException("Metadata job did not finish.");
    }
}
