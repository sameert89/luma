using Microsoft.Data.Sqlite;

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
            return connection;
        }
        catch
        {
            await connection.DisposeAsync();
            throw;
        }
    }
}
