using System.Globalization;
using System.Text.Json;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.Memory;
using SixLabors.ImageSharp.Metadata.Profiles.Exif;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace Luma.Server.MediaProcessing;

// Internal command executed by the same application binary. No HTTP host or database is started.
// The parent kills this process on timeout/cancellation, including synchronous decoder/resize work.
public static class ImageProcessCommand
{
    private const int ThumbnailEdge = 320;
    private static readonly Configuration DecoderConfiguration = CreateConfiguration();

    private static Configuration CreateConfiguration()
    {
        var configuration = Configuration.Default.Clone();
        configuration.MaxDegreeOfParallelism = 1;
        configuration.MemoryAllocator = MemoryAllocator.Create(new MemoryAllocatorOptions
        { MaximumPoolSizeMegabytes = 16, AllocationLimitMegabytes = 400 });
        return configuration;
    }

    public static async Task RunWorkerAsync(CancellationToken ct)
    {
        // Recycle periodically to bound retained decoder state and native resources.
        for (var count = 0; count < 128; count++)
        {
            var line = await Console.In.ReadLineAsync(ct);
            if (line is null) return;
            var args = JsonSerializer.Deserialize<string[]>(line) ?? [];
            if (args is ["--read-tags", var path]) await ReadTagsAsync(path, ct);
            else await RunAsync(args, ct);
            await Console.Out.WriteLineAsync();
            await Console.Out.FlushAsync(ct);
        }
    }

    // Keyword reads share the pooled worker: starting a runtime per file cost far more than the header parse.
    private static async Task ReadTagsAsync(string path, CancellationToken ct)
    {
        TagReadResult result;
        try { result = new([.. await Features.Tags.MetadataKeywords.ReadImageAsync(path, ct)], null); }
        catch (Exception error) when (error is not OperationCanceledException)
        { result = new([], error is IOException or UnauthorizedAccessException ? "source_unavailable" : "invalid_metadata"); }
        await Console.Out.WriteAsync(JsonSerializer.Serialize(result).AsMemory(), ct);
    }

    // args: --process-image source thumbnail large mode. Mode "thumbnail" writes only the
    // thumbnail (large is ignored); "preview" and "poster" also write the large JPEG.
    public static async Task RunAsync(string[] args, CancellationToken ct)
    {
        var writingCache = false;
        try
        {
            if (args.Length != 5 || args[4] is not ("preview" or "poster" or "thumbnail")) throw new ProcessingException("invalid_media");
            var configuration = DecoderConfiguration;
            var decoder = new DecoderOptions { Configuration = configuration, MaxFrames = 1 };
            var info = await Image.IdentifyAsync(decoder, args[1], ct);
            if (info.Width <= 0 || info.Height <= 0) throw new ProcessingException("invalid_media");
            if ((long)info.Width * info.Height > 100_000_000) throw new ProcessingException("dimensions_exceeded");
            var captured = CaptureTime(info.Metadata.ExifProfile);
            var width = info.Width;
            var height = info.Height;
            if (info.Metadata.ExifProfile?.TryGetValue(ExifTag.Orientation, out var orientation) == true && orientation.Value is >= 5 and <= 8)
                (width, height) = (height, width);
            var edge = args[4] switch { "preview" => 1920, "poster" => 1280, _ => ThumbnailEdge };
            // Decoder-assisted downsampling (JPEG scaled IDCT) keeps a thumbnail-only decode small.
            using var source = await Image.LoadAsync<Rgba32>(new DecoderOptions
            { Configuration = configuration, MaxFrames = 1, TargetSize = new Size(Math.Min(info.Width, edge), Math.Min(info.Height, edge)) }, args[1], ct);
            source.Mutate(x => x.AutoOrient());
            source.Mutate(x => x.Resize(new ResizeOptions
            { Size = new Size(Math.Min(source.Width, edge), Math.Min(source.Height, edge)), Mode = ResizeMode.Max }));
            source.Metadata.ExifProfile = null;
            source.Metadata.XmpProfile = null;
            source.Metadata.IptcProfile = null;
            writingCache = true;
            var variants = new List<GeneratedVariant>();
            using (var thumbnail = source.Clone(x => x.Resize(new ResizeOptions
                   { Size = new Size(Math.Min(source.Width, ThumbnailEdge), Math.Min(source.Height, ThumbnailEdge)), Mode = ResizeMode.Max })))
            {
                // Level2 effort is ~3x faster than the default for the same size at thumbnail scale.
                await thumbnail.SaveAsync(args[2], new WebpEncoder { Quality = 75, Method = WebpEncodingMethod.Level2 }, ct);
                variants.Add(new("thumbnail", args[2], thumbnail.Width, thumbnail.Height));
            }
            if (args[4] != "thumbnail")
            {
                // JPEG has no alpha: flatten in place now that the thumbnail kept its transparency.
                source.Mutate(x => x.BackgroundColor(Color.FromRgb(30, 30, 46)));
                await source.SaveAsync(args[3], new JpegEncoder { Quality = args[4] == "preview" ? 85 : 80 }, ct);
                variants.Add(new(args[4], args[3], source.Width, source.Height));
            }
            // Validate the completed encodings before the parent atomically publishes them. Our own
            // encoder output only needs a structural check; re-decoding every pixel doubled the work.
            foreach (var variant in variants)
            {
                if (new FileInfo(variant.TemporaryPath).Length is <= 0 or >= 16_777_216) throw new ProcessingException("invalid_generated_media");
                var encoded = await Image.IdentifyAsync(decoder, variant.TemporaryPath, ct);
                if (encoded.Width != variant.Width || encoded.Height != variant.Height) throw new ProcessingException("invalid_generated_media");
            }
            await Console.Out.WriteAsync(JsonSerializer.Serialize(new ImageProcessResult(new(width, height, null, captured), variants, null)).AsMemory(), ct);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            var code = error switch
            {
                ProcessingException p => p.Code,
                InvalidMemoryOperationException or OutOfMemoryException => "memory_limit",
                IOException or UnauthorizedAccessException => writingCache ? "cache_io" : "source_unavailable",
                _ => "invalid_media"
            };
            await Console.Out.WriteAsync(JsonSerializer.Serialize(new ImageProcessResult(null, [], code)).AsMemory(), ct);
        }
    }

    private static string? CaptureTime(ExifProfile? profile)
    {
        if (profile?.TryGetValue(ExifTag.DateTimeOriginal, out var date) != true
            || !DateTime.TryParseExact(date!.Value, "yyyy:MM:dd HH:mm:ss", CultureInfo.InvariantCulture, DateTimeStyles.None, out var time)) return null;
        var offset = TimeSpan.Zero;
        if (profile.TryGetValue(ExifTag.OffsetTimeOriginal, out var value)
            && DateTimeOffset.TryParseExact(date.Value + " " + value.Value, "yyyy:MM:dd HH:mm:ss zzz", CultureInfo.InvariantCulture, DateTimeStyles.None, out var zoned))
            return zoned.ToUniversalTime().ToString("O");
        return new DateTimeOffset(time, offset).ToString("O");
    }
}
public sealed record ImageProcessResult(MediaMetadata? Metadata, IReadOnlyList<GeneratedVariant> Variants, string? FailureCode);
public sealed record TagReadResult(string[] Keywords, string? FailureCode);

