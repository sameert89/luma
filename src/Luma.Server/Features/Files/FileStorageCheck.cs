using Luma.Server.Features.Indexing;
using Luma.Server.Http;

namespace Luma.Server.Features.Files;

public sealed record FileStorageStatus(long LibraryId, string Name, bool ConfiguredWritable, bool CanWrite, string? Warning);

// Explicit administrator diagnostic. Normal browse/capability requests never probe originals.
public static class FileStorageCheck
{
    public static async Task<IReadOnlyList<FileStorageStatus>> CheckAsync(IndexingOptions options, CancellationToken ct)
    {
        var results = new List<FileStorageStatus>();
        foreach (var root in options.Libraries)
        {
            ct.ThrowIfCancellationRequested();
            if (!root.Writable)
            {
                results.Add(new(root.Id, root.Name, false, false,
                    "This library is configured read-only. Enable Writable and change its media mount from :ro to :rw to use file management. Browsing continues normally."));
                continue;
            }
            string? directory = null;
            string? probePath = null;
            string? warning = null;
            try
            {
                var path = MutationPaths.Internal(root, MutationPaths.OperationsDirectory, Guid.NewGuid().ToString("N"));
                probePath = path;
                directory = Path.GetDirectoryName(path)!;
                Directory.CreateDirectory(directory);
                await using (var probe = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1, FileOptions.Asynchronous))
                {
                    await probe.WriteAsync(new byte[] { 0 }, ct);
                    await probe.FlushAsync(ct);
                }
                File.Delete(path);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or ApiRequestException)
            {
                warning = "Luma cannot write to this library. Check that the Docker media mount was changed from :ro to :rw, filesystem permissions and free space. Uploads, folder creation, moves, recycling, restore and deletion are disabled here; browsing and playback remain available.";
            }
            finally
            {
                if (directory is not null)
                {
                    try { if (probePath is not null) File.Delete(probePath); Directory.Delete(directory); }
                    catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
                }
            }
            results.Add(new(root.Id, root.Name, true, warning is null, warning));
        }
        return results;
    }
}
