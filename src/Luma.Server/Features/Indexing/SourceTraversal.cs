namespace Luma.Server.Features.Indexing;

internal static class SourceTraversal
{
    // Depth-first enumeration retains one directory handle per level, never a breadth-sized queue.
    public static IEnumerable<FileSystemInfo> Enumerate(string root, bool recursive = true, Func<string, bool>? skipDirectory = null)
    {
        var options = new EnumerationOptions { RecurseSubdirectories = false, IgnoreInaccessible = false,
            AttributesToSkip = FileAttributes.ReparsePoint, ReturnSpecialDirectories = false };
        var stack = new Stack<IEnumerator<FileSystemInfo>>();
        stack.Push(new DirectoryInfo(root).EnumerateFileSystemInfos("*", options).GetEnumerator());
        try
        {
            while (stack.TryPeek(out var current))
            {
                if (!current.MoveNext()) { stack.Pop().Dispose(); continue; }
                var entry = current.Current;
                yield return entry;
                if (recursive && entry.Attributes.HasFlag(FileAttributes.Directory) && skipDirectory?.Invoke(entry.FullName) != true)
                {
                    if (File.GetAttributes(entry.FullName).HasFlag(FileAttributes.ReparsePoint)) throw new IOException("Directory changed into a link.");
                    if (stack.Count >= 128) throw new IOException("Directory depth limit exceeded.");
                    stack.Push(((DirectoryInfo)entry).EnumerateFileSystemInfos("*", options).GetEnumerator());
                }
            }
        }
        finally { foreach (var enumerator in stack) enumerator.Dispose(); }
    }
}
