using System.Text.Json;
using Dapper;
using Luma.Server.Features.Indexing;
using Microsoft.Data.Sqlite;

namespace Luma.Server.Features.Panels;

internal sealed record ComicCoverScope(long LibraryId, string RelativePath);
internal static class ComicShelfCovers
{
    // One bounded statement for every visible card, with five cached covers per indexed subtree.
    public static async Task<Dictionary<(long, string), string[]>> LoadAsync(SqliteConnection db, IndexingOptions options, IEnumerable<ComicCoverScope> locations, CancellationToken ct)
    {
        var scopes = locations.Where(x => options.Libraries.Any(l => l.Id == x.LibraryId)).Distinct().Select(location =>
        {
            var root = options.Libraries.Find(x => x.Id == location.LibraryId)!;
            var key = root.Key(location.RelativePath);
            return new { location.LibraryId, location.RelativePath, key, prefix = key.Length == 0 ? "" : key + "/", end = key.Length == 0 ? "\U0010FFFF" : key + "0" };
        }).ToArray();
        if (scopes.Length == 0) return [];
        var rows = await db.QueryAsync<CoverRow>(new CommandDefinition("""
            SELECT json_extract(scope.value,'$.LibraryId') LibraryId,json_extract(scope.value,'$.RelativePath') RelativePath,c.Id,c.Revision
            FROM json_each(@scopes) scope CROSS JOIN Comics c ON c.Id IN (
                SELECT candidate.Id FROM Comics candidate JOIN ComicCache cache ON cache.ComicId=candidate.Id AND cache.Revision=candidate.Revision AND cache.Variant='cover'
                WHERE candidate.LibraryId=json_extract(scope.value,'$.LibraryId') AND candidate.Availability='present'
                  AND (candidate.PathKey=json_extract(scope.value,'$.key') OR (candidate.PathKey>=json_extract(scope.value,'$.prefix') AND candidate.PathKey<json_extract(scope.value,'$.end')))
                  AND candidate.LibraryId IN (SELECT Id FROM Libraries WHERE Enabled=1)
                  AND (NOT EXISTS(SELECT 1 FROM ApplicationState WHERE Key='panelSourcesConfigured') OR EXISTS(
                    SELECT 1 FROM PanelSources s WHERE s.LibraryId=candidate.LibraryId AND (s.PathKey='' OR candidate.PathKey=s.PathKey OR (candidate.PathKey>=s.PathKey||'/' AND candidate.PathKey<s.PathKey||'0'))))
                ORDER BY candidate.Id DESC LIMIT 5)
            ORDER BY c.Id DESC
            """, new { scopes = JsonSerializer.Serialize(scopes) }, cancellationToken: ct));
        return rows.GroupBy(x => (x.LibraryId, x.RelativePath)).ToDictionary(x => x.Key, x => x.Select(row => $"/api/panels/comics/{row.Id}/cover?v={row.Revision}").ToArray());
    }
    private sealed class CoverRow
    {
        public long LibraryId { get; set; }
        public string RelativePath { get; set; } = "";
        public long Id { get; set; }
        public int Revision { get; set; }
    }
}
