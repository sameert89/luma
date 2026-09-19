using System.Net;
using System.Net.Http.Json;
using Dapper;
using Luma.Server.Features.Indexing;
using Luma.Server.Features.Libraries;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Luma.Server.Tests;

public sealed class LibrarySetupTests
{
    [Fact]
    public async Task A_library_can_be_browsed_folder_by_folder_without_a_full_scan()
    {
        await using var f = await PipelineFixture.CreateAsync();
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "album"));
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "top.jpg"), "x");
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "album", "inner.jpg"), "x");
        await using var host = Idle(f);
        using var client = host.CreateClient();

        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/api/libraries/1/metadata-mode", new { metadataMode = "all" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PutAsJsonAsync("/api/libraries/9/metadata-mode", new { metadataMode = "none" })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.PutAsJsonAsync("/api/libraries/1/metadata-mode", new { metadataMode = "xmp" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync("/api/libraries/9/root", null)).StatusCode);
        var root = (await (await client.PostAsync("/api/libraries/1/root", null)).Content.ReadFromJsonAsync<LibraryRoot>())!;
        // Preparing the root again is harmless and returns the same folder.
        Assert.Equal(root, await (await client.PostAsync("/api/libraries/1/root", null)).Content.ReadFromJsonAsync<LibraryRoot>());
        var library = (await client.GetFromJsonAsync<LibrarySummary[]>("/api/libraries"))!.Single();
        Assert.Equal(root.FolderId, library.RootFolderId);
        Assert.Equal("xmp", library.MetadataMode);

        await using var db = await f.Database.OpenAsync(default);
        // Neither call started any work.
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Scans"));
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Media"));

        // Opening the root indexes only its own entries, with the library's metadata mode.
        var response = await client.PostAsync($"/api/folders/{root.FolderId}/index", null);
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        var scan = await db.QuerySingleAsync<ScanRow>("SELECT * FROM Scans WHERE Id=@Id", await response.Content.ReadFromJsonAsync<ScanAccepted>());
        Assert.Equal(root.FolderId, scan.FolderId);
        Assert.False(scan.Recursive);
        Assert.Equal("xmp", scan.MetadataMode);
        await db.ExecuteAsync("UPDATE Scans SET State='running' WHERE Id=@Id", scan);
        await f.Scanner.ScanAsync(scan, f.Root, default);
        Assert.Equal(new[] { "top.jpg" }, (await db.QueryAsync<string>("SELECT RelativePath FROM Media")).ToArray());
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Folders WHERE RelativePath='album'"));
    }

    [Fact]
    public async Task Opening_an_indexed_folder_imports_missing_tags_only_when_the_library_imports_metadata()
    {
        await using var f = await PipelineFixture.CreateAsync();
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "album", "nested"));
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "album", "photo.jpg"), "x");
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "album", "nested", "deeper.jpg"), "x");
        // Indexed without any metadata stage, like an index-only library or a cancelled import.
        await f.ScanAsync();
        await using var db = await f.Database.OpenAsync(default);
        var album = await db.ExecuteScalarAsync<long>("SELECT Id FROM Folders WHERE RelativePath='album'");
        await using var host = Idle(f);
        using var client = host.CreateClient();
        async Task<string[]> OpenAsync()
        {
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/folders/{album}/index", null)).StatusCode);
            return (await db.QueryAsync<string>("SELECT Request FROM MetadataJobs ORDER BY Id")).ToArray();
        }

        await client.PutAsJsonAsync("/api/libraries/1/metadata-mode", new { metadataMode = "none" });
        Assert.Empty(await OpenAsync());

        await client.PutAsJsonAsync("/api/libraries/1/metadata-mode", new { metadataMode = "embedded" });
        var queued = Assert.Single(await OpenAsync());
        Assert.Equal(album, await db.ExecuteScalarAsync<long>("SELECT json_extract(@queued,'$.Query.FolderId')", new { queued }));
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT json_extract(@queued,'$.Query.Recursive')", new { queued }));
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT json_extract(@queued,'$.IncludeSidecars')", new { queued }));
        // A queued import already covers the folder.
        Assert.Single(await OpenAsync());

        // Once an import has tried the folder's media, opening it again queues nothing,
        // even when that attempt failed.
        await db.ExecuteAsync("""
            UPDATE MetadataJobs SET State='completed';
            INSERT INTO MetadataJobItems(JobId,MediaId,Code) SELECT j.Id,m.Id,'source_unavailable' FROM MetadataJobs j, Media m WHERE m.FileName='photo.jpg';
            """);
        Assert.Single(await OpenAsync());

        // Switching the library to XMP sidecars makes an embedded-only attempt insufficient.
        await client.PutAsJsonAsync("/api/libraries/1/metadata-mode", new { metadataMode = "xmp" });
        var jobs = await OpenAsync();
        Assert.Equal(2, jobs.Length);
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT json_extract(@job,'$.IncludeSidecars')", new { job = jobs[1] }));
    }

    // Without hosted workers, queued scans and imports stay queued for the assertions to inspect.
    private static WebApplicationFactory<Program> Idle(PipelineFixture f) => new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Testing")
        .UseSetting("Luma:DatabasePath", f.Database.Path).UseSetting("Luma:Indexing:CachePath", f.Options.CachePath)
        .UseSetting("Luma:Indexing:Libraries:0:Id", "1").UseSetting("Luma:Indexing:Libraries:0:Name", "Test").UseSetting("Luma:Indexing:Libraries:0:Path", f.Root.Path)
        .ConfigureServices(services =>
        {
            foreach (var worker in services.Where(service => service.ServiceType == typeof(IHostedService)).ToArray()) services.Remove(worker);
        }));
}
