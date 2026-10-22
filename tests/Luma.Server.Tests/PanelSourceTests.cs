using Dapper;
using Luma.Server.Features.Panels;
using Luma.Server.Features.Settings;
using Luma.Server.Http;
using Microsoft.Extensions.Configuration;

namespace Luma.Server.Tests;

public sealed class PanelSourceTests
{
    [Fact]
    public async Task Locations_persist_queue_recursive_discovery_and_keep_book_metadata_when_changed()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var sources = new PanelSources(f.Database, f.Options, new ConfigurationBuilder().Build());
        Assert.False((await sources.GetAsync(default)).Configured);
        await sources.SaveAsync([new(1, "Comics", true)], default);
        Assert.Equal(new PanelSourceLocation(1, "Comics", true), Assert.Single((await sources.GetAsync(default)).Locations));
        await using var db = await f.Database.OpenAsync(default);
        Assert.True((await db.QuerySingleAsync<ComicJob>("SELECT * FROM ComicJobs")).Recursive);
        await db.ExecuteAsync("""
            INSERT INTO Comics(LibraryId,RelativePath,PathKey,Format,Title,PageCount,SourceSize,SourceModifiedTicks,AddedAt)
            VALUES(1,'Comics/Book.cbz',@key,'zip','Book',3,1,1,'2026-01-01')
            """, new { key = f.Root.Key("Comics/Book.cbz") });
        var books = new ComicLibrary(f.Database, f.Options);
        Assert.Single((await books.ListAsync(null, null, null, null, null, default)).Items);
        await sources.SaveAsync([new(1, "Other")], default);
        Assert.Empty((await books.ListAsync(null, null, null, null, null, default)).Items);
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Comics"));
        await Assert.ThrowsAsync<ApiRequestException>(() => sources.SaveAsync([new(1, "../outside")], default));
        Assert.Equal("Other", Assert.Single((await sources.GetAsync(default)).Locations).RelativePath);
        await sources.SaveAsync([new(1, "Comics")], default);
        Assert.Single((await books.ListAsync(null, null, null, null, null, default)).Items);
    }

    [Fact]
    public async Task Application_ui_choices_override_environment_and_only_safe_preferences_are_published()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Luma:Ui:FlickEnabled"] = "false",
            ["Luma:Ui:Preferences:luma-theme"] = "forest",
            ["Luma:Ui:Preferences:AccessToken"] = "never-publish",
            ["Luma:Files:AccessToken"] = new('x', 32)
        }).Build();
        var settings = new UiConfiguration(config, f.Database);
        Assert.False(settings.Applications.FlickEnabled);
        Assert.Equal("forest", Assert.Single(settings.Defaults).Value);
        await settings.SaveAsync(new(true, false), default);
        var restarted = new UiConfiguration(config, f.Database);
        await restarted.InitializeAsync(default);
        Assert.True(restarted.Applications.FlickEnabled);
        Assert.False(restarted.Applications.PanelsEnabled);
    }
    [Fact]
    public async Task Recursive_discovery_stays_inside_the_selected_comic_location()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await f.CreateImageAsync("page.png");
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "Comics", "Nested"));
        var selected = Path.Combine(f.Root.Path, "Comics", "Nested", "Book.cbz");
        using (var archive = System.IO.Compression.ZipFile.Open(selected, System.IO.Compression.ZipArchiveMode.Create))
        {
            var entry = archive.CreateEntry("page.png");
            using var output = entry.Open();
            using var input = File.OpenRead(Path.Combine(f.Root.Path, "page.png"));
            input.CopyTo(output);
        }
        File.Copy(selected, Path.Combine(f.Root.Path, "Outside.cbz"));
        var sources = new PanelSources(f.Database, f.Options, new ConfigurationBuilder().Build());
        await sources.SaveAsync([new(1, "Comics")], default);
        var library = new ComicLibrary(f.Database, f.Options);
        using var decoder = new Luma.Server.MediaProcessing.MediaProcessor(f.Options);
        var pages = new ComicPageContent(f.Database, f.Options, library, decoder);
        using var worker = new ComicWorker(f.Database, f.Options, library, pages, Microsoft.Extensions.Logging.Abstractions.NullLogger<ComicWorker>.Instance);
        await using var db = await f.Database.OpenAsync(default);
        var job = await db.QuerySingleAsync<ComicJob>("UPDATE ComicJobs SET State='running' RETURNING *");
        await worker.ProcessAsync(job, default);
        Assert.Equal("completed", await db.ExecuteScalarAsync<string>("SELECT State FROM ComicJobs"));
        Assert.Equal("Comics/Nested/Book.cbz", await db.QuerySingleAsync<string>("SELECT RelativePath FROM Comics"));
    }
}
