using SharpCompress.Archives;
using SharpCompress.Common;
using Luma.Server.Features.Files;
using Luma.Server.Features.Media;
using Luma.Server.Http;

namespace Luma.Server.Features.Panels;

public sealed record ComicPageSource(string Name, long SizeBytes);
public static class ComicSources
{
    public static async Task RunWorkerAsync(string[] args, CancellationToken ct)
    {
        if (args.Length == 3 && args[0] == "--comic-inspect")
            await Console.Out.WriteAsync(System.Text.Json.JsonSerializer.Serialize(InspectBook(args[1], args[2] == "folder", ct)));
        else if (args.Length == 6 && args[0] == "--comic-page")
            await ExtractPageAsync(args[1], args[2] == "folder", new(args[3], long.Parse(args[4])), args[5], ct);
        else throw new InvalidDataException("Invalid comic worker arguments.");
    }
    public static async Task<ComicInspection> InspectIsolatedAsync(string path, bool directory, CancellationToken ct)
    {
        var json = await RunIsolatedAsync(["--comic-inspect", path, directory ? "folder" : "archive"], ct);
        return System.Text.Json.JsonSerializer.Deserialize<ComicInspection>(json) ?? throw new InvalidDataException();
    }
    public static Task<string> ExtractIsolatedAsync(string path, bool directory, ComicPageSource page, string destination, CancellationToken ct) =>
        RunIsolatedAsync(["--comic-page", path, directory ? "folder" : "archive", page.Name, page.SizeBytes.ToString(System.Globalization.CultureInfo.InvariantCulture), destination], ct);
    private static async Task<string> RunIsolatedAsync(string[] arguments, CancellationToken ct)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(30));
        var assembly = typeof(ComicSources).Assembly;
        var apphost = System.Reflection.Assembly.GetEntryAssembly() == assembly && Path.GetFileNameWithoutExtension(Environment.ProcessPath) != "dotnet";
        return await Luma.Server.MediaProcessing.MediaProcessor.RunAsync(apphost ? Environment.ProcessPath! : "dotnet",
            apphost ? arguments : new[] { assembly.Location }.Concat(arguments), deadline.Token,
            new Dictionary<string, string> { ["DOTNET_GCHeapHardLimit"] = "10000000" });
    }

    public const int MaximumEntries = 5000;
    public const long MaximumPageBytes = 64L * 1024 * 1024;
    public static bool IsPdf(string path) => Path.GetExtension(path).Equals(".pdf", StringComparison.OrdinalIgnoreCase);
    public static bool IsBook(string path) => IsArchive(path) || IsPdf(path);
    public static bool IsArchive(string path) => Path.GetExtension(path).ToLowerInvariant() is ".cbz" or ".zip" or ".cbr" or ".rar";
    public static bool IsImage(string path) => Path.GetExtension(path).ToLowerInvariant() is ".jpg" or ".jpeg" or ".png" or ".webp" or ".gif" or ".bmp";
    public static IReadOnlyList<ComicPageSource> Inspect(string path, bool directory, CancellationToken ct) => InspectBook(path, directory, ct).Pages;
    public static ComicInspection InspectBook(string path, bool directory, CancellationToken ct)
    {
        ComicMetadata? metadata = null;
        var pages = new List<ComicPageSource>();
        if (directory)
        {
            var count = 0;
            foreach (var entry in new DirectoryInfo(path).EnumerateFileSystemInfos())
            {
                ct.ThrowIfCancellationRequested();
                if (++count > MaximumEntries) throw Invalid("comic_entry_limit");
                if (entry.Attributes.HasFlag(FileAttributes.ReparsePoint)) throw Invalid("comic_symlink");
                if (entry is FileInfo info && info.Name.Equals("ComicInfo.xml", StringComparison.OrdinalIgnoreCase) && info.Length <= ComicMetadata.MaximumBytes)
                {
                    using var input = info.OpenRead();
                    metadata = ComicMetadata.Read(input);
                }
                if (entry is FileInfo file && IsImage(file.Name))
                {
                    if (file.Length is <= 0 or > MaximumPageBytes) throw Invalid("comic_page_limit");
                    pages.Add(new(file.Name, file.Length));
                }
            }
        }
        else
        {
            using var archive = ArchiveFactory.OpenArchive(path);
            ValidateArchive(archive);
            var count = 0;
            long totalSize = 0;
            foreach (var entry in archive.Entries)
            {
                ct.ThrowIfCancellationRequested();
                if (++count > MaximumEntries) throw Invalid("comic_entry_limit");
                var name = entry.Key ?? throw Invalid("comic_invalid_name");
                MutationPaths.Normalize(name.Replace('\\', '/').TrimEnd('/'));
                if (entry.IsEncrypted) throw Invalid("comic_encrypted");
                if (!entry.IsDirectory && name.Replace('\\', '/').Split('/')[^1].Equals("ComicInfo.xml", StringComparison.OrdinalIgnoreCase)
                    && !name.StartsWith("__MACOSX/", StringComparison.Ordinal) && entry.Size <= ComicMetadata.MaximumBytes && metadata is null)
                {
                    using var input = entry.OpenEntryStream();
                    metadata = ComicMetadata.Read(input);
                }
                if (entry.IsDirectory || !IsImage(name) || name.StartsWith("__MACOSX/", StringComparison.Ordinal)) continue;
                if (entry.Size is <= 0 or > MaximumPageBytes) throw Invalid("comic_page_limit");
                totalSize += entry.Size;
                if (totalSize > 4L * 1024 * 1024 * 1024) throw Invalid("comic_expansion_limit");
                pages.Add(new(name, entry.Size));
            }
        }
        if (pages.Count == 0) throw Invalid("comic_no_pages");
        if (pages.Select(x => x.Name).Distinct(StringComparer.Ordinal).Count() != pages.Count) throw Invalid("comic_duplicate_page");
        return new(pages.OrderBy(x => SearchText.SortKey(x.Name), StringComparer.Ordinal).ThenBy(x => x.Name, StringComparer.Ordinal).ToArray(), metadata);
    }

    private static void ValidateArchive(IArchive archive)
    {
        if (archive.Type is not (ArchiveType.Zip or ArchiveType.Rar)) throw Invalid("comic_unsupported_archive");
        // Random access to a solid RAR can decompress every preceding page. Reject it rather
        // than advertising bounded random access while performing an unbounded full extraction.
        if (archive.IsSolid) throw Invalid("comic_solid_archive_unsupported");
    }

    public static async Task ExtractPageAsync(string source, bool directory, ComicPageSource page, string destination, CancellationToken ct)
    {
        if (page.SizeBytes is <= 0 or > MaximumPageBytes) throw Invalid("comic_page_limit");
        await using var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None, 64 * 1024, FileOptions.Asynchronous);
        if (directory)
        {
            var path = Path.Combine(source, MutationPaths.Normalize(page.Name));
            if (File.GetAttributes(path).HasFlag(FileAttributes.ReparsePoint)) throw Invalid("comic_symlink");
            await using var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, FileOptions.Asynchronous);
            await CopyBoundedAsync(input, output, page.SizeBytes, ct);
        }
        else
        {
            using var archive = ArchiveFactory.OpenArchive(source);
            ValidateArchive(archive);
            var entry = archive.Entries.Take(MaximumEntries + 1).SingleOrDefault(x => x.Key == page.Name) ?? throw Invalid("comic_page_missing");
            if (entry.IsEncrypted || entry.Size != page.SizeBytes) throw Invalid("comic_source_changed");
            using var input = entry.OpenEntryStream();
            await CopyBoundedAsync(input, output, page.SizeBytes, ct);
        }
    }

    private static async Task CopyBoundedAsync(Stream source, Stream output, long expected, CancellationToken ct)
    {
        var buffer = new byte[64 * 1024];
        long copied = 0;
        int count;
        while ((count = await source.ReadAsync(buffer, ct)) != 0)
        {
            copied += count;
            if (copied > expected || copied > MaximumPageBytes) throw Invalid("comic_expansion_limit");
            await output.WriteAsync(buffer.AsMemory(0, count), ct);
        }
        if (copied != expected) throw Invalid("comic_page_truncated");
    }
    private static ApiRequestException Invalid(string code) => new(422, code, "The comic source is unsupported, unsafe, corrupt or exceeds its resource limits.");
}
