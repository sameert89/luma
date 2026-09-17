using System.Diagnostics;
using System.Globalization;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Collections.Concurrent;
using Luma.Server.Features.Indexing;

namespace Luma.Server.MediaProcessing;

public sealed class ProcessingException(string code, bool transient = false) : Exception(code)
{
    public string Code { get; } = code;
    public bool Transient { get; } = transient;
}
public sealed record MediaMetadata(int Width, int Height, long? DurationMs, string? CapturedAt);
public sealed record GeneratedVariant(string Variant, string TemporaryPath, int Width, int Height);

// A job invokes child processes sequentially, within its caller's aggregate and type limits.
public sealed class MediaProcessor(IndexingOptions options) : IDisposable
{
    private readonly SemaphoreSlim workerSlots = new(options.ProcessingWorkers, options.ProcessingWorkers);
    private readonly ConcurrentBag<ImageWorker> idleWorkers = [];

    private sealed class ImageWorker(Process process)
    {
        public Process Process { get; } = process;
        public int Requests { get; set; }
    }

    private async Task<string> DecodeAsync(string[] args, CancellationToken ct)
    {
        await workerSlots.WaitAsync(ct);
        ImageWorker? worker = null;
        try
        {
            if (!idleWorkers.TryTake(out worker))
            {
                var assembly = typeof(MediaProcessor).Assembly;
                var apphost = Assembly.GetEntryAssembly() == assembly && Path.GetFileNameWithoutExtension(Environment.ProcessPath) != "dotnet";
                var process = new Process { StartInfo = new ProcessStartInfo(apphost ? Environment.ProcessPath! : "dotnet")
                { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true } };
                if (!apphost) process.StartInfo.ArgumentList.Add(assembly.Location);
                process.StartInfo.ArgumentList.Add("--image-worker");
                worker = new(process);
                try { process.Start(); }
                catch (System.ComponentModel.Win32Exception) { process.Dispose(); worker = null; throw new ProcessingException("tool_unavailable", true); }
            }
            using var registration = ct.Register(() => Kill(worker.Process));
            await worker.Process.StandardInput.WriteLineAsync(JsonSerializer.Serialize(args).AsMemory(), ct);
            await worker.Process.StandardInput.FlushAsync(ct);
            var response = await worker.Process.StandardOutput.ReadLineAsync(ct);
            ct.ThrowIfCancellationRequested();
            if (response is null || response.Length > 524288) throw new ProcessingException("invalid_generated_media");
            worker.Requests++;
            if (worker.Requests < 128)
            {
                registration.Dispose();
                idleWorkers.Add(worker);
                worker = null;
            }
            return response;
        }
        finally
        {
            if (worker is not null)
            {
                Kill(worker.Process);
                await worker.Process.WaitForExitAsync(CancellationToken.None);
                worker.Process.Dispose();
            }
            workerSlots.Release();
        }
    }

    public void Dispose()
    {
        while (idleWorkers.TryTake(out var worker))
        {
            Kill(worker.Process);
            worker.Process.WaitForExit();
            worker.Process.Dispose();
        }
        workerSlots.Dispose();
    }

    public async Task<ImageProcessResult> ProcessAsync(string path, string type, string thumbnail, string large, CancellationToken ct)
    {
        var source = path;
        MediaMetadata? metadata = null;
        var frame = large + ".frame.tmp";
        try
        {
            if (type == "video")
            {
                metadata = await ProbeAsync(path, ct);
                var seek = Math.Min((metadata.DurationMs ?? 0) / 10000d, 3);
                try { await ExtractFrameAsync(path, frame, seek, ct); }
                catch (ProcessingException) when (seek > 0) { await ExtractFrameAsync(path, frame, 0, ct); }
                source = frame;
            }
            var json = await DecodeAsync(["--process-image", source, thumbnail, large, type == "image" ? "preview" : "poster"], ct);
            var result = JsonSerializer.Deserialize<ImageProcessResult>(json) ?? throw new ProcessingException("invalid_generated_media");
            if (result.FailureCode is { } code) throw new ProcessingException(code, code == "cache_io");
            return result with { Metadata = metadata ?? result.Metadata };
        }
        finally { File.Delete(frame); }
    }

    private async Task ExtractFrameAsync(string source, string frame, double seek, CancellationToken ct)
    {
        List<string> args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-threads", "1", "-max_alloc", "268435456",
            "-filter_threads", "1", "-protocol_whitelist", "file,pipe"];
        if (seek > 0) args.AddRange(["-ss", seek.ToString(CultureInfo.InvariantCulture)]);
        args.AddRange(["-f", VideoDemuxer(source), "-i", source, "-map", "0:v:0", "-vf", "scale=w='min(iw,1280)':h='min(ih,1280)':force_original_aspect_ratio=decrease",
            "-frames:v", "1", "-an", "-sn", "-dn", "-map_metadata", "-1", "-threads", "1", "-fs", "16777216", "-c:v", "png", "-f", "image2", "-update", "1", frame]);
        await RunAsync(options.FfmpegPath, args, ct);
        if (!File.Exists(frame) || new FileInfo(frame).Length is <= 0 or >= 16_777_216) throw new ProcessingException("invalid_generated_media");
    }

    public async Task<MediaMetadata> ProbeAsync(string path, CancellationToken ct)
    {
        var json = await RunAsync(options.FfprobePath, ["-v", "error", "-threads", "1", "-max_alloc", "268435456",
            "-protocol_whitelist", "file,pipe", "-select_streams", "v:0", "-show_entries",
            "stream=width,height:stream_tags=creation_time:stream_side_data=rotation:format=duration:format_tags=creation_time", "-of", "json", "-f", VideoDemuxer(path), path], ct);
        try
        {
            using var doc = JsonDocument.Parse(json);
            var stream = doc.RootElement.GetProperty("streams").EnumerateArray().FirstOrDefault();
            var width = stream.GetProperty("width").GetInt32();
            var height = stream.GetProperty("height").GetInt32();
            if (width <= 0 || height <= 0) throw new ProcessingException("invalid_media");
            if ((long)width * height > 100_000_000) throw new ProcessingException("dimensions_exceeded");
            if (stream.TryGetProperty("side_data_list", out var sideData))
                foreach (var side in sideData.EnumerateArray())
                    if (side.TryGetProperty("rotation", out var rotation) && Math.Abs(rotation.GetDouble() % 180) == 90)
                        (width, height) = (height, width);
            long? duration = null;
            string? captured = CaptureTime(stream);
            if (doc.RootElement.TryGetProperty("format", out var format))
            {
                if (format.TryGetProperty("duration", out var d) && double.TryParse(d.GetString(), CultureInfo.InvariantCulture, out var seconds)
                    && double.IsFinite(seconds) && seconds >= 0 && seconds < long.MaxValue / 1000d) duration = (long)(seconds * 1000);
                captured ??= CaptureTime(format);
            }
            return new(width, height, duration, captured);
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException or KeyNotFoundException)
        { throw new ProcessingException("invalid_media"); }
    }
    private static string? CaptureTime(JsonElement element) =>
        element.TryGetProperty("tags", out var tags) && tags.TryGetProperty("creation_time", out var capture)
        && DateTimeOffset.TryParse(capture.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var date)
            ? date.ToUniversalTime().ToString("O") : null;

    // Do not auto-detect playlists disguised as supported videos: demuxers must not traverse source references.
    internal static string VideoDemuxer(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".mp4" or ".m4v" or ".mov" => "mov",
        ".mkv" or ".webm" => "matroska",
        ".avi" => "avi",
        _ => throw new ProcessingException("invalid_media")
    };

    public static async Task<string> RunAsync(string executable, IEnumerable<string> arguments, CancellationToken ct)
    {
        using var process = new Process { StartInfo = new ProcessStartInfo(executable)
        { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true } };
        foreach (var argument in arguments) process.StartInfo.ArgumentList.Add(argument);
        try { process.Start(); }
        catch (System.ComponentModel.Win32Exception) { throw new ProcessingException("tool_unavailable", true); }
        using var registration = ct.Register(() => Kill(process));
        var output = ReadBoundedAsync(process.StandardOutput, process, ct);
        var errors = ReadBoundedAsync(process.StandardError, process, ct);
        try
        {
            await Task.WhenAll(output, errors, process.WaitForExitAsync(ct));
            ct.ThrowIfCancellationRequested();
            if (process.ExitCode != 0) throw new ProcessingException("invalid_media");
            return await output;
        }
        finally { Kill(process); await process.WaitForExitAsync(CancellationToken.None); }
    }
    private static async Task<string> ReadBoundedAsync(StreamReader reader, Process process, CancellationToken ct)
    {
        using var result = new MemoryStream();
        var buffer = new byte[4096];
        int count;
        while ((count = await reader.BaseStream.ReadAsync(buffer.AsMemory(), ct)) != 0)
        {
            if (result.Length + count > 524_288) { Kill(process); throw new ProcessingException("tool_output_exceeded"); }
            result.Write(buffer, 0, count);
        }
        return Encoding.UTF8.GetString(result.GetBuffer(), 0, (int)result.Length);
    }
    private static void Kill(Process process)
    {
        try { if (!process.HasExited) process.Kill(entireProcessTree: true); }
        catch (InvalidOperationException) { }
        catch (System.ComponentModel.Win32Exception) { }
    }
}
