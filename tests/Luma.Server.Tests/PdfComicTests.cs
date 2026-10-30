using System.Text;
using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Dapper;
using Luma.Server.Features.Panels;
using Luma.Server.Http;
using Microsoft.Extensions.Logging.Abstractions;

namespace Luma.Server.Tests;

public sealed class PdfComicTests
{
    [Theory]
    [InlineData("Pages: 0\nEncrypted: no")]
    [InlineData("Pages: 5001\nEncrypted: no")]
    [InlineData("Pages: 2\nEncrypted: unknown")]
    [InlineData("not a PDF")]
    public void Unsupported_documents_are_rejected(string info) =>
        Assert.Equal("comic_pdf_unsupported", Assert.Throws<ApiRequestException>(() => PdfComics.ParseInfo(info)).Code);

    [Fact]
    public void Pdf_page_order_is_numeric_and_discovery_includes_pdf()
    {
        Assert.True(ComicSources.IsBook("BOOK.PDF"));
        Assert.False(ComicSources.IsArchive("BOOK.PDF"));
        var pages = PdfComics.ParseInfo("Title: A book\nPages: 12\nEncrypted: no\n");
        Assert.Equal("10.png", pages[9].Name);
        Assert.Equal(12, pages.Count);
    }

    [Theory]
    [InlineData("Pages: 41\nEncrypted: yes (print:yes copy:no change:no addNotes:no algorithm:AES-256)")]
    [InlineData("Title: Multiple fields\nPages: not a number\nPages: 41\nEncrypted: no")]
    public void Documents_opened_without_a_password_support_owner_restrictions_and_duplicate_metadata(string info) =>
        Assert.Equal(41, PdfComics.ParseInfo(info).Count);

    [Fact]
    public async Task Poppler_imports_an_owner_restricted_pdf_without_a_password_but_rejects_a_required_password()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "owner-restricted.pdf");
        Assert.Single(await PdfComics.InspectAsync(path, f.Options, default));
        await Assert.ThrowsAsync<Luma.Server.MediaProcessing.ProcessingException>(() => PdfComics.InspectAsync(
            Path.Combine(AppContext.BaseDirectory, "Fixtures", "password-required.pdf"), f.Options, default));
    }

    // Small valid two-page PDF, without another test-generation dependency.
    internal static byte[] Document()
    {
        var objects = new[] {
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 450] /Contents 5 0 R >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 450 300] /Contents 6 0 R >>",
            "<< /Length 24 >>\nstream\n1 0 0 rg 0 0 300 450 re f\nendstream",
            "<< /Length 24 >>\nstream\n0 0 1 rg 0 0 450 300 re f\nendstream"
        };
        var text = new StringBuilder("%PDF-1.4\n");
        var offsets = new List<int>();
        foreach (var item in objects) { offsets.Add(text.Length); text.Append($"{offsets.Count} 0 obj\n{item}\nendobj\n"); }
        var xref = text.Length;
        text.Append($"xref\n0 {objects.Length + 1}\n0000000000 65535 f \n");
        foreach (var offset in offsets) text.Append($"{offset:0000000000} 00000 n \n");
        text.Append($"trailer\n<< /Size {objects.Length + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n");
        return Encoding.ASCII.GetBytes(text.ToString());
    }

    [Fact]
    public async Task Pdf_endpoint_supports_byte_ranges_and_rejects_outside_sources()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var content = Document();
        var path = Path.Combine(f.Root.Path, "book.pdf");
        await File.WriteAllBytesAsync(path, content);
        await using var db = await f.Database.OpenAsync(default);
        var id = await db.ExecuteScalarAsync<long>("""
            INSERT INTO Comics(LibraryId,RelativePath,PathKey,Format,Title,PageCount,SourceSize,SourceModifiedTicks,AddedAt)
            VALUES(1,'book.pdf','book.pdf','pdf','PDF',2,@size,@ticks,'2026-10-28') RETURNING Id
            """, new { size = content.Length, ticks = File.GetLastWriteTimeUtc(path).Ticks });
        var webRoot = Path.Combine(f.DirectoryPath, "web");
        var assets = Path.Combine(webRoot, "pdfjs");
        Directory.CreateDirectory(assets);
        foreach (var extension in new[] { "bcmap", "pfb", "wasm", "mjs" })
            await File.WriteAllTextAsync(Path.Combine(assets, "asset." + extension), "pdf asset");
        await using var host = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Testing").UseWebRoot(webRoot)
            .UseSetting("Luma:DatabasePath", f.Database.Path)
            .UseSetting("Luma:Indexing:CachePath", f.Options.CachePath)
            .UseSetting("Luma:Indexing:Libraries:0:Id", "1")
            .UseSetting("Luma:Indexing:Libraries:0:Name", "Test")
            .UseSetting("Luma:Indexing:Libraries:0:Path", f.Root.Path));
        using var client = host.CreateClient();
        foreach (var extension in new[] { "bcmap", "pfb", "wasm", "mjs" })
            Assert.Equal("pdf asset", await client.GetStringAsync("/pdfjs/asset." + extension));
        var url = $"/api/panels/comics/{id}/document?revision=1";
        using var range = new HttpRequestMessage(HttpMethod.Get, url);
        range.Headers.Range = new(0, 7);
        using var response = await client.SendAsync(range);
        Assert.Equal(HttpStatusCode.PartialContent, response.StatusCode);
        Assert.Equal(content[..8], await response.Content.ReadAsByteArrayAsync());
        Assert.Equal(content.Length, response.Content.Headers.ContentRange?.Length);
        Assert.Equal("application/pdf", response.Content.Headers.ContentType?.MediaType);
        using var cached = new HttpRequestMessage(HttpMethod.Get, url);
        cached.Headers.IfNoneMatch.Add(response.Headers.ETag!);
        Assert.Equal(HttpStatusCode.NotModified, (await client.SendAsync(cached)).StatusCode);
        using var crossSite = new HttpRequestMessage(HttpMethod.Get, url);
        crossSite.Headers.Add("Sec-Fetch-Site", "cross-site");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(crossSite)).StatusCode);
        await db.ExecuteAsync("UPDATE Comics SET RelativePath='../outside.pdf' WHERE Id=@id", new { id });
        Assert.NotEqual(HttpStatusCode.OK, (await client.GetAsync(url)).StatusCode);
    }

    [Fact]
    public async Task Pdf_discovery_caches_only_cover_and_document_stream_is_revision_checked()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var path = Path.Combine(f.Root.Path, "book.pdf");
        await File.WriteAllBytesAsync(path, Document());
        var library = new ComicLibrary(f.Database, f.Options);
        using var decoder = new Luma.Server.MediaProcessing.MediaProcessor(f.Options);
        var pages = new ComicPageContent(f.Database, f.Options, library, decoder);
        var worker = new ComicWorker(f.Database, f.Options, library, pages, NullLogger<ComicWorker>.Instance);
        var accepted = await library.QueueAsync(new(1), default);
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("UPDATE ComicJobs SET State='running' WHERE Id=@Id", accepted);
        await worker.ProcessAsync(await db.QuerySingleAsync<ComicJob>("SELECT * FROM ComicJobs"), default);
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT Failed FROM ComicJobs"));
        var comic = Assert.Single((await library.ListAsync(null, null, null, null, null, default)).Items);
        Assert.Equal("pdf", comic.Format);
        Assert.Equal(2, comic.PageCount);
        Assert.NotNull(comic.CoverUrl);
        Assert.EndsWith("document?revision=1", comic.DocumentUrl);
        Assert.Equal(new[] { "cover" }, await db.QueryAsync<string>("SELECT Variant FROM ComicCache"));
        var file = Assert.IsType<Microsoft.AspNetCore.Http.HttpResults.PhysicalFileHttpResult>(await pages.DocumentAsync(comic.Id, 1, default));
        Assert.True(file.EnableRangeProcessing);
        Assert.Equal("application/pdf", file.ContentType);
        Assert.Equal(path, file.FileName);
        Assert.Equal("comic_source_changed", (await Assert.ThrowsAsync<ApiRequestException>(() => pages.DocumentAsync(comic.Id, 2, default))).Code);
        await File.AppendAllTextAsync(path, "changed");
        Assert.Equal("comic_source_changed", (await Assert.ThrowsAsync<ApiRequestException>(() => pages.DocumentAsync(comic.Id, 1, default))).Code);
        // Shelf listing never needs the original or invokes a renderer.
        File.Delete(path);
        Assert.Single((await library.ListAsync(null, null, null, null, null, default)).Items);
    }
}
