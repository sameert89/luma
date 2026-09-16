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
builder.Services.AddSingleton<LibraryBrowser>();
builder.Services.AddSingleton<CacheContent>();
builder.Services.AddSingleton<OriginalContent>();
builder.Services.AddSingleton<CacheAccessLog>();
builder.Services.AddSingleton<TagService>();
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
if (Environment.GetEnvironmentVariable("LUMA_EXPORT_OPENAPI") != "1")
{
    builder.Services.AddHostedService(services => services.GetRequiredService<ScanWorker>());
    builder.Services.AddHostedService<ProcessingWorker>();
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
app.UseStatusCodePages(async context =>
{
    var status = context.HttpContext.Response.StatusCode;
    await Results.Problem(statusCode: status,
        extensions: ApiErrors.Extensions(status, context.HttpContext)).ExecuteAsync(context.HttpContext);
});
app.MapStatus();
app.MapIndexing();
app.MapMedia();
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
    app.UseDefaultFiles();
    app.UseStaticFiles();
}

// Build-time OpenAPI extraction must not create or migrate a database.
if (Environment.GetEnvironmentVariable("LUMA_EXPORT_OPENAPI") != "1")
{
    await app.Services.GetRequiredService<MigrationRunner>().ApplyAsync(app.Lifetime.ApplicationStopping);
    await app.Services.GetRequiredService<CursorSigner>().InitializeAsync(app.Lifetime.ApplicationStopping);
    await app.Services.GetRequiredService<IndexingSetup>().InitializeAsync(app.Lifetime.ApplicationStopping);
}
await app.RunAsync();

public partial class Program;
