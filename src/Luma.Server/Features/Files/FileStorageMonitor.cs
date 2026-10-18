using Luma.Server.Features.Indexing;

namespace Luma.Server.Features.Files;

// A startup diagnostic, separate from indexed browsing and never a prerequisite for reads.
public sealed class FileStorageMonitor(IndexingOptions options, FileWriteAvailability availability, ILogger<FileStorageMonitor> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var statuses = await FileStorageCheck.CheckAsync(options, stoppingToken);
        availability.Update(statuses);
        foreach (var status in statuses.Where(x => x.ConfiguredWritable && !x.CanWrite))
            logger.LogWarning("Library {Library}: {Warning}", status.Name, status.Warning);
    }
}

public sealed record FileStorageReport(string BootId, bool AccessConfigured, IReadOnlyList<FileStorageStatus> Libraries);
