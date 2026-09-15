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
    public static async Task RunAsync(string[] args, CancellationToken ct)
    {
        var writingCache = false;
        try
        {
            if (args.Length != 5 || args[4] is not ("preview" or "poster")) throw new ProcessingException("invalid_media");
            var configuration = Configuration.Default.Clone();
            configuration.MaxDegreeOfParallelism = 1;
            configuration.MemoryAllocator = MemoryAllocator.Create(new MemoryAllocatorOptions
            { MaximumPoolSizeMegabytes = 16, AllocationLimitMegabytes = 400 });
            var decoder = new DecoderOptions { Configuration = configuration, MaxFrames = 1 };
            var info = await Image.IdentifyAsync(decoder, args[1], ct);
            if (info.Width <= 0 || info.Height <= 0) throw new ProcessingException("invalid_media");
            if ((long)info.Width * info.Height > 100_000_000) throw new ProcessingException("dimensions_exceeded");
            var captured = CaptureTime(info.Metadata.ExifProfile);
            var width = info.Width;
            var height = info.Height;
            if (info.Metadata.ExifProfile?.TryGetValue(ExifTag.Orientation, out var orientation) == true && orientation.Value is >= 5 and <= 8)
                (width, height) = (height, width);
            var edge = args[4] == "preview" ? 1920 : 1280;
            // Decoder-assisted downsampling where supported reduces the peak before resize.
            using var source = await Image.LoadAsync<Rgba32>(new DecoderOptions
            { Configuration = configuration, MaxFrames = 1, TargetSize = new Size(Math.Min(info.Width, edge), Math.Min(info.Height, edge)) }, args[1], ct);
            source.Mutate(x => x.AutoOrient());
            source.Mutate(x => x.Resize(new ResizeOptions
            { Size = new Size(Math.Min(source.Width, edge), Math.Min(source.Height, edge)), Mode = ResizeMode.Max }));
            source.Metadata.ExifProfile = null;
            source.Metadata.XmpProfile = null;
            source.Metadata.IptcProfile = null;
            var largeWidth = source.Width;
            var largeHeight = source.Height;
            writingCache = true;
            using (var large = source.Clone(x => x.BackgroundColor(Color.FromRgb(30, 30, 46))))
                await large.SaveAsync(args[3], new JpegEncoder { Quality = args[4] == "preview" ? 85 : 80 }, ct);
            source.Mutate(x => x.Resize(new ResizeOptions { Size = new Size(Math.Min(source.Width, 320), Math.Min(source.Height, 320)), Mode = ResizeMode.Max }));
            await source.SaveAsync(args[2], new WebpEncoder { Quality = 75 }, ct);
            var variants = new[] { new GeneratedVariant("thumbnail", args[2], source.Width, source.Height), new GeneratedVariant(args[4], args[3], largeWidth, largeHeight) };
            // Validate the completed encodings before the parent atomically publishes them.
            foreach (var variant in variants)
            {
                if (new FileInfo(variant.TemporaryPath).Length is <= 0 or >= 16_777_216) throw new ProcessingException("invalid_generated_media");
                using var decoded = await Image.LoadAsync(decoder, variant.TemporaryPath, ct);
                if (decoded.Width != variant.Width || decoded.Height != variant.Height) throw new ProcessingException("invalid_generated_media");
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

