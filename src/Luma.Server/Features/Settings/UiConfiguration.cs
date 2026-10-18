using System.Text.Json;
using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Files;

namespace Luma.Server.Features.Settings;

public sealed record ApplicationFlags(bool FlickEnabled = true, bool PanelsEnabled = true);
public sealed record UiConfigurationResponse(ApplicationFlags Applications, IReadOnlyDictionary<string, string> Defaults);
public sealed class UiConfiguration(IConfiguration configuration, Database database)
{
    private static readonly string[] Keys = ["luma-theme", "luma-appearance-v2", "luma-album-covers", "luma-reels-sort", "luma-slideshow-seconds", "luma-video-autoplay", "luma-viewer-fill", "luma-reels-fill", "luma-show-filters", "luma-reels-show-filters", "luma-reels-state", "luma-panels-reader-defaults"];
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public ApplicationFlags Applications { get; private set; } = new(configuration.GetValue("Luma:Ui:FlickEnabled", true), configuration.GetValue("Luma:Ui:PanelsEnabled", true));
    public IReadOnlyDictionary<string, string> Defaults { get; } = configuration.GetSection("Luma:Ui:Preferences").GetChildren()
        .Where(x => Keys.Contains(x.Key, StringComparer.OrdinalIgnoreCase) && x.Value is not null && x.Value.Length <= 8192)
        .ToDictionary(x => x.Key.ToLowerInvariant(), x => x.Value!);
    public async Task InitializeAsync(CancellationToken ct)
    {
        await using var db = await database.OpenAsync(ct);
        var stored = await db.ExecuteScalarAsync<string>(new CommandDefinition("SELECT Value FROM ApplicationState WHERE Key='uiApplications'", cancellationToken: ct));
        if (stored is not null) Applications = JsonSerializer.Deserialize<ApplicationFlags>(stored, Json) ?? Applications;
    }
    public async Task SaveAsync(ApplicationFlags flags, CancellationToken ct)
    {
        await using var db = await database.OpenAsync(ct);
        await db.ExecuteAsync(new CommandDefinition("INSERT INTO ApplicationState(Key,Value) VALUES('uiApplications',@value) ON CONFLICT(Key) DO UPDATE SET Value=excluded.Value", new { value = JsonSerializer.Serialize(flags, Json) }, cancellationToken: ct));
        Applications = flags;
    }
}
public static class UiConfigurationEndpoints
{
    public static void MapUiConfiguration(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/ui-configuration", (UiConfiguration settings) => TypedResults.Ok(new UiConfigurationResponse(settings.Applications, settings.Defaults))).WithName("GetUiConfiguration");
        app.MapPut("/api/files/applications", async (ApplicationFlags flags, UiConfiguration settings, CancellationToken ct) =>
        { await settings.SaveAsync(flags, ct); return TypedResults.NoContent(); }).AddEndpointFilter<MutationAccessFilter>().WithName("UpdateApplications");
    }
}
