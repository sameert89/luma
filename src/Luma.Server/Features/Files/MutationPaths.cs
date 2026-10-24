using Luma.Server.Features.Indexing;
using Luma.Server.Http;

namespace Luma.Server.Features.Files;

public static class MutationPaths
{
    public const string TrashDirectory = ".luma-trash";
    public const string OperationsDirectory = ".luma-operations";
    public const string UploadDirectory = ".luma-uploads";

    public static bool IsInternal(string relative) => relative.Replace('\\', '/').Split('/').Any(segment =>
        segment.Equals(TrashDirectory, StringComparison.OrdinalIgnoreCase) ||
        segment.Equals(OperationsDirectory, StringComparison.OrdinalIgnoreCase) ||
        segment.Equals(UploadDirectory, StringComparison.OrdinalIgnoreCase));

    // Use a portable filename policy: Docker/Windows installations must agree on what a path means.
    public static string Normalize(string path, bool allowRoot = false)
    {
        if (allowRoot && path == "") return path;
        if (string.IsNullOrEmpty(path) || path.Length > 2048 || Path.IsPathRooted(path) || path.Contains('\\') || IsInternal(path))
            throw ApiRequestException.Invalid("Use a relative path inside the library.");
        var segments = path.Split('/');
        if (segments.Length > 128 || segments.Any(InvalidSegment))
            throw ApiRequestException.Invalid("The path contains an invalid name or exceeds the depth limit.");
        return string.Join('/', segments);
    }

    private static bool InvalidSegment(string segment)
    {
        if (segment is "" or "." or ".." || segment.Length > 255 || segment.EndsWith('.') || segment.EndsWith(' ') ||
            segment.Any(c => c < 32 || "<>:\"|?*".Contains(c))) return true;
        var stem = segment.Split('.')[0].ToUpperInvariant();
        return stem is "CON" or "PRN" or "AUX" or "NUL" ||
            stem.Length == 4 && (stem.StartsWith("COM") || stem.StartsWith("LPT")) && stem[3] is >= '1' and <= '9';
    }

    public static string Resolve(LibraryOptions root, string relative, bool allowRoot = false)
    {
        Normalize(relative, allowRoot);
        return ResolveChecked(root, relative);
    }

    // Only server-generated internal paths may bypass the portable public-path policy.
    internal static string Internal(LibraryOptions root, string category, string id, string name = "content")
    {
        if (category is not (TrashDirectory or OperationsDirectory or UploadDirectory) ||
            !Guid.TryParseExact(id, "N", out _) || name is not ("content" or "payload"))
            throw new InvalidOperationException("Invalid operation staging identity.");
        return ResolveChecked(root, $"{category}/{id}/{name}");
    }

    // Non-recursive deletion removes only an empty, validated operation-owned directory.
    internal static void RemoveEmptyStaging(LibraryOptions root, string category, string id)
    {
        try { Directory.Delete(Path.GetDirectoryName(Internal(root, category, id))!); }
        catch (IOException) { /* Missing or nonempty: keep all content for recovery. */ }
        catch (UnauthorizedAccessException) { /* Cleanup can be retried without blocking the operation. */ }
        catch (ApiRequestException) { /* Never follow replaced staging directories. */ }
    }

    private static string ResolveChecked(LibraryOptions root, string relative)
    {
        var full = Path.GetFullPath(Path.Combine(root.Path, relative.Replace('/', Path.DirectorySeparatorChar)));
        if (!SourcePaths.IsInside(root, full)) throw ApiRequestException.Invalid("Path outside library.");
        // Validate existing ancestors even when the leaf hasn't been created yet. GetAttributes
        // also detects a dangling link, for which File.Exists/Directory.Exists would return false.
        for (var parent = new DirectoryInfo(root.Path); parent is not null; parent = parent.Parent) CheckLink(parent.FullName, required: true);
        var current = root.Path;
        foreach (var segment in relative.Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, segment);
            CheckLink(current, required: false);
        }
        return full;
    }

    private static void CheckLink(string path, bool required)
    {
        try
        {
            if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
                throw new ApiRequestException(409, "unsafe_path", "File operations cannot follow symbolic links.");
        }
        catch (FileNotFoundException) when (!required) { }
        catch (DirectoryNotFoundException) when (!required) { }
    }
}
