using System.Net;
using System.Net.Http.Headers;
using Dapper;
using Luma.Server.Features.Libraries;
using Luma.Server.Features.Media;
using Luma.Server.Http;
using Luma.Server.MediaProcessing;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Luma.Server.Tests;

public sealed class VisibilityAndStreamingTests
{
    [Fact]
    public async Task Hidden_folders_leave_every_view_and_indexing_until_shown_again()
    {
        await using var f = await PipelineFixture.CreateAsync();
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "album", "nested"));
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "other"));
        await f.CreateImageAsync("album/nested/inside.png");
        await f.CreateImageAsync("other/visible.png");
        await f.CreateImageAsync("root.png");
        await f.ScanAsync();
        await using var db = await f.Database.OpenAsync(default);
        long Folder(string path) => db.ExecuteScalar<long>("SELECT Id FROM Folders WHERE RelativePath=@path", new { path });
        var browser = await BrowsingTests.BrowserAsync(f);
        var signer = new CursorSigner(f.Database);
        await signer.InitializeAsync(default);
        var libraries = new LibraryBrowser(f.Database, signer);
        async Task<string[]> Names(MediaQuery query) =>
            (await browser.ListAsync(query.Normalize(), default)).Items.Select(x => x.FileName).Order().ToArray();

        Assert.Equal(["inside.png", "root.png", "visible.png"], await Names(new()));
        var root = Folder("");
        await Assert.ThrowsAsync<ApiRequestException>(() => libraries.SetHiddenAsync(root, true, default));
        await libraries.SetHiddenAsync(Folder("album"), true, default);

        Assert.Equal(["root.png", "visible.png"], await Names(new()));
        Assert.Equal(["visible.png"], await Names(new() { FolderId = root, Recursive = true, Q = "visible" }));
        Assert.Empty(await Names(new() { FolderId = Folder("album/nested") }));
        Assert.Equal(["other"], (await libraries.FoldersAsync(1, null, 10, null, default)).Items.Select(x => x.Name));
        var hidden = Assert.Single(await libraries.HiddenAsync(default));
        Assert.Equal(("album", "Fixture"), (hidden.Path, hidden.LibraryName));
        // Hidden media stops being prepared.
        Assert.Equal("waiting", await db.ExecuteScalarAsync<string>(
            "SELECT j.State FROM ProcessingJobs j JOIN Media m ON m.Id=j.MediaId WHERE m.FileName='inside.png'"));

        // A rescan neither descends into the hidden subtree nor reconciles it as missing.
        await f.CreateImageAsync("album/nested/later.png");
        await f.ScanAsync();
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Media WHERE FileName='later.png'"));
        Assert.Equal("present", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Media WHERE FileName='inside.png'"));
        var plan = string.Join('\n', (await db.QueryAsync($"EXPLAIN QUERY PLAN {HiddenFolders.Descendants}")).Select(row => (string)row.detail));
        Assert.Contains("IX_Folders_Hidden", plan);

        await libraries.SetHiddenAsync(Folder("album"), false, default);
        Assert.Equal(["inside.png", "root.png", "visible.png"], await Names(new()));
        Assert.Empty(await libraries.HiddenAsync(default));
        await f.ScanAsync();
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Media WHERE FileName='later.png'"));
    }

    [Fact]
    public async Task Gif_and_motion_filters_select_animated_images_alongside_videos()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await f.CreateImageAsync("still.png");
        await f.CreateImageAsync("loop.gif");
        await MediaProcessor.RunAsync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=128x96:r=4", "-t", "1",
            "-c:v", "mpeg4", "-threads", "1", Path.Combine(f.Root.Path, "clip.mp4")], default);
        await f.ScanAsync();
        var browser = await BrowsingTests.BrowserAsync(f);
        async Task<string[]> Names(string? type) =>
            (await browser.ListAsync(new MediaQuery { MediaType = type }.Normalize(), default)).Items.Select(x => x.FileName).Order().ToArray();

        Assert.Equal(["loop.gif"], await Names("gif"));
        Assert.Equal(["clip.mp4", "loop.gif"], await Names("motion"));
        Assert.Equal(["loop.gif", "still.png"], await Names("image"));
        Assert.Equal(["clip.mp4"], await Names("video"));
        Assert.Throws<ApiRequestException>(() => new MediaQuery { MediaType = "animated" }.Normalize());
    }

    [Fact]
    public async Task Default_reels_query_seeks_the_motion_ordering_index()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await using var db = await f.Database.OpenAsync(default);
        var query = new MediaQuery { MediaType = "motion", Limit = 2 }.Normalize();
        var (predicate, parameters) = query.Predicate();
        parameters.Add("limit", query.Limit);

        var plan = string.Join('\n', (await db.QueryAsync(
            $"EXPLAIN QUERY PLAN SELECT m.* FROM Media m WHERE {predicate} ORDER BY m.ModifiedTicks DESC,m.Id DESC LIMIT @limit",
            parameters)).Select(row => (string)row.detail));

        Assert.Contains("IX_Media_MotionModified", plan);
        Assert.DoesNotContain("USE TEMP B-TREE FOR ORDER BY", plan);
    }

    [Fact]
    public async Task Original_streams_bound_open_ranges_and_revalidate_with_a_strong_validator()
    {
        await using var fixture = await PipelineFixture.CreateAsync();
        var bytes = new byte[OriginalContent.RangeChunkBytes + 4096];
        Random.Shared.NextBytes(bytes);
        await File.WriteAllBytesAsync(Path.Combine(fixture.Root.Path, "clip.mp4"), bytes);
        await fixture.ScanAsync();
        await using var host = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Testing")
            .UseSetting("Luma:DatabasePath", fixture.Database.Path)
            .UseSetting("Luma:Indexing:CachePath", fixture.Options.CachePath)
            .UseSetting("Luma:Indexing:Libraries:0:Id", "1")
            .UseSetting("Luma:Indexing:Libraries:0:Name", "Test")
            .UseSetting("Luma:Indexing:Libraries:0:Path", fixture.Root.Path));
        using var client = host.CreateClient();

        using var open = new HttpRequestMessage(HttpMethod.Get, "/api/media/1/original");
        open.Headers.Range = new(0, null);
        var first = await client.SendAsync(open);
        Assert.Equal(HttpStatusCode.PartialContent, first.StatusCode);
        Assert.Equal(new ContentRangeHeaderValue(0, OriginalContent.RangeChunkBytes - 1, bytes.LongLength), first.Content.Headers.ContentRange);
        Assert.Equal(bytes[..(int)OriginalContent.RangeChunkBytes], await first.Content.ReadAsByteArrayAsync());
        Assert.True(first.Headers.CacheControl?.Private);
        Assert.Equal(TimeSpan.FromDays(1), first.Headers.CacheControl?.MaxAge);
        var tag = first.Headers.ETag;
        Assert.NotNull(tag);
        Assert.False(tag.IsWeak);

        // The tail is shorter than a chunk and is returned in full.
        using var tail = new HttpRequestMessage(HttpMethod.Get, "/api/media/1/original");
        tail.Headers.Range = new(OriginalContent.RangeChunkBytes, null);
        Assert.Equal(bytes[(int)OriginalContent.RangeChunkBytes..], await (await client.SendAsync(tail)).Content.ReadAsByteArrayAsync());

        using var conditional = new HttpRequestMessage(HttpMethod.Get, "/api/media/1/original");
        conditional.Headers.IfNoneMatch.Add(tag);
        Assert.Equal(HttpStatusCode.NotModified, (await client.SendAsync(conditional)).StatusCode);

        // Downloads are not chunked: a resumed download receives the whole remainder.
        using var download = new HttpRequestMessage(HttpMethod.Get, "/api/media/1/original?download=true");
        download.Headers.Range = new(0, null);
        Assert.Equal(bytes.LongLength, (await client.SendAsync(download)).Content.Headers.ContentLength);
    }
}
