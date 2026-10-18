using System.Globalization;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using Luma.Server.Http;

namespace Luma.Server.Features.Captions;

public static partial class SrtCaptions
{
    public const int MaximumBytes = 4 * 1024 * 1024;
    public const int MaximumVttBytes = 8 * 1024 * 1024;
    private static readonly UTF8Encoding Utf8 = new(false, true);
    [GeneratedRegex(@"^(\d{1,3}):([0-5]\d):([0-5]\d)[,.](\d{3})\s+-->\s+(\d{1,3}):([0-5]\d):([0-5]\d)[,.](\d{3})(?:\s.*)?$", RegexOptions.NonBacktracking)]
    private static partial Regex Timing();
    [GeneratedRegex(@"<[^>]*>|\{\\[^}]*\}", RegexOptions.NonBacktracking)]
    private static partial Regex Styling();

    public static string Convert(byte[] bytes)
    {
        if (bytes.Length > MaximumBytes) throw Invalid("The SRT file exceeds the 4 MiB caption limit.");
        string text;
        try
        {
            // UTF-8 is the portable default; BOM-marked UTF-16 exports are also common.
            text = bytes.AsSpan().StartsWith(new byte[] { 0xff, 0xfe }) ? new UnicodeEncoding(false, true, true).GetString(bytes, 2, bytes.Length - 2)
                : bytes.AsSpan().StartsWith(new byte[] { 0xfe, 0xff }) ? new UnicodeEncoding(true, true, true).GetString(bytes, 2, bytes.Length - 2)
                : Utf8.GetString(bytes).TrimStart('\ufeff');
        }
        catch (DecoderFallbackException) { throw Invalid("Save the SRT file as UTF-8 or BOM-marked UTF-16."); }
        if (text.Contains('\0')) throw Invalid("Invalid SRT text.");
        var lines = text.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
        var output = new StringBuilder("WEBVTT\n\n");
        var cues = 0;
        for (var index = 0; index < lines.Length;)
        {
            if (string.IsNullOrWhiteSpace(lines[index])) { index++; continue; }
            if (lines[index].Trim().All(char.IsAsciiDigit)) index++;
            if (index >= lines.Length) throw Invalid("Incomplete SRT cue.");
            var timing = Timing().Match(lines[index++].Trim());
            if (!timing.Success || ++cues > 100_000) throw Invalid("Invalid SRT timing or too many cues.");
            static long Milliseconds(Match match, int offset) =>
                long.Parse(match.Groups[offset].Value, CultureInfo.InvariantCulture) * 3_600_000
                + long.Parse(match.Groups[offset + 1].Value, CultureInfo.InvariantCulture) * 60_000
                + long.Parse(match.Groups[offset + 2].Value, CultureInfo.InvariantCulture) * 1000
                + long.Parse(match.Groups[offset + 3].Value, CultureInfo.InvariantCulture);
            var start = Milliseconds(timing, 1);
            var end = Milliseconds(timing, 5);
            if (end <= start) throw Invalid("SRT cue end must follow its start.");
            static string Timestamp(long milliseconds) => FormattableString.Invariant($"{milliseconds / 3_600_000:00}:{milliseconds / 60_000 % 60:00}:{milliseconds / 1000 % 60:00}.{milliseconds % 1000:000}");
            output.Append(Timestamp(start)).Append(" --> ").Append(Timestamp(end)).Append('\n');
            var length = 0;
            while (index < lines.Length && !string.IsNullOrWhiteSpace(lines[index]))
            {
                var line = lines[index++];
                length += line.Length;
                if (length > 32_768) throw Invalid("An SRT cue is too long.");
                // Preserve only plain text. Escape decoded markup so it cannot become WebVTT styling.
                line = WebUtility.HtmlDecode(Styling().Replace(line, ""));
                output.Append(line.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;")).Append('\n');
            }
            output.Append('\n');
            if (output.Length > MaximumVttBytes) throw Invalid("Converted captions exceed the cache limit.");
        }
        if (cues == 0) throw Invalid("The SRT file has no cues.");
        if (Utf8.GetByteCount(output.ToString()) > MaximumVttBytes) throw Invalid("Converted captions exceed the cache limit.");
        return output.ToString();
    }
    private static ApiRequestException Invalid(string message) => new(422, "invalid_srt", message);
}
