using Microsoft.Data.Sqlite;
using Luma.Server.Features.Media;

namespace Luma.Server.Data;

public sealed class Database(IConfiguration configuration, IHostEnvironment environment)
{
    public string Path { get; } = System.IO.Path.GetFullPath(
        configuration["Luma:DatabasePath"] ?? ".local/luma.db", environment.ContentRootPath);

    public async Task<SqliteConnection> OpenAsync(CancellationToken cancellationToken)
    {
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = Path, Mode = SqliteOpenMode.ReadWriteCreate,
            ForeignKeys = true, DefaultTimeout = 5, Pooling = true
        }.ToString());
        try
        {
            await connection.OpenAsync(cancellationToken);
            // WAL makes NORMAL durable against corruption; skipping the per-commit fsync keeps
            // each write transaction (and so SQLite's single write lock) short on slow storage.
            await using (var pragma = connection.CreateCommand())
            {
                pragma.CommandText = "PRAGMA synchronous=NORMAL;";
                await pragma.ExecuteNonQueryAsync(cancellationToken);
            }
            connection.CreateFunction<string, string>("luma_key", SearchText.Key, isDeterministic: true);
            connection.CreateFunction<string, string>("luma_reverse", SearchText.Reverse, isDeterministic: true);
            connection.CreateFunction<string, long>("luma_ticks", SearchText.Ticks, isDeterministic: true);
            return connection;
        }
        catch
        {
            await connection.DisposeAsync();
            throw;
        }
    }
}
