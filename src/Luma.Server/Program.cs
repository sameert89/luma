using Luma.Server.Data;
using Luma.Server.Features.Status;
using Luma.Server.Http;
using Luma.Server.Features.Indexing;
using Luma.Server.MediaProcessing;
using Luma.Server.Features.Media;
using Luma.Server.Features.Tags;
using Luma.Server.Features.Libraries;

if (args.FirstOrDefault() == "--image-worker")
{
    await ImageProcessCommand.RunWorkerAsync(CancellationToken.None);
    return;
}
if (args.FirstOrDefault() == "--process-image")
{
    await ImageProcessCommand.RunAsync(args, CancellationToken.None);
    return;
}

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddOpenApi();
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<ApiExceptionHandler>();
builder.Services.AddSingleton<Database>();
builder.Services.AddSingleton<MigrationRunner>();
builder.Services.AddSingleton<CursorSigner>();
builder.Services.AddSingleton<MediaBrowser>();
builder.Services.AddSingleton<RandomImage>();
builder.Services.AddSingleton<LibraryBrowser>();
builder.Services.AddSingleton<CacheContent>();
builder.Services.AddSingleton<OriginalContent>();
builder.Services.AddSingleton<CacheAccessLog>();
builder.Services.AddSingleton<TagService>();
builder.Services.AddSingleton<MetadataJobs>();
builder.Services.AddSingleton(services =>
{
    var options = new IndexingOptions();
    services.GetRequiredService<IConfiguration>().GetSection("Luma:Indexing").Bind(options);
    options.Validate(services.GetRequiredService<IHostEnvironment>().ContentRootPath, services.GetRequiredService<Database>().Path);
    return options;
});
builder.Services.AddSingleton<IndexingSetup>();
builder.Services.AddSingleton<MediaProcessor>();
builder.Services.AddSingleton<GeneratedCache>();
builder.Services.AddSingleton<ScanWorker>();
builder.Services.AddSingleton<SourceVerificationPreference>();
if (Environment.GetEnvironmentVariable("LUMA_EXPORT_OPENAPI") != "1")
{
    builder.Services.AddHostedService(services => services.GetRequiredService<ScanWorker>());
    builder.Services.AddHostedService<ProcessingWorker>();
    builder.Services.AddHostedService(services => services.GetRequiredService<MetadataJobs>());
    builder.Services.AddHostedService<SourcePresenceWorker>();
    builder.Services.AddHostedService(services => services.GetRequiredService<CacheAccessLog>());
    builder.Services.AddHostedService(services => services.GetRequiredService<CacheContent>());
}
builder.Services.Configure<HostOptions>(options => options.ShutdownTimeout = TimeSpan.FromSeconds(10));
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.Strict);
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 64 * 1024);
var app = builder.Build();
app.UseExceptionHandler();
// Opt-in for deployments that terminate TLS in Kestrel (see docs/DEPLOYMENT.md). Proxies that
// terminate TLS themselves should set ASPNETCORE_FORWARDEDHEADERS_ENABLED=true instead.
if (app.Configuration.GetValue<bool>("Luma:Https:RedirectHttp")) app.UseHttpsRedirection();
app.UseStatusCodePages(async context =>
{
    var status = context.HttpContext.Response.StatusCode;
    await Results.Problem(statusCode: status,
        extensions: ApiErrors.Extensions(status, context.HttpContext)).ExecuteAsync(context.HttpContext);
});
// Interactive writes take priority over background work and retry briefly on contention.
var api = app.MapGroup("").AddEndpointFilter<ForegroundWriteFilter>();
api.MapStatus();
api.MapIndexing();
api.MapMedia();
api.MapPlayback();
api.MapTasks();
api.MapSearchSuggestions();
if (app.Environment.IsDevelopment()) app.MapOpenApi();
app.UseRouting();
app.Use(async (context, next) =>
{
    if (context.GetEndpoint() is null &&
        !context.Request.Path.StartsWithSegments("/api") &&
        !context.Request.Path.StartsWithSegments("/openapi") &&
        !Path.HasExtension(context.Request.Path) &&
        (HttpMethods.IsGet(context.Request.Method) || HttpMethods.IsHead(context.Request.Method)))
        context.Request.Path = "/index.html";
    await next(context);
});
if (Directory.Exists(app.Environment.WebRootPath))
{
    var contentTypes = new Microsoft.AspNetCore.StaticFiles.FileExtensionContentTypeProvider();
    contentTypes.Mappings[".webmanifest"] = "application/manifest+json";
    app.UseDefaultFiles();
    app.UseStaticFiles(new StaticFileOptions
    {
        ContentTypeProvider = contentTypes,
        // Vite fingerprints /assets; the shell, manifest and service worker must revalidate so
        // installed apps pick up new releases.
        OnPrepareResponse = file => file.Context.Response.Headers.CacheControl =
            file.Context.Request.Path.StartsWithSegments("/assets") ? "public, max-age=31536000, immutable" : "no-cache"
    });
}

// Build-time OpenAPI extraction must not create or migrate a database.
if (Environment.GetEnvironmentVariable("LUMA_EXPORT_OPENAPI") != "1")
{
    await app.Services.GetRequiredService<MigrationRunner>().ApplyAsync(app.Lifetime.ApplicationStopping);
    // Browsing depends on WAL: without it every read blocks writers (and vice versa), and
    // requests fail with "database is locked" under indexing load.
    await using (var db = await app.Services.GetRequiredService<Database>().OpenAsync(app.Lifetime.ApplicationStopping))
    {
        var mode = await Dapper.SqlMapper.ExecuteScalarAsync<string>(db, "PRAGMA journal_mode;");
        if (!string.Equals(mode, "wal", StringComparison.OrdinalIgnoreCase))
            app.Logger.LogWarning("SQLite is using journal mode {Mode} instead of WAL; keep /data on local storage (not a network share) to avoid lock contention", mode);
    }
    await app.Services.GetRequiredService<CursorSigner>().InitializeAsync(app.Lifetime.ApplicationStopping);
    await app.Services.GetRequiredService<IndexingSetup>().InitializeAsync(app.Lifetime.ApplicationStopping);
}
await app.RunAsync();

public partial class Program;
