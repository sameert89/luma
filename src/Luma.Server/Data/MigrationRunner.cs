using System.Security.Cryptography;
using System.Text;
using Dapper;

namespace Luma.Server.Data;

public sealed class MigrationRunner(Database database)
{
    public async Task ApplyAsync(CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(database.Path)!);
        await using var connection = await database.OpenAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition("PRAGMA journal_mode=WAL;", cancellationToken: cancellationToken));
        using var transaction = connection.BeginTransaction();
        await connection.ExecuteAsync(new CommandDefinition("""
            CREATE TABLE IF NOT EXISTS SchemaMigrations (
                Version INTEGER PRIMARY KEY, Checksum TEXT NOT NULL, AppliedAt TEXT NOT NULL
            );
            """, transaction: transaction, cancellationToken: cancellationToken));
        var applied = (await connection.QueryAsync<AppliedMigration>(new CommandDefinition(
            "SELECT Version, Checksum FROM SchemaMigrations ORDER BY Version;",
            transaction: transaction, cancellationToken: cancellationToken))).ToDictionary(row => row.Version);
        var assembly = typeof(MigrationRunner).Assembly;
        var resources = assembly.GetManifestResourceNames()
            .Where(name => name.Contains(".Data.Migrations.") && name.EndsWith(".sql"))
            .Order(StringComparer.Ordinal).ToArray();
        if (applied.Keys.Any(version => version < 1 || version > resources.Length))
            throw new InvalidOperationException("Database schema is newer than or incompatible with this application.");
        for (var index = 0; index < resources.Length; index++)
        {
            var version = index + 1;
            using var reader = new StreamReader(assembly.GetManifestResourceStream(resources[index])!);
            var sql = (await reader.ReadToEndAsync(cancellationToken)).Replace("\r\n", "\n");
            var checksum = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(sql)));
            if (applied.TryGetValue(version, out var existing))
            {
                if (existing.Checksum != checksum) throw new InvalidOperationException($"Migration {version} checksum mismatch.");
                continue;
            }
            await connection.ExecuteAsync(new CommandDefinition(sql, transaction: transaction, cancellationToken: cancellationToken));
            await connection.ExecuteAsync(new CommandDefinition(
                "INSERT INTO SchemaMigrations (Version, Checksum, AppliedAt) VALUES (@version, @checksum, @appliedAt);",
                new { version, checksum, appliedAt = DateTimeOffset.UtcNow.ToString("O") }, transaction,
                cancellationToken: cancellationToken));
        }
        transaction.Commit();
    }

    private sealed record AppliedMigration(long Version, string Checksum);
}
