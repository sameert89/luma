using System.Reflection;
using Dapper;
using Luma.Server.Data;
using Luma.Server.Http;

namespace Luma.Server.Features.Status;

public sealed record StatusResponse(string Status, int SchemaVersion, string Version);

public static class StatusEndpoints
{
    // The running build's release number. A browser tab holding an older build compares it with
    // its own and offers a refresh, which is all a self-hosted update needs once the server restarts.
    public static readonly string Release = typeof(StatusEndpoints).Assembly
        .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0]
        ?? typeof(StatusEndpoints).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";

    public static void MapStatus(this IEndpointRouteBuilder app) => app.MapGet("/api/status",
        async (Database database, CancellationToken cancellationToken) =>
        {
            await using var connection = await database.OpenAsync(cancellationToken);
            var version = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
                "SELECT COALESCE(MAX(Version), 0) FROM SchemaMigrations;", cancellationToken: cancellationToken));
            return TypedResults.Ok(new StatusResponse("ready", version, Release));
        }).WithName("GetStatus").Produces<ApiProblem>(503, "application/problem+json");
}
