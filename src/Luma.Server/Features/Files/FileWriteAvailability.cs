using System.Collections.Concurrent;
using Luma.Server.Http;

namespace Luma.Server.Features.Files;

// Last startup or explicit administrator check only. Capability reads never touch source storage.
public sealed class FileWriteAvailability
{
    public string BootId { get; } = Guid.NewGuid().ToString("N");
    private IReadOnlyList<FileStorageStatus> statuses = [];
    public IReadOnlyList<FileStorageStatus> Statuses => Volatile.Read(ref statuses);
    private readonly ConcurrentDictionary<long, bool> availability = new();
    public bool CanWrite(long libraryId) => !availability.TryGetValue(libraryId, out var writable) || writable;
    public void Update(IEnumerable<FileStorageStatus> statuses)
    {
        var snapshot = statuses.ToArray();
        foreach (var status in snapshot) availability[status.LibraryId] = status.CanWrite;
        Volatile.Write(ref this.statuses, snapshot);
    }
    public void RequireWritable(long libraryId)
    {
        if (!CanWrite(libraryId)) throw new ApiRequestException(409, "media_not_writable",
            "File changes are disabled for this library. Fix the media mount or permissions, then use Check media mounts in Settings.");
    }
}
