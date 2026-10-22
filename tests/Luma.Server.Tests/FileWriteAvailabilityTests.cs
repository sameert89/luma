using Luma.Server.Features.Files;
using Luma.Server.Features.Indexing;
using Luma.Server.Http;

namespace Luma.Server.Tests;

public sealed class FileWriteAvailabilityTests
{
    [Fact]
    public async Task Failed_check_blocks_new_operations_before_journal_or_source_access_and_recheck_restores_them()
    {
        var availability = new FileWriteAvailability();
        var root = new LibraryOptions { Id = 1, Writable = true, Path = "/unavailable-originals" };
        var operations = new FileOperations(null!, new IndexingOptions { Libraries = [root] }, availability);
        availability.Update([new(1, "Photos", true, false, "Read-only mount")]);
        var error = await Assert.ThrowsAsync<ApiRequestException>(() => operations.QueueAsync(new(1, "mkdir", "new-folder"), default));
        Assert.Equal("media_not_writable", error.Code);
        Assert.False(availability.CanWrite(1));
        Assert.Same(root, operations.WritableRoot(1, requireAvailable: false)); // Existing recovery evidence stays accessible.
        Assert.True(availability.CanWrite(2)); // Other libraries are unaffected.
        availability.Update([new(1, "Photos", true, true, null)]);
        Assert.Same(root, operations.WritableRoot(1));
    }

    [Fact]
    public void Successful_check_cannot_override_read_only_configuration()
    {
        var availability = new FileWriteAvailability();
        availability.Update([new(1, "Photos", true, true, null)]);
        var operations = new FileOperations(null!, new IndexingOptions { Libraries = [new() { Id = 1, Writable = false }] }, availability);
        var error = Assert.Throws<ApiRequestException>(() => operations.WritableRoot(1));
        Assert.Equal("read_only_library", error.Code);
    }
}
