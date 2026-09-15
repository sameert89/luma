using System.Globalization;
using System.Text;

namespace Luma.Server.Features.Media;

public static class SearchText
{
    public static string Key(string value) => value.Normalize(NormalizationForm.FormC).ToUpperInvariant().Normalize(NormalizationForm.FormC);
    public static string Reverse(string value) => string.Concat(value.EnumerateRunes().Reverse().Select(x => x.ToString()));
    public static long Ticks(string value) => DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal).UtcTicks;
}
