using Dapper;
using Luma.Server.Features.Files;
using Luma.Server.Http;
using Microsoft.Extensions.Logging.Abstractions;

namespace Luma.Server.Tests;

public sealed class FileOperationTests
{
    private static (FileOperations Operations, FileOperationWorker Worker) Services(PipelineFixture f)
    {
        f.Root.Writable = true;
        var operations = new FileOperations(f.Database, f.Options);
        return (operations, new(operations, f.Database, NullLogger<FileOperationWorker>.Instance));
    }

    private static async Task<FileOperation> RunAsync(FileOperations operations, FileOperationWorker worker,
        PipelineFixture f, FileOperationRequest request)
    {
        var accepted = await operations.QueueAsync(request, default);
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("UPDATE FileOperations SET State='running' WHERE Id=@Id", accepted);
        var row = await operations.GetAsync(accepted.Id, default);
        await worker.ExecuteOperationAsync(row, false, default);
        return await operations.GetAsync(row.Id, default);
    }

    [Fact]
    public async Task Recycle_and_restore_keep_identity_tags_preferences_and_hidden_state()
    {
        await using var f = await PipelineFixture.CreateAsync();
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "album", "inner"));
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "album", "inner", "photo.jpg"), "original bytes");
        await f.ScanAsync();
        await using var db = await f.Database.OpenAsync(default);
        var id = await db.ExecuteScalarAsync<long>("SELECT Id FROM Media");
        await db.ExecuteAsync("UPDATE Media SET Preference='liked'; INSERT INTO Tags(Id,Name,NormalizedKey) VALUES(1,'test','test'); INSERT INTO MediaTags VALUES(@id,1); UPDATE Folders SET Hidden=1 WHERE RelativePath='album/inner'", new { id });
        var (operations, worker) = Services(f);
        var recycled = await RunAsync(operations, worker, f, new(1, "recycle", "album"));
        Assert.Equal("completed", recycled.State);
        Assert.False(Directory.Exists(Path.Combine(f.Root.Path, "album")));
        Assert.Equal("original bytes", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, ".luma-trash", recycled.Id, "content", "inner", "photo.jpg")));
        Assert.Equal("missing", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Media WHERE Id=@id", new { id }));
        var restored = await RunAsync(operations, worker, f, new(1, "restore", "album", RecycleId: recycled.Id));
        Assert.Equal("completed", restored.State);
        Assert.Equal(id, await db.ExecuteScalarAsync<long>("SELECT Id FROM Media"));
        Assert.Equal("liked", await db.ExecuteScalarAsync<string>("SELECT Preference FROM Media"));
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM MediaTags"));
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT Hidden FROM Folders WHERE RelativePath='album/inner'"));
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT SUM(Recycled) FROM Folders"));
        Assert.Equal("present", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Media"));
        Assert.Empty(await operations.TrashAsync(1, null, default));
    }

    [Fact]
    public async Task Moving_a_folder_updates_descendant_paths_and_ancestry_without_new_ids()
    {
        await using var f = await PipelineFixture.CreateAsync();
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "album", "inner"));
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "destination"));
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "album", "inner", "photo.jpg"), "original");
        await f.ScanAsync();
        await using var db = await f.Database.OpenAsync(default);
        var id = await db.ExecuteScalarAsync<long>("SELECT Id FROM Media");
        var oldFolder = await db.ExecuteScalarAsync<long>("SELECT FolderId FROM Media");
        var (operations, worker) = Services(f);
        Assert.Equal("completed", (await RunAsync(operations, worker, f, new(1, "move", "album", "destination/renamed"))).State);
        Assert.Equal(id, await db.ExecuteScalarAsync<long>("SELECT Id FROM Media"));
        Assert.Equal(oldFolder, await db.ExecuteScalarAsync<long>("SELECT FolderId FROM Media"));
        Assert.Equal("destination/renamed/inner/photo.jpg", await db.ExecuteScalarAsync<string>("SELECT RelativePath FROM Media"));
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM FolderAncestry a JOIN Folders f ON f.Id=a.AncestorId WHERE f.RelativePath='destination' AND a.DescendantId=@oldFolder", new { oldFolder }));
    }

    [Theory]
    [InlineData("reserved-filesystem")]
    [InlineData("reserved-journal")]
    [InlineData("before-metadata")]
    public async Task Interrupted_recycle_recovers_from_owned_staging(string boundary)
    {
        await using var f = await PipelineFixture.CreateAsync();
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "photo.jpg"), "original");
        await f.ScanAsync();
        var (operations, worker) = Services(f);
        worker.Checkpoint = point => { if (point == boundary) throw new SimulatedCrash(); };
        await Assert.ThrowsAsync<SimulatedCrash>(() => RunAsync(operations, worker, f, new(1, "recycle", "photo.jpg")));
        worker.Checkpoint = null;
        await worker.RecoverAsync(default);
        await using var db = await f.Database.OpenAsync(default);
        var row = await db.QuerySingleAsync<FileOperation>("SELECT * FROM FileOperations");
        Assert.Equal("completed", row.State);
        Assert.True(File.Exists(Path.Combine(f.Root.Path, ".luma-trash", row.Id, "content")));
        Assert.Equal("missing", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Media"));
    }

    [Fact]
    public async Task Delete_recovery_never_touches_a_replacement_at_the_public_source()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var source = Path.Combine(f.Root.Path, "photo.jpg");
        await File.WriteAllTextAsync(source, "original");
        await f.ScanAsync();
        var (operations, worker) = Services(f);
        worker.Checkpoint = point => { if (point == "reserved-journal") throw new SimulatedCrash(); };
        await Assert.ThrowsAsync<SimulatedCrash>(() => RunAsync(operations, worker, f, new(1, "delete", "photo.jpg")));
        await File.WriteAllTextAsync(source, "replacement must survive");
        worker.Checkpoint = null;
        await worker.RecoverAsync(default);
        Assert.Equal("replacement must survive", await File.ReadAllTextAsync(source));
        await using var db = await f.Database.OpenAsync(default);
        Assert.Equal("completed", await db.ExecuteScalarAsync<string>("SELECT State FROM FileOperations"));
    }

    [Fact]
    public async Task Uncertain_publication_is_visible_and_never_overwrites_or_guesses()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "photo.jpg"), "original");
        await f.ScanAsync();
        var (operations, worker) = Services(f);
        worker.Checkpoint = point => { if (point == "published-filesystem") throw new SimulatedCrash(); };
        await Assert.ThrowsAsync<SimulatedCrash>(() => RunAsync(operations, worker, f, new(1, "move", "photo.jpg", "moved.jpg")));
        worker.Checkpoint = null;
        await worker.RecoverAsync(default);
        await using var db = await f.Database.OpenAsync(default);
        Assert.Equal("needsAttention", await db.ExecuteScalarAsync<string>("SELECT State FROM FileOperations"));
        Assert.Equal("original", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, "moved.jpg")));
        Assert.Equal("photo.jpg", await db.ExecuteScalarAsync<string>("SELECT RelativePath FROM Media"));
        Assert.Equal(409, (await Assert.ThrowsAsync<ApiRequestException>(() => operations.QueueAsync(new(1, "mkdir", "new"), default))).Status);
    }

    [Fact]
    public async Task Restore_conflicts_leave_recycled_content_intact()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var path = Path.Combine(f.Root.Path, "photo.jpg");
        await File.WriteAllTextAsync(path, "original");
        await f.ScanAsync();
        var (operations, worker) = Services(f);
        var recycle = await RunAsync(operations, worker, f, new(1, "recycle", "photo.jpg"));
        await File.WriteAllTextAsync(path, "replacement");
        await Assert.ThrowsAsync<ApiRequestException>(() => operations.QueueAsync(new(1, "restore", "photo.jpg", RecycleId: recycle.Id), default));
        Assert.Equal("replacement", await File.ReadAllTextAsync(path));
        Assert.Equal("completed", (await RunAsync(operations, worker, f, new(1, "restore", "photo.jpg", "restored.jpg", recycle.Id))).State);
        Assert.Equal("original", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, "restored.jpg")));
    }

    [Fact]
    public async Task Source_replacement_and_read_only_roots_fail_closed()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var path = Path.Combine(f.Root.Path, "photo.jpg");
        await File.WriteAllTextAsync(path, "original");
        await f.ScanAsync();
        var operations = new FileOperations(f.Database, f.Options);
        Assert.Equal(403, (await Assert.ThrowsAsync<ApiRequestException>(() => operations.QueueAsync(new(1, "delete", "photo.jpg"), default))).Status);
        f.Root.Writable = true;
        var worker = new FileOperationWorker(operations, f.Database, NullLogger<FileOperationWorker>.Instance);
        var queued = await operations.QueueAsync(new(1, "delete", "photo.jpg"), default);
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("UPDATE FileOperations SET State='running'");
        await File.WriteAllTextAsync(path, "unrelated replacement");
        await worker.ExecuteOperationAsync(await operations.GetAsync(queued.Id, default), false, default);
        Assert.Equal("needsAttention", (await operations.GetAsync(queued.Id, default)).State);
        Assert.Equal("unrelated replacement", await File.ReadAllTextAsync(path));
    }

    private sealed class SimulatedCrash : Exception;
}
