using System.Net;
using Dapper;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Luma.Server.Tests;

public sealed class OriginalContentTests
{
    [Fact]
    public async Task Original_stream_supports_seek_download_unavailable_and_path_validation()
    {
        await using var fixture = await PipelineFixture.CreateAsync();
        await fixture.CreateImageAsync("image.png");
        await fixture.ScanAsync();
        // Prepare previews before starting hosted workers so source-deletion assertions
        // do not race an unrelated image decoder holding a Windows file handle.
        await fixture.ProcessAllAsync();
        var bytes = await File.ReadAllBytesAsync(Path.Combine(fixture.Root.Path, "image.png"));
        await using var host = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Testing")
            .UseSetting("Luma:DatabasePath", fixture.Database.Path)
            .UseSetting("Luma:Indexing:CachePath", fixture.Options.CachePath)
            .UseSetting("Luma:Indexing:Libraries:0:Id", "1")
            .UseSetting("Luma:Indexing:Libraries:0:Name", "Test")
            .UseSetting("Luma:Indexing:Libraries:0:Path", fixture.Root.Path));
        using var client = host.CreateClient();
        var full = await client.GetAsync("/api/media/1/original");
        Assert.Equal(HttpStatusCode.OK, full.StatusCode);
        Assert.Equal("image/png", full.Content.Headers.ContentType?.MediaType);
        Assert.Null(full.Content.Headers.ContentDisposition);
        Assert.Equal(bytes, await full.Content.ReadAsByteArrayAsync());
        using var range = new HttpRequestMessage(HttpMethod.Get, "/api/media/1/original");
        range.Headers.Range = new(2, 9);
        var partial = await client.SendAsync(range);
        Assert.Equal(HttpStatusCode.PartialContent, partial.StatusCode);
        Assert.Equal(bytes[2..10], await partial.Content.ReadAsByteArrayAsync());
        Assert.Equal(bytes.LongLength, partial.Content.Headers.ContentRange?.Length);
        using var invalidRange = new HttpRequestMessage(HttpMethod.Get, "/api/media/1/original");
        invalidRange.Headers.Range = new(bytes.Length + 1, null);
        Assert.Equal(HttpStatusCode.RequestedRangeNotSatisfiable, (await client.SendAsync(invalidRange)).StatusCode);
        var download = await client.GetAsync("/api/media/1/original?download=true");
        Assert.Equal("attachment", download.Content.Headers.ContentDisposition?.DispositionType);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/media/999/original")).StatusCode);
        await using var db = await fixture.Database.OpenAsync(default);
        await db.ExecuteAsync("UPDATE Media SET RelativePath='../outside.png' WHERE Id=1");
        var outside = await client.GetAsync("/api/media/1/original");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, outside.StatusCode);
        Assert.Contains("source_unavailable", await outside.Content.ReadAsStringAsync());
        Assert.DoesNotContain(fixture.Root.Path, await outside.Content.ReadAsStringAsync());
        await db.ExecuteAsync("UPDATE Media SET RelativePath='image.png' WHERE Id=1");
        File.Delete(Path.Combine(fixture.Root.Path, "image.png"));
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.GetAsync("/api/media/1/original")).StatusCode);
    }
}
