using System.Xml;
using System.Xml.Linq;
using Luma.Server.Features.Tags;
using Luma.Server.Http;

namespace Luma.Server.Features.Panels;

public sealed record ComicInspection(IReadOnlyList<ComicPageSource> Pages, ComicMetadata? Metadata);
public sealed record ComicMetadata(string Title, string Series, string Author, string Description, int CoverPage, string[] Tags)
{
    public const int MaximumBytes = 1024 * 1024;

    // Optional metadata must not prevent an otherwise valid comic from opening.
    public static ComicMetadata? Read(Stream input)
    {
        try
        {
            using var bytes = new MemoryStream();
            var buffer = new byte[8192];
            int read;
            while ((read = input.Read(buffer)) != 0)
            {
                if (bytes.Length + read > MaximumBytes) return null;
                bytes.Write(buffer, 0, read);
            }
            bytes.Position = 0;
            using var reader = XmlReader.Create(bytes, new XmlReaderSettings
            { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = MaximumBytes });
            var root = XDocument.Load(reader).Root;
            if (root?.Name.LocalName != "ComicInfo") return null;
            string Field(string name, int limit)
            {
                var value = root.Elements().FirstOrDefault(x => x.Name.LocalName == name)?.Value.Trim() ?? "";
                return value[..Math.Min(value.Length, limit)];
            }
            var tags = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var field in new[] { "Genre", "Tags", "Characters", "Teams", "Locations" })
                foreach (var name in Field(field, 16384).Split([',', ';'], StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
                {
                    try
                    {
                        var normalized = TagText.Normalize(name);
                        if (tags.Count < 100) tags.TryAdd(normalized.Key, normalized.Name);
                    }
                    catch (ApiRequestException) { }
                }
            var cover = root.Elements().FirstOrDefault(x => x.Name.LocalName == "Pages")?.Elements()
                .FirstOrDefault(x => x.Name.LocalName == "Page" && string.Equals((string?)x.Attribute("Type"), "FrontCover", StringComparison.OrdinalIgnoreCase));
            var coverPage = int.TryParse((string?)cover?.Attribute("Image"), out var index) && index >= 0 ? index : 0;
            return new(Field("Title", 500), Field("Series", 500), Field("Writer", 500), Field("Summary", 4096), coverPage, [.. tags.Values]);
        }
        catch (Exception error) when (error is XmlException or InvalidDataException or IOException) { return null; }
    }
}
