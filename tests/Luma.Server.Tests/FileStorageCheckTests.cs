using Luma.Server.Features.Files;
using Luma.Server.Features.Indexing;

namespace Luma.Server.Tests;

public sealed class FileStorageCheckTests
{
    [Fact]
    public async Task Explicit_check_verifies_writes_and_removes_its_probe()
    {
        await using var f = await PipelineFixture.CreateAsync();
        f.Root.Writable = true;
        var status = Assert.Single(await FileStorageCheck.CheckAsync(f.Options, default));
        Assert.True(status.CanWrite);
        Assert.Null(status.Warning);
        Assert.Empty(Directory.EnumerateFileSystemEntries(Path.Combine(f.Root.Path, MutationPaths.OperationsDirectory)));
    }

    [Fact]
    public async Task Configured_read_only_does_not_touch_an_unavailable_volume()
    {
        var root = new LibraryOptions { Id = 1, Name = "Photos", Path = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N")) };
        var options = new IndexingOptions { Libraries = [root] };
        var status = Assert.Single(await FileStorageCheck.CheckAsync(options, default));
        Assert.False(status.ConfiguredWritable);
        Assert.False(status.CanWrite);
        Assert.Contains(":ro to :rw", status.Warning);
        Assert.False(Directory.Exists(root.Path));
    }

    [Fact]
    public async Task Unavailable_writable_volume_warns_without_crashing_or_creating_the_root()
    {
        var root = new LibraryOptions { Id = 1, Writable = true, Path = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N")) };
        var status = Assert.Single(await FileStorageCheck.CheckAsync(new IndexingOptions { Libraries = [root] }, default));
        Assert.False(status.CanWrite);
        Assert.Contains("browsing and playback remain available", status.Warning);
        Assert.False(Directory.Exists(root.Path));
    }

    [Fact]
    public async Task Read_only_mount_returns_a_warning_instead_of_throwing()
    {
        if (!OperatingSystem.IsLinux()) return;
        var root = new LibraryOptions { Id = 1, Writable = true, Path = "/sys" };
        var status = Assert.Single(await FileStorageCheck.CheckAsync(new IndexingOptions { Libraries = [root] }, default));
        Assert.False(status.CanWrite);
        Assert.Contains(":ro to :rw", status.Warning);
    }
}
