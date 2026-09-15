using Dapper;
using Luma.Server.Data;
using Luma.Server.Http;

namespace Luma.Server.Features.Status;

public sealed record StatusResponse(string Status, int SchemaVersion);

public static class StatusEndpoints
{
    public static void MapStatus(this WebApplication app) => app.MapGet("/api/status",
        async (Database database, CancellationToken cancellationToken) =>
        {
            await using var connection = await database.OpenAsync(cancellationToken);
            var version = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
                "SELECT COALESCE(MAX(Version), 0) FROM SchemaMigrations;", cancellationToken: cancellationToken));
            return TypedResults.Ok(new StatusResponse("ready", version));
        }).WithName("GetStatus").Produces<ApiProblem>(503, "application/problem+json");
}
