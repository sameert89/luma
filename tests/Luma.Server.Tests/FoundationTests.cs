using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Status;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;

namespace Luma.Server.Tests;

public sealed class FoundationTests
{
    [Fact]
    public async Task Fresh_database_is_ready_and_restart_preserves_identity()
    {
        await using var factory = new LumaFactory();
        using var client = factory.CreateClient();
        var status = await client.GetFromJsonAsync<StatusResponse>("/api/status");
        Assert.Equal(new StatusResponse("ready", 22, StatusEndpoints.Release), status);
        Assert.Matches(@"^\d+\.\d+\.\d+$", status!.Version);
        await using var connection = await factory.Services.GetRequiredService<Database>().OpenAsync(default);
        var identity = await connection.ExecuteScalarAsync<string>("SELECT Value FROM ApplicationState WHERE Key='instanceId'");
        await factory.Services.GetRequiredService<MigrationRunner>().ApplyAsync(default);
        Assert.Equal(identity, await connection.ExecuteScalarAsync<string>("SELECT Value FROM ApplicationState WHERE Key='instanceId'"));
        Assert.Equal(22, await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SchemaMigrations"));
        Assert.Equal("wal", await connection.ExecuteScalarAsync<string>("PRAGMA journal_mode"));
        Assert.Equal(1, await connection.ExecuteScalarAsync<int>("PRAGMA foreign_keys"));
    }

    [Theory]
    [InlineData("GET", "/api/unknown", 404, "not_found")]
    [InlineData("POST", "/api/status", 405, "method_not_allowed")]
    public async Task Api_errors_use_common_contract(string method, string path, int status, string code)
    {
        await using var factory = new LumaFactory();
        using var client = factory.CreateClient();
        using var response = await client.SendAsync(new HttpRequestMessage(new HttpMethod(method), path));
        Assert.Equal(status, (int)response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(code, problem.GetProperty("code").GetString());
        Assert.False(string.IsNullOrWhiteSpace(problem.GetProperty("traceId").GetString()));
    }

    [Fact]
    public async Task Database_failure_is_sanitized()
    {
        await using var factory = new LumaFactory();
        using var client = factory.CreateClient();
        await using var connection = await factory.Services.GetRequiredService<Database>().OpenAsync(default);
        await connection.ExecuteAsync("DROP TABLE SchemaMigrations");
        var response = await client.GetAsync("/api/status");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("database_unavailable", body);
        Assert.DoesNotContain("SchemaMigrations", body);
        Assert.DoesNotContain(factory.DatabasePath, body);
    }

    [Theory]
    [InlineData("UPDATE SchemaMigrations SET Checksum='changed'")]
    [InlineData("INSERT INTO SchemaMigrations VALUES (999, 'unknown', 'now')")]
    public async Task Incompatible_migration_history_is_rejected(string sql)
    {
        await using var factory = new LumaFactory();
        using var client = factory.CreateClient();
        await using var connection = await factory.Services.GetRequiredService<Database>().OpenAsync(default);
        await connection.ExecuteAsync(sql);
        await Assert.ThrowsAsync<InvalidOperationException>(() => factory.Services.GetRequiredService<MigrationRunner>().ApplyAsync(default));
    }

    [Fact]
    public async Task Failed_migration_rolls_back_history_creation()
    {
        await using var factory = new LumaFactory();
        Directory.CreateDirectory(Path.GetDirectoryName(factory.DatabasePath)!);
        await using var connection = new SqliteConnection($"Data Source={factory.DatabasePath}");
        await connection.OpenAsync();
        await connection.ExecuteAsync("CREATE TABLE ApplicationState (Key TEXT)");
        var error = Assert.Throws<SqliteException>(() => factory.CreateClient());
        Assert.Contains("ApplicationState", error.Message);
        Assert.Equal(0, await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM sqlite_master WHERE name='SchemaMigrations'"));
    }

    [Fact]
    public async Task Cancelled_migration_does_not_change_the_database()
    {
        await using var factory = new LumaFactory();
        using var client = factory.CreateClient();
        using var cancellation = new CancellationTokenSource();
        await cancellation.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            factory.Services.GetRequiredService<MigrationRunner>().ApplyAsync(cancellation.Token));
        Assert.Equal(new StatusResponse("ready", 22, StatusEndpoints.Release), await client.GetFromJsonAsync<StatusResponse>("/api/status"));
    }
}

internal sealed class LumaFactory : WebApplicationFactory<Program>
{
    public string DatabasePath { get; } = Path.Combine(Path.GetTempPath(), "luma-tests", Guid.NewGuid().ToString("N"), "test.db");
    protected override void ConfigureWebHost(IWebHostBuilder builder) =>
        builder.UseEnvironment("Testing").UseSetting("Luma:DatabasePath", DatabasePath);

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        SqliteConnection.ClearAllPools();
        // Each test owns only this unique temporary directory.
        Directory.Delete(Path.GetDirectoryName(DatabasePath)!, recursive: true);
    }
}
