using System.Globalization;
using Luma.Server.Features.Indexing;
using Luma.Server.Http;
using Luma.Server.MediaProcessing;

namespace Luma.Server.Features.Panels;

public static class PdfComics
{
    public const long MaximumDocumentBytes = 1024L * 1024 * 1024;

    public static async Task<IReadOnlyList<ComicPageSource>> InspectAsync(string path, IndexingOptions options, CancellationToken ct)
    {
        if (new FileInfo(path).Length is <= 0 or > MaximumDocumentBytes) throw Invalid();
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(30));
        var info = await MediaProcessor.RunAsync(options.PdfinfoPath, [path], deadline.Token,
            new Dictionary<string, string> { ["LC_ALL"] = "C" });
        return ParseInfo(info);
    }

    internal static IReadOnlyList<ComicPageSource> ParseInfo(string info)
    {
        var fields = info.Split('\n').Select(line => line.Split(':', 2))
            .Where(parts => parts.Length == 2).GroupBy(parts => parts[0].Trim(), StringComparer.Ordinal).ToDictionary(group => group.Key, group => group.Last()[1].Trim(), StringComparer.Ordinal);
        // pdfinfo already opened the document without a password. "Encrypted: yes" can
        // mean owner restrictions with an empty user password, which PDF.js can read.
        if (!fields.TryGetValue("Encrypted", out var encrypted) || !(encrypted == "no" || encrypted.StartsWith("yes", StringComparison.Ordinal))
            || !fields.TryGetValue("Pages", out var pages)
            || !int.TryParse(pages, NumberStyles.None, CultureInfo.InvariantCulture, out var count)
            || count is < 1 or > ComicSources.MaximumEntries) throw Invalid();
        return Enumerable.Range(1, count).Select(page => new ComicPageSource($"{page}.png", 0)).ToArray();
    }

    public static async Task RenderCoverAsync(string path, int page, string destination, IndexingOptions options, CancellationToken ct)
    {
        if (page is < 0 or >= ComicSources.MaximumEntries) throw Invalid();
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(30));
        var number = (page + 1).ToString(CultureInfo.InvariantCulture);
        // Only the selected cover is rasterized; all reading pages stay in the browser.
        await MediaProcessor.RunAsync(options.PdftoppmPath,
            ["-f", number, "-l", number, "-singlefile", "-scale-to", "1024", "-png", path, Path.ChangeExtension(destination, null)], deadline.Token);
        if (!File.Exists(destination) || new FileInfo(destination).Length is <= 0 or > ComicSources.MaximumPageBytes) throw Invalid();
    }

    private static ApiRequestException Invalid() => new(422, "comic_pdf_unsupported", "This PDF requires a password, is damaged or exceeds the comic limits.");
}
