using System.Text;
using Dapper;
using Luma.Server.Features.Captions;
using Luma.Server.Http;
using Luma.Server.MediaProcessing;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Luma.Server.Tests;

public sealed class CaptionTests
{
    private const string Srt = "1\r\n00:00:00,100 --> 00:00:01,500\r\n{\\an8}<font color=\"red\"><b>Hello</b></font> &amp; goodbye\r\nSecond line\r\n\r\n";
    [Fact]
    public void Srt_conversion_preserves_timing_and_multiline_text_without_author_styling()
    {
        var vtt = SrtCaptions.Convert(Encoding.UTF8.GetBytes(Srt));
        Assert.StartsWith("WEBVTT\n\n00:00:00.100 --> 00:00:01.500\n", vtt);
        Assert.Contains("Hello &amp; goodbye\nSecond line", vtt);
        Assert.DoesNotContain("<b>", vtt);
        Assert.DoesNotContain("font", vtt);
        Assert.DoesNotContain("an8", vtt);
        var unicode = Encoding.Unicode.GetPreamble().Concat(Encoding.Unicode.GetBytes(Srt)).ToArray();
        Assert.Equal(vtt, SrtCaptions.Convert(unicode));
    }
    [Theory]
    [InlineData("not subtitles")]
    [InlineData("1\n00:00:02,000 --> 00:00:01,000\nbad")]
    [InlineData("1\n00:99:02,000 --> 00:00:03,000\nbad")]
    [InlineData("1\n00:00:00,000 --> 00:00:01,000\nbad\0")]
    public void Malformed_srt_is_rejected(string text) =>
        Assert.Equal("invalid_srt", Assert.Throws<ApiRequestException>(() => SrtCaptions.Convert(Encoding.UTF8.GetBytes(text))).Code);

    [Fact]
    public void Oversize_and_invalid_encoding_are_rejected()
    {
        Assert.Throws<ApiRequestException>(() => SrtCaptions.Convert(new byte[SrtCaptions.MaximumBytes + 1]));
        Assert.Throws<ApiRequestException>(() => SrtCaptions.Convert([0xff, 0xff, 0xff]));
    }

    private static async Task<long> MovieAsync(PipelineFixture f)
    {
        var input = Path.Combine(f.DirectoryPath, "input.srt");
        await File.WriteAllTextAsync(input, Srt);
        await MediaProcessor.RunAsync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=64x48:r=2", "-i", input,
            "-map", "0:v", "-map", "1:0", "-map", "1:0", "-c:v", "mpeg4", "-threads", "1", "-c:s:0", "subrip", "-c:s:1", "ass", "-t", "2", Path.Combine(f.Root.Path, "movie.mkv")], default);
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "movie.srt"), Srt);
        await f.ScanAsync();
        await using var db = await f.Database.OpenAsync(default);
        return await db.ExecuteScalarAsync<long>("SELECT Id FROM Media WHERE FileName='movie.mkv'");
    }
    private static async Task<string> ReadAsync(CaptionContent captions, long id, CaptionList list, string track)
    {
        var result = Assert.IsType<FileStreamHttpResult>(await captions.ServeAsync(id, track, list.SourceKey, default));
        Assert.Equal("text/vtt; charset=utf-8", result.ContentType);
        await using var stream = result.FileStream;
        using var reader = new StreamReader(stream);
        return await reader.ReadToEndAsync();
    }
    [Fact]
    public async Task Discovery_is_opt_in_and_only_srt_tracks_are_extracted_into_reusable_cache()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var id = await MovieAsync(f);
        await using var db = await f.Database.OpenAsync(default);
        Assert.Equal(0, await db.ExecuteScalarAsync<long>("SELECT COUNT(*) FROM CaptionCache"));
        Assert.False(Directory.Exists(Path.Combine(f.Options.CachePath, "captions")));
        var service = new CaptionContent(f.Database, f.Options);
        var list = await service.ListAsync(id, default);
        Assert.Equal(2, list.Tracks.Count); // Sidecar + embedded SubRip; embedded ASS is ignored.
        var embedded = Assert.Single(list.Tracks, x => x.Kind == "embedded");
        Assert.Contains("Hello", await ReadAsync(service, id, list, embedded.Id));
        Assert.Contains("Second line", await ReadAsync(service, id, list, "sidecar"));
        Assert.Equal(new[] { "movie.mkv", "movie.srt" }, Directory.EnumerateFiles(f.Root.Path).Select(Path.GetFileName).Order());
        var raw = (await db.QueryAsync<string>("SELECT RawRelativePath FROM CaptionCache WHERE RawRelativePath IS NOT NULL")).ToArray();
        Assert.Equal(2, raw.Length);
        Assert.All(raw, path => Assert.True(File.Exists(Path.Combine(f.Options.CachePath, path))));
        foreach (var asset in Directory.EnumerateFiles(Path.Combine(f.Options.CachePath, "captions")))
            File.SetLastWriteTimeUtc(asset, DateTime.UtcNow.AddHours(-1));
        var orphan = Path.Combine(f.Options.CachePath, "caption-orphan.srt");
        await File.WriteAllTextAsync(orphan, "orphan");
        File.SetLastWriteTimeUtc(orphan, DateTime.UtcNow.AddHours(-1));
        await f.Cache.MaintainAsync(default);
        Assert.False(File.Exists(orphan));
        Assert.All(raw, path => Assert.True(File.Exists(Path.Combine(f.Options.CachePath, path))));
        // Neither discovery nor repeated playback needs the tools once assets are cached.
        f.Options.FfmpegPath = f.Options.FfprobePath = "missing-caption-tool";
        var again = await service.ListAsync(id, default);
        Assert.Equal(list.SourceKey, again.SourceKey);
        Assert.Contains("Hello", await ReadAsync(service, id, again, embedded.Id));
        var converted = await db.ExecuteScalarAsync<string>("SELECT RelativePath FROM CaptionCache WHERE TrackId=@Id", embedded);
        Assert.NotNull(converted);
        File.Delete(Path.Combine(f.Options.CachePath, converted));
        Assert.Contains("Hello", await ReadAsync(service, id, again, embedded.Id)); // Reconvert retained raw SRT.
    }
    [Fact]
    public async Task Sidecar_changes_invalidate_assets_and_subtitle_links_are_rejected()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var id = await MovieAsync(f);
        var service = new CaptionContent(f.Database, f.Options);
        var list = await service.ListAsync(id, default);
        await File.AppendAllTextAsync(Path.Combine(f.Root.Path, "movie.srt"), "\n");
        var changed = await Assert.ThrowsAsync<ApiRequestException>(() => service.ServeAsync(id, "sidecar", list.SourceKey, default));
        Assert.Equal("captions_changed", changed.Code);
        var next = await service.ListAsync(id, default);
        Assert.NotEqual(list.SourceKey, next.SourceKey);
        await Assert.ThrowsAsync<ApiRequestException>(() => service.ServeAsync(id, "embedded-999", next.SourceKey, default));
        if (!OperatingSystem.IsWindows())
        {
            File.Delete(Path.Combine(f.Root.Path, "movie.srt"));
            File.CreateSymbolicLink(Path.Combine(f.Root.Path, "movie.srt"), Path.Combine(f.DirectoryPath, "input.srt"));
            await Assert.ThrowsAsync<ApiRequestException>(() => service.ListAsync(id, default));
        }
    }
}
