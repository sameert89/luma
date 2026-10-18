using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Dapper;
using Luma.Server.Data;
using Luma.Server.Features.Indexing;
using Luma.Server.Http;
using Luma.Server.MediaProcessing;

namespace Luma.Server.Features.Captions;

public sealed record CaptionTrack(string Id, string Label, string Language, string Kind);
public sealed record CaptionList(string SourceKey, IReadOnlyList<CaptionTrack> Tracks, string? Warning);

// No indexing hooks: only explicit caption requests may touch source media or invoke tools.
public sealed class CaptionContent(Database database, IndexingOptions options)
{
    private readonly SemaphoreSlim slot = new(1, 1);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private const long Quota = 128L * 1024 * 1024;

    public Task<CaptionList> ListAsync(long id, CancellationToken ct) => LockedAsync(async token =>
    {
        var source = await SourceAsync(id, token);
        return await DiscoverAsync(source, token);
    }, ct);

    public Task<IResult> ServeAsync(long id, string trackId, string key, CancellationToken ct) => LockedAsync<IResult>(async token =>
    {
        if (key.Length != 64 || key.Any(c => !char.IsAsciiHexDigit(c)) || trackId.Length > 32) throw ApiRequestException.Invalid();
        var source = await SourceAsync(id, token);
        if (key != source.Key) throw new ApiRequestException(409, "captions_changed", "This video's captions changed. Turn captions off and on to refresh them.");
        var manifest = await DiscoverAsync(source, token);
        var track = manifest.Tracks.FirstOrDefault(x => x.Id == trackId) ?? throw ApiRequestException.Missing();
        var cached = await CachedAsync(id, key, trackId, token);
        if (cached is null)
        {
            var directory = Path.Combine(options.CachePath, "captions");
            Directory.CreateDirectory(directory);
            var raw = Path.Combine(directory, Guid.NewGuid().ToString("N") + ".srt.part");
            try
            {
                await using var lookup = await database.OpenAsync(token);
                var retainedRaw = await lookup.ExecuteScalarAsync<string>(new CommandDefinition("SELECT RawRelativePath FROM CaptionCache WHERE MediaId=@id AND SourceKey=@key AND TrackId=@trackId", new { id, key, trackId }, cancellationToken: token));
                if (retainedRaw is not null && File.Exists(Path.Combine(options.CachePath, retainedRaw)))
                    await File.WriteAllBytesAsync(raw, await ReadSrtAsync(Path.Combine(options.CachePath, retainedRaw), token), token);
                else if (track.Kind == "sidecar")
                    await File.WriteAllBytesAsync(raw, await ReadSrtAsync(source.Sidecar!, token), token);
                else
                {
                    await options.ProcessingSlots.WaitAsync(token);
                    try
                    {
                        await MediaProcessor.RunAsync(options.FfmpegPath,
                            ["-v", "error", "-nostdin", "-y", "-threads", "1", "-max_alloc", "67108864", "-protocol_whitelist", "file", "-f", Demuxer(source.Path), "-i", source.Path,
                             "-map", $"0:{track.Id[9..]}", "-vn", "-an", "-c:s", "copy", "-fs", (SrtCaptions.MaximumBytes + 1).ToString(System.Globalization.CultureInfo.InvariantCulture), "-f", "srt", raw], token);
                    }
                    finally { options.ProcessingSlots.Release(); }
                }
                var vtt = SrtCaptions.Convert(await ReadSrtAsync(raw, token));
                // Recheck the selected source after conversion, before publishing a reusable asset.
                if ((await SourceAsync(id, token)).Key != key) throw new ApiRequestException(409, "captions_changed", "Caption sources changed during preparation. Try again.");
                cached = await PublishAsync(id, key, trackId, Encoding.UTF8.GetBytes(vtt), "vtt", raw, token);
            }
            finally { File.Delete(raw); }
        }
        // Open before releasing the slot: eviction cannot remove a file between lookup and serving.
        var stream = new FileStream(cached, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete, 16 * 1024, FileOptions.Asynchronous);
        return Results.File(stream, "text/vtt; charset=utf-8");
    }, ct);

    private async Task<T> LockedAsync<T>(Func<CancellationToken, Task<T>> action, CancellationToken ct)
    {
        if (!await slot.WaitAsync(TimeSpan.FromSeconds(2), ct))
            throw new ApiRequestException(503, "captions_busy", "Caption preparation is busy. Try again shortly.");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(30));
        try { return await action(deadline.Token); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested) { throw new ApiRequestException(504, "captions_timeout", "Caption preparation timed out. Playback can continue without captions."); }
        catch (ProcessingException) { throw new ApiRequestException(422, "captions_unavailable", "This subtitle track could not be extracted. Only embedded SubRip/SRT and matching SRT sidecars are supported."); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        { throw new ApiRequestException(503, "captions_unavailable", "Caption sources or cache are unavailable. Playback can continue without captions."); }
        finally { slot.Release(); }
    }

    private async Task<Source> SourceAsync(long id, CancellationToken ct)
    {
        await using var db = await database.OpenAsync(ct);
        var row = await db.QuerySingleOrDefaultAsync<SourceRow>(new CommandDefinition("""
            SELECT m.Id,m.LibraryId,m.RelativePath,m.SourceRevision FROM Media m JOIN Libraries l ON l.Id=m.LibraryId
            WHERE m.Id=@id AND m.MediaType='video' AND m.Availability='present' AND l.Enabled=1
            """, new { id }, cancellationToken: ct)) ?? throw ApiRequestException.Missing();
        var root = options.Libraries.Find(x => x.Id == row.LibraryId) ?? throw ApiRequestException.Missing();
        var path = SourcePaths.Resolve(root, row.RelativePath);
        var info = new FileInfo(path);
        string? sidecar = null;
        foreach (var extension in new[] { ".srt", ".SRT" })
        {
            var relative = Path.ChangeExtension(row.RelativePath, extension);
            if (!File.Exists(Path.Combine(root.Path, relative))) continue;
            sidecar = SourcePaths.Resolve(root, relative);
            break;
        }
        var sideInfo = sidecar is null ? null : new FileInfo(sidecar);
        var stamp = $"{row.RelativePath}|{row.SourceRevision}|{info.Length}|{info.LastWriteTimeUtc.Ticks}|{sideInfo?.Length}|{sideInfo?.LastWriteTimeUtc.Ticks}";
        return new(row.Id, path, sidecar, Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(stamp))));
    }

    private async Task<CaptionList> DiscoverAsync(Source source, CancellationToken ct)
    {
        var cached = await CachedAsync(source.Id, source.Key, "manifest", ct);
        if (cached is not null && new FileInfo(cached).Length <= 65_536)
        {
            try
            {
                var manifest = JsonSerializer.Deserialize<CaptionList>(await File.ReadAllTextAsync(cached, ct), Json);
                if (manifest is not null && manifest.SourceKey == source.Key && manifest.Tracks.Count <= 16) return manifest;
            }
            catch (JsonException) { }
        }
        var tracks = new List<CaptionTrack>();
        if (source.Sidecar is not null) tracks.Add(new("sidecar", "External SRT", "und", "sidecar"));
        string? warning = null;
        try
        {
            await options.ProcessingSlots.WaitAsync(ct);
            string output;
            try
            {
                output = await MediaProcessor.RunAsync(options.FfprobePath,
                    ["-v", "error", "-threads", "1", "-max_alloc", "67108864", "-protocol_whitelist", "file", "-f", Demuxer(source.Path),
                     "-select_streams", "s", "-show_entries", "stream=index,codec_name:stream_tags=language,title", "-of", "json", source.Path], ct);
            }
            finally { options.ProcessingSlots.Release(); }
            using var json = JsonDocument.Parse(output);
            if (json.RootElement.TryGetProperty("streams", out var streams))
                foreach (var stream in streams.EnumerateArray())
                {
                    if (tracks.Count >= 16) break;
                    if (!stream.TryGetProperty("codec_name", out var codec) || codec.GetString() != "subrip") continue;
                    if (!stream.TryGetProperty("index", out var index) || !index.TryGetInt32(out var number) || number is < 0 or > 1024) continue;
                    string? language = null, title = null;
                    if (stream.TryGetProperty("tags", out var tags))
                    {
                        if (tags.TryGetProperty("language", out var lang)) language = lang.GetString();
                        if (tags.TryGetProperty("title", out var name)) title = name.GetString();
                    }
                    language = language is { Length: >= 2 and <= 16 } && language.All(c => char.IsAsciiLetter(c) || c == '-') ? language : "und";
                    var label = string.IsNullOrWhiteSpace(title) ? $"Embedded SRT {number} ({language})" : title[..Math.Min(title.Length, 100)];
                    tracks.Add(new($"embedded-{number}", label, language, "embedded"));
                }
        }
        catch (Exception error) when (error is ProcessingException or JsonException or NotSupportedException)
        { warning = "Embedded SRT tracks could not be inspected. Matching external SRT captions can still be used."; }
        var result = new CaptionList(source.Key, tracks, warning);
        // Do not retain a tool failure: a later explicit enable should retry after tools are restored.
        if (warning is null) await PublishAsync(source.Id, source.Key, "manifest", JsonSerializer.SerializeToUtf8Bytes(result, Json), "json", null, ct);
        return result;
    }

    private async Task<string?> CachedAsync(long id, string key, string track, CancellationToken ct)
    {
        await using var db = await database.OpenAsync(ct);
        var relative = await db.ExecuteScalarAsync<string>(new CommandDefinition("SELECT RelativePath FROM CaptionCache WHERE MediaId=@id AND SourceKey=@key AND TrackId=@track", new { id, key, track }, cancellationToken: ct));
        if (relative is null || !File.Exists(Path.Combine(options.CachePath, relative))) return null;
        var length = new FileInfo(Path.Combine(options.CachePath, relative)).Length;
        if (length <= 0 || length > (track == "manifest" ? 65_536 : SrtCaptions.MaximumVttBytes)) return null;
        await db.ExecuteAsync(new CommandDefinition("UPDATE CaptionCache SET LastAccessAt=@now WHERE MediaId=@id AND SourceKey=@key AND TrackId=@track", new { id, key, track, now = DateTimeOffset.UtcNow.ToString("O") }, cancellationToken: ct));
        return Path.Combine(options.CachePath, relative);
    }

    private async Task<string> PublishAsync(long id, string key, string track, byte[] bytes, string extension, string? raw, CancellationToken ct)
    {
        var directory = Path.Combine(options.CachePath, "captions");
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, Guid.NewGuid().ToString("N") + "." + extension);
        var rawPath = raw is null ? null : Path.ChangeExtension(path, "srt");
        try
        {
            await File.WriteAllBytesAsync(path + ".part", bytes, ct);
            File.Move(path + ".part", path);
            if (rawPath is not null) File.Copy(raw!, rawPath);
            await using var db = await database.OpenAsync(ct);
            await db.ExecuteAsync(new CommandDefinition("""
                INSERT INTO CaptionCache(MediaId,SourceKey,TrackId,RelativePath,RawRelativePath,SizeBytes,LastAccessAt)
                VALUES(@id,@key,@track,@relative,@rawRelative,@size,@now)
                ON CONFLICT(MediaId,SourceKey,TrackId) DO UPDATE SET RelativePath=excluded.RelativePath,RawRelativePath=excluded.RawRelativePath,SizeBytes=excluded.SizeBytes,LastAccessAt=excluded.LastAccessAt
                """, new { id, key, track, relative = Path.GetRelativePath(options.CachePath, path), rawRelative = rawPath is null ? null : Path.GetRelativePath(options.CachePath, rawPath), size = bytes.LongLength + (raw is null ? 0 : new FileInfo(raw).Length), now = DateTimeOffset.UtcNow.ToString("O") }, cancellationToken: ct));
            // Bound both disk usage and tiny cached manifests. Never evict the asset being served.
            while (await db.ExecuteScalarAsync<bool>(new CommandDefinition("SELECT COUNT(*)>512 OR COALESCE(SUM(SizeBytes),0)>@Quota FROM CaptionCache", new { Quota }, cancellationToken: ct)))
            {
                var victim = await db.QueryFirstOrDefaultAsync<CacheRow>(new CommandDefinition("SELECT RelativePath,RawRelativePath FROM CaptionCache WHERE RelativePath<>@relative ORDER BY LastAccessAt LIMIT 1", new { relative = Path.GetRelativePath(options.CachePath, path) }, cancellationToken: ct));
                if (victim is null) break;
                File.Delete(Path.Combine(options.CachePath, victim.RelativePath));
                if (victim.RawRelativePath is not null) File.Delete(Path.Combine(options.CachePath, victim.RawRelativePath));
                await db.ExecuteAsync(new CommandDefinition("DELETE FROM CaptionCache WHERE RelativePath=@RelativePath", victim, cancellationToken: ct));
            }
            return path;
        }
        catch { File.Delete(path); if (rawPath is not null) File.Delete(rawPath); throw; }
        finally { File.Delete(path + ".part"); }
    }

    private static async Task<byte[]> ReadSrtAsync(string path, CancellationToken ct)
    {
        await using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete, 16 * 1024, FileOptions.Asynchronous);
        if (file.Length > SrtCaptions.MaximumBytes) throw new ApiRequestException(422, "caption_size_limit", "SRT captions are limited to 4 MiB.");
        var buffer = new byte[SrtCaptions.MaximumBytes + 1];
        var length = 0;
        int read;
        while (length < buffer.Length && (read = await file.ReadAsync(buffer.AsMemory(length), ct)) != 0) length += read;
        if (length > SrtCaptions.MaximumBytes) throw new ApiRequestException(422, "caption_size_limit", "SRT captions are limited to 4 MiB.");
        return buffer[..length];
    }
    private static string Demuxer(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".mkv" or ".webm" => "matroska",
        ".mp4" or ".mov" or ".m4v" => "mov",
        ".avi" => "avi",
        _ => throw new NotSupportedException("Unsupported caption container.")
    };
    private sealed record SourceRow(long Id, long LibraryId, string RelativePath, long SourceRevision);
    private sealed record Source(long Id, string Path, string? Sidecar, string Key);
    private sealed record CacheRow(string RelativePath, string? RawRelativePath);
}
