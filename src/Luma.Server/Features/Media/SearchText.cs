using System.Globalization;
using System.Text;

namespace Luma.Server.Features.Media;

public static class SearchText
{
    public static string Key(string value) => value.Normalize(NormalizationForm.FormC).ToUpperInvariant().Normalize(NormalizationForm.FormC);
    public static string Reverse(string value) => string.Concat(value.EnumerateRunes().Reverse().Select(x => x.ToString()));
    public static long Ticks(string value) => DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal).UtcTicks;

    /// <summary>A folder's own name: the last segment of its library-relative path ("" for a library root).</summary>
    public static string FolderName(string relativePath) => relativePath[(relativePath.LastIndexOf('/') + 1)..];

    /// <summary>
    /// Orders names the way people read them under plain binary comparison: case and accents are
    /// ignored, and each run of digits compares by value, so "Day 2" precedes "Day 10". A digit run
    /// becomes its length (three digits) followed by the digits without leading zeros.
    /// </summary>
    public static string SortKey(string value)
    {
        var folded = new StringBuilder(value.Length);
        foreach (var character in value.Normalize(NormalizationForm.FormD))
            if (CharUnicodeInfo.GetUnicodeCategory(character) != UnicodeCategory.NonSpacingMark) folded.Append(character);
        var text = folded.ToString().Normalize(NormalizationForm.FormC).ToUpperInvariant();
        var key = new StringBuilder(text.Length + 8);
        for (var index = 0; index < text.Length;)
        {
            if (!char.IsAsciiDigit(text[index])) { key.Append(text[index++]); continue; }
            var start = index;
            while (index < text.Length && char.IsAsciiDigit(text[index])) index++;
            var digits = text[start..index].TrimStart('0');
            if (digits.Length == 0) digits = "0";
            key.Append(Math.Min(digits.Length, 999).ToString("D3", CultureInfo.InvariantCulture)).Append(digits);
        }
        return key.ToString();
    }
}
