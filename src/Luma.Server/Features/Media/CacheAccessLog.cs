using System.Text.Json;
using System.Threading.Channels;
using Dapper;
using Luma.Server.Data;

namespace Luma.Server.Features.Media;

public sealed class CacheAccessLog(Database database) : BackgroundService
{
    private readonly Channel<long> accessed=Channel.CreateBounded<long>(new BoundedChannelOptions(1024){FullMode=BoundedChannelFullMode.DropWrite,SingleReader=true});
    public void Record(long id)=>accessed.Writer.TryWrite(id);
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        using var timer=new PeriodicTimer(TimeSpan.FromSeconds(10));
        while(await timer.WaitForNextTickAsync(ct))
        {
            var batch=new HashSet<long>();
            for(var count=0;count<200 && accessed.Reader.TryRead(out var id);count++) batch.Add(id);
            if(batch.Count==0) continue;
            try
            {
                await database.YieldToForegroundAsync(ct);
                await using var db=await database.OpenAsync(ct);
                await db.ExecuteAsync(new CommandDefinition("""
                    UPDATE CacheEntries SET LastAccessAt=@now WHERE MediaId IN (SELECT value FROM json_each(@ids)) AND LastAccessAt<@cutoff
                    """,new{ids=JsonSerializer.Serialize(batch),now=DateTimeOffset.UtcNow.ToString("O"),cutoff=DateTimeOffset.UtcNow.AddHours(-1).ToString("O")},cancellationToken:ct));
            }
            catch(Microsoft.Data.Sqlite.SqliteException) { /* LRU hints are disposable under database pressure. */ }
        }
    }
}
