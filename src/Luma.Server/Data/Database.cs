using Microsoft.Data.Sqlite;
using Luma.Server.Features.Media;

namespace Luma.Server.Data;

public sealed class Database(IConfiguration configuration, IHostEnvironment environment)
{
    // How long a background writer defers to interactive writes before it proceeds anyway,
    // so a steady stream of taps can delay background work but never stall it.
    private const int MaximumYieldMs = 2000;
    private int foregroundWriters;

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
            // SQLite's own busy handler retries within milliseconds of the lock being released;
            // without it the driver polls every 150 ms and loses the lock to background writers
            // that commit and begin again in between.
            await using (var pragma = connection.CreateCommand())
            {
                pragma.CommandText = "PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;";
                await pragma.ExecuteNonQueryAsync(cancellationToken);
            }
            connection.CreateFunction<string, string>("luma_key", SearchText.Key, isDeterministic: true);
            connection.CreateFunction<string, string>("luma_reverse", SearchText.Reverse, isDeterministic: true);
            connection.CreateFunction<string, long>("luma_ticks", SearchText.Ticks, isDeterministic: true);
            // Folder keys, maintained by triggers from a folder's relative path.
            connection.CreateFunction<string, string>("luma_folder_key", path => SearchText.Key(SearchText.FolderName(path)), isDeterministic: true);
            connection.CreateFunction<string, string>("luma_sort_key", path => SearchText.SortKey(SearchText.FolderName(path)), isDeterministic: true);
            return connection;
        }
        catch
        {
            await connection.DisposeAsync();
            throw;
        }
    }

    /// <summary>
    /// Marks an interactive write (a tag, a like) as in flight until disposed. Background
    /// writers check <see cref="YieldToForegroundAsync"/> before each transaction, so the
    /// interactive write takes SQLite's write lock as soon as the current batch commits.
    /// </summary>
    public IDisposable BeginForegroundWrite()
    {
        Interlocked.Increment(ref foregroundWriters);
        return new ForegroundWrite(this);
    }

    public bool ForegroundWritePending => Volatile.Read(ref foregroundWriters) > 0;

    /// <summary>Called by background workers before taking the write lock.</summary>
    public async ValueTask YieldToForegroundAsync(CancellationToken cancellationToken)
    {
        for (var waited = 0; ForegroundWritePending && waited < MaximumYieldMs; waited += 10)
            await Task.Delay(10, cancellationToken);
    }

    public static bool IsBusy(SqliteException error) => error.SqliteErrorCode is 5 or 6;

    private sealed class ForegroundWrite(Database database) : IDisposable
    {
        private int disposed;
        public void Dispose()
        {
            if (Interlocked.Exchange(ref disposed, 1) == 0) Interlocked.Decrement(ref database.foregroundWriters);
        }
    }
}
