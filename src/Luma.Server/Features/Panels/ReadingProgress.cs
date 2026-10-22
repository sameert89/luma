using System.Text.Json;
using Dapper;
using Luma.Server.Data;
using Luma.Server.Http;

namespace Luma.Server.Features.Panels;

public sealed record ReadingUpdate(string SessionId, long Sequence, int PageIndex, double ActiveSeconds, string Direction = "ltr", string Settings = "{}");
public sealed record ComicMetadataUpdate(string Title, string Series = "", string Author = "", string Description = "", bool Favourite = false, int CoverPage = 0);
public sealed record ReadingStatistics(long Started, long Completed, double ReadingSeconds, long PagesRead);
public sealed class ComicProgress(Database database, ComicLibrary library)
{
    public async Task UpdateAsync(long id, ReadingUpdate update, CancellationToken ct)
    {
        var comic = await library.GetAsync(id, ct);
        if (!Guid.TryParse(update.SessionId, out _) || update.Sequence < 1 || update.PageIndex < 0 || update.PageIndex >= comic.PageCount ||
            !double.IsFinite(update.ActiveSeconds) || update.ActiveSeconds is < 0 or > 30 || update.Direction is not ("ltr" or "rtl") || update.Settings.Length > 4096)
            throw ApiRequestException.Invalid();
        try
        {
            using var settings = JsonDocument.Parse(update.Settings);
            if (settings.RootElement.ValueKind != JsonValueKind.Object) throw ApiRequestException.Invalid();
        }
        catch (JsonException) { throw ApiRequestException.Invalid(); }
        await using var db = await database.OpenAsync(ct);
        using var tx = db.BeginTransaction();
        var previous = await db.QuerySingleOrDefaultAsync<SessionRow>(new CommandDefinition("SELECT * FROM ReadingSessions WHERE Id=@SessionId", update, tx, cancellationToken: ct));
        if (previous is not null && previous.ComicId != id) throw ApiRequestException.Invalid();
        if (previous is not null && previous.Sequence >= update.Sequence) return;
        var now = DateTimeOffset.UtcNow;
        var seconds = previous is null ? 0 : Math.Min(update.ActiveSeconds, Math.Clamp((now - DateTimeOffset.Parse(previous.UpdatedAt)).TotalSeconds, 0, 30));
        await db.ExecuteAsync(new CommandDefinition("""
            INSERT INTO ReadingProgress(ComicId,PageIndex,State,ReadingSeconds,Direction,LastReadAt,Settings)
              VALUES(@id,@PageIndex,@state,@seconds,@Direction,@now,@Settings)
            ON CONFLICT(ComicId) DO UPDATE SET PageIndex=excluded.PageIndex,State=excluded.State,
              ReadingSeconds=ReadingProgress.ReadingSeconds+excluded.ReadingSeconds,Direction=excluded.Direction,
              LastReadAt=excluded.LastReadAt,Settings=excluded.Settings;
            INSERT INTO ReadingSessions(Id,ComicId,Sequence,UpdatedAt) VALUES(@SessionId,@id,@Sequence,@now)
              ON CONFLICT(Id) DO UPDATE SET Sequence=excluded.Sequence,UpdatedAt=excluded.UpdatedAt;
            DELETE FROM ReadingSessions WHERE UpdatedAt<@cutoff;
            """, new { id, update.PageIndex, update.Direction, update.Settings, update.SessionId, update.Sequence, seconds, state = update.PageIndex == comic.PageCount - 1 ? "completed" : "reading", now = now.ToString("O"), cutoff = now.AddDays(-30).ToString("O") }, tx, cancellationToken: ct));
        tx.Commit();
    }
    public async Task<ReadingStatistics> StatisticsAsync(CancellationToken ct)
    {
        await using var db = await database.OpenAsync(ct);
        return await db.QuerySingleAsync<ReadingStatistics>(new CommandDefinition("SELECT COUNT(*) Started,COALESCE(SUM(State='completed'),0) Completed,CAST(COALESCE(SUM(ReadingSeconds),0.0) AS REAL) ReadingSeconds,COALESCE(SUM(PageIndex+1),0) PagesRead FROM ReadingProgress", cancellationToken: ct));
    }
    private sealed class SessionRow { public long ComicId { get; set; } public long Sequence { get; set; } public string UpdatedAt { get; set; } = ""; }
}
