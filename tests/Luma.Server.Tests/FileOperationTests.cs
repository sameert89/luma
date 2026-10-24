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

    [Theory]
    [InlineData("move", "running")]
    [InlineData("copy", "running")]
    [InlineData("move", "queued")]
    [InlineData("copy", "queued")]
    public async Task Visible_files_queue_during_discovery_and_execute_before_the_next_scan(string kind, string scanState)
    {
        await using var f = await PipelineFixture.CreateAsync();
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "destination"));
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "photo.jpg"), "original");
        await f.ScanAsync();
        var (operations, worker) = Services(f);
        await using var db = await f.Database.OpenAsync(default);
        var mediaId = await db.ExecuteScalarAsync<long>("SELECT Id FROM Media WHERE RelativePath='photo.jpg'");
        var scan = await f.NewScanAsync();
        await db.ExecuteAsync("UPDATE Scans SET State=@scanState WHERE Id=@Id", new { scan.Id, scanState });
        var accepted = await operations.QueueAsync(new(1, kind, "photo.jpg", "destination/photo.jpg"), default, mediaId: mediaId);
        Assert.Equal("queued", (await operations.GetAsync(accepted.Id, default)).State);
        Assert.True(File.Exists(Path.Combine(f.Root.Path, "photo.jpg")));
        if (scanState == "running")
        {
            Assert.Null(await worker.ClaimAsync(default));
            // Discovery can still add records after admission. Nothing moves under its reader.
            await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "late.jpg"), "late arrival");
            await f.Scanner.ScanAsync(scan, f.Root, default);
            Assert.Equal("present", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Media WHERE RelativePath='late.jpg'"));
        }
        var claimed = Assert.IsType<FileOperation>(await worker.ClaimAsync(default));
        Assert.Equal(accepted.Id, claimed.Id);
        await worker.ExecuteOperationAsync(claimed, false, default);
        Assert.Equal("completed", (await operations.GetAsync(accepted.Id, default)).State);
        Assert.Equal("original", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, "destination", "photo.jpg")));
        Assert.Equal(kind == "copy", File.Exists(Path.Combine(f.Root.Path, "photo.jpg")));
        if (kind == "move")
            Assert.Equal(mediaId, await db.ExecuteScalarAsync<long>("SELECT Id FROM Media WHERE RelativePath='destination/photo.jpg'"));
        if (scanState == "queued")
            Assert.Equal("queued", await db.ExecuteScalarAsync<string>("SELECT State FROM Scans WHERE Id=@Id", scan));
    }

    [Fact]
    public async Task A_folder_still_waits_for_discovery_and_visible_files_do_not_bypass_recovery()
    {
        await using var f = await PipelineFixture.CreateAsync();
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "album"));
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "photo.jpg"), "original");
        await f.ScanAsync();
        var (operations, _) = Services(f);
        await using var db = await f.Database.OpenAsync(default);
        var folderId = await db.ExecuteScalarAsync<long>("SELECT Id FROM Folders WHERE RelativePath='album'");
        var mediaId = await db.ExecuteScalarAsync<long>("SELECT Id FROM Media WHERE RelativePath='photo.jpg'");
        var scan = await f.NewScanAsync();
        var folderError = await Assert.ThrowsAsync<ApiRequestException>(() => operations.QueueAsync(new(1, "move", "album", "renamed"), default, folderId: folderId));
        Assert.Equal("library_busy", folderError.Code);
        await db.ExecuteAsync("UPDATE Scans SET State='completed' WHERE Id=@Id", scan);
        var pending = await operations.QueueAsync(new(1, "move", "album", "renamed"), default, folderId: folderId);
        await db.ExecuteAsync("UPDATE FileOperations SET State='needsAttention' WHERE Id=@Id", pending);
        var fileError = await Assert.ThrowsAsync<ApiRequestException>(() => operations.QueueAsync(new(1, "move", "photo.jpg", "renamed.jpg"), default, mediaId: mediaId));
        Assert.Equal("library_busy", fileError.Code);
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM FileOperations"));
    }

    [Theory]
    [InlineData("folder")]
    [InlineData("file")]
    [InlineData("mixed")]
    public async Task Clipboard_materializes_nullable_union_columns_for_every_selection(string selection)
    {
        await using var f = await PipelineFixture.CreateAsync();
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "album"));
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "photo.jpg"), "original");
        await f.ScanAsync();
        await using var db = await f.Database.OpenAsync(default);
        var entries = (await db.QueryAsync<FileClipboardEntry>("""
            SELECT LibraryId,RelativePath,Id AS MediaId,NULL AS FolderId FROM Media WHERE @selection IN ('file','mixed')
            UNION ALL
            SELECT LibraryId,RelativePath,NULL AS MediaId,Id AS FolderId FROM Folders WHERE ParentId IS NOT NULL AND @selection IN ('folder','mixed')
            """, new { selection })).ToArray();
        Assert.Equal(selection == "mixed" ? 2 : 1, entries.Length);
        Assert.All(entries, entry => Assert.Equal(1, entry.LibraryId));
        Assert.All(entries, entry => Assert.True(entry.MediaId.HasValue ^ entry.FolderId.HasValue));
        if (selection != "file") Assert.Contains(entries, entry => entry.RelativePath == "album" && entry.FolderId.HasValue);
    }

    [Fact]
    public async Task Recycle_paging_keeps_items_with_identical_deletion_timestamps()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var (operations, _) = Services(f);
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("""
            WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<101)
            INSERT INTO FileOperations(Id,LibraryId,Kind,Source,IsDirectory,SourceSize,SourceModifiedTicks,State,CreatedAt)
            SELECT printf('%032x',x),1,'recycle','photo-'||x,0,0,0,'completed','2026-10-24T00:00:00Z' FROM n;
            """);
        var first = await operations.TrashAsync(1, null, default);
        Assert.Equal(100, first.Count);
        var last = first[^1];
        var second = await operations.TrashAsync(1, last.CreatedAt + "|" + last.Id, default);
        Assert.Single(second);
        Assert.DoesNotContain(second[0].Id, first.Select(item => item.Id));
    }

    [Fact]
    public async Task A_missing_original_returns_a_useful_not_found_error_without_queuing_work()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var (operations, _) = Services(f);
        var error = await Assert.ThrowsAsync<ApiRequestException>(() => operations.QueueAsync(new(1, "move", "gone", "renamed"), default));
        Assert.Equal("source_missing", error.Code);
        await using var db = await f.Database.OpenAsync(default);
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM FileOperations"));
    }

    [Theory]
    [InlineData("restore")]
    [InlineData("purge")]
    public async Task Admitted_recycle_actions_disappear_immediately_and_cancelled_ones_return(string kind)
    {
        await using var f = await PipelineFixture.CreateAsync();
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "photo.jpg"), "original");
        await f.ScanAsync();
        var (operations, worker) = Services(f);
        var recycled = await RunAsync(operations, worker, f, new(1, "recycle", "photo.jpg"));
        Assert.Single(await operations.TrashAsync(1, null, default));
        var accepted = await operations.QueueAsync(new(1, kind, "photo.jpg", RecycleId: recycled.Id), default);
        Assert.Empty(await operations.TrashAsync(1, null, default));
        await operations.CancelAsync(accepted.Id, default);
        Assert.Single(await operations.TrashAsync(1, null, default));
        Assert.Equal("completed", (await RunAsync(operations, worker, f, new(1, kind, "photo.jpg", RecycleId: recycled.Id))).State);
        Assert.False(Directory.Exists(Path.Combine(f.Root.Path, ".luma-trash", recycled.Id)));
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

    private static async Task ResumeQueuedAsync(PipelineFixture f, FileOperations operations, FileOperationWorker worker, string id)
    {
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("UPDATE FileOperations SET State='running' WHERE Id=@id AND State='queued'", new { id });
        await worker.ExecuteOperationAsync(await operations.GetAsync(id, default), false, default);
    }

    [Fact]
    public async Task Confirmed_publication_recovery_keeps_the_original_id_and_a_replacement_source()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "photo.jpg"), "original");
        await f.ScanAsync();
        var (operations, worker) = Services(f);
        worker.Checkpoint = point => { if (point == "published-filesystem") throw new SimulatedCrash(); };
        await Assert.ThrowsAsync<SimulatedCrash>(() => RunAsync(operations, worker, f, new(1, "move", "photo.jpg", "moved.jpg")));
        worker.Checkpoint = null;
        await worker.RecoverAsync(default);
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "photo.jpg"), "unrelated replacement");
        await using var db = await f.Database.OpenAsync(default);
        var row = await db.QuerySingleAsync<FileOperation>("SELECT * FROM FileOperations");
        var mediaId = await db.ExecuteScalarAsync<long>("SELECT Id FROM Media");
        Assert.Equal("reserved", row.RecoveryState);
        var recovery = new FileRecovery(operations);
        var evidence = await recovery.InspectAsync(row.Id, default);
        Assert.Contains("confirmPublished", evidence.Actions);
        Assert.DoesNotContain("retry", evidence.Actions);
        await Assert.ThrowsAsync<ApiRequestException>(() => recovery.ResolveAsync(row.Id, new("confirmPublished", false, row.FailureCode), default));
        var target = Path.Combine(f.Root.Path, "moved.jpg");
        var modified = File.GetLastWriteTimeUtc(target);
        await File.WriteAllTextAsync(target, "unrelated destination with a different size");
        await Assert.ThrowsAsync<ApiRequestException>(() => recovery.ResolveAsync(row.Id, new("confirmPublished", true, row.FailureCode), default));
        Assert.Equal("needsAttention", (await operations.GetAsync(row.Id, default)).State);
        await File.WriteAllTextAsync(target, "original");
        File.SetLastWriteTimeUtc(target, modified);
        await recovery.ResolveAsync(row.Id, new("confirmPublished", true, row.FailureCode), default);
        // A restart after a queued recovery is claimed must preserve the chosen phase.
        await db.ExecuteAsync("UPDATE FileOperations SET State='running' WHERE Id=@Id", row);
        await worker.RecoverAsync(default);
        Assert.Equal("completed", (await operations.GetAsync(row.Id, default)).State);
        Assert.Equal(mediaId, await db.ExecuteScalarAsync<long>("SELECT Id FROM Media"));
        Assert.Equal("moved.jpg", await db.ExecuteScalarAsync<string>("SELECT RelativePath FROM Media"));
        Assert.Equal("unrelated replacement", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, "photo.jpg")));
    }

    [Fact]
    public async Task Publication_collision_can_be_retried_at_a_confirmed_alternative_without_overwrite()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "photo.jpg"), "original");
        await f.ScanAsync();
        var (operations, worker) = Services(f);
        worker.Checkpoint = point => { if (point == "reserved-journal") throw new SimulatedCrash(); };
        await Assert.ThrowsAsync<SimulatedCrash>(() => RunAsync(operations, worker, f, new(1, "move", "photo.jpg", "moved.jpg")));
        worker.Checkpoint = null;
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "moved.jpg"), "collision");
        await worker.RecoverAsync(default);
        await using var db = await f.Database.OpenAsync(default);
        var row = await db.QuerySingleAsync<FileOperation>("SELECT * FROM FileOperations");
        var recovery = new FileRecovery(operations);
        await Assert.ThrowsAsync<ApiRequestException>(() => recovery.ResolveAsync(row.Id, new("retry", true, row.FailureCode), default));
        await recovery.ResolveAsync(row.Id, new("retry", true, row.FailureCode, "alternative.jpg"), default);
        await ResumeQueuedAsync(f, operations, worker, row.Id);
        Assert.Equal("completed", (await operations.GetAsync(row.Id, default)).State);
        Assert.Equal("collision", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, "moved.jpg")));
        Assert.Equal("original", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, "alternative.jpg")));
        Assert.Equal("alternative.jpg", await db.ExecuteScalarAsync<string>("SELECT RelativePath FROM Media"));
    }

    [Fact]
    public async Task Changed_public_source_can_be_cancelled_but_never_restarted_or_deleted()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var source = Path.Combine(f.Root.Path, "photo.jpg");
        await File.WriteAllTextAsync(source, "original");
        await f.ScanAsync();
        var (operations, worker) = Services(f);
        var queued = await operations.QueueAsync(new(1, "delete", "photo.jpg"), default);
        await File.WriteAllTextAsync(source, "replacement with different size");
        await ResumeQueuedAsync(f, operations, worker, queued.Id);
        var recovery = new FileRecovery(operations);
        var evidence = await recovery.InspectAsync(queued.Id, default);
        Assert.Equal(new[] { "cancel" }, evidence.Actions);
        await Assert.ThrowsAsync<ApiRequestException>(() => recovery.ResolveAsync(queued.Id, new("restart", true, evidence.Operation.FailureCode), default));
        await recovery.ResolveAsync(queued.Id, new("cancel", true, evidence.Operation.FailureCode), default);
        Assert.Equal("cancelled", (await operations.GetAsync(queued.Id, default)).State);
        Assert.Equal("replacement with different size", await File.ReadAllTextAsync(source));
        await operations.QueueAsync(new(1, "mkdir", "new"), default);
    }

    [Fact]
    public async Task Interrupted_before_reservation_requires_renewed_operator_intent()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var source = Path.Combine(f.Root.Path, "photo.jpg");
        await File.WriteAllTextAsync(source, "original");
        await f.ScanAsync();
        var (operations, worker) = Services(f);
        var queued = await operations.QueueAsync(new(1, "recycle", "photo.jpg"), default);
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("UPDATE FileOperations SET State='running' WHERE Id=@Id", queued);
        await worker.RecoverAsync(default);
        var recovery = new FileRecovery(operations);
        var evidence = await recovery.InspectAsync(queued.Id, default);
        Assert.Contains("restart", evidence.Actions);
        Assert.DoesNotContain("retry", evidence.Actions);
        await recovery.ResolveAsync(queued.Id, new("restart", true, evidence.Operation.FailureCode), default);
        await ResumeQueuedAsync(f, operations, worker, queued.Id);
        Assert.Equal("completed", (await operations.GetAsync(queued.Id, default)).State);
        Assert.Equal("original", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, ".luma-trash", queued.Id, "content")));
    }

    [Fact]
    public async Task Independent_deletions_queue_without_waiting_and_do_not_rescan_the_folder()
    {
        await using var f = await PipelineFixture.CreateAsync();
        foreach (var name in new[] { "one.jpg", "two.jpg", "keep.jpg" }) await File.WriteAllTextAsync(Path.Combine(f.Root.Path, name), name);
        await f.ScanAsync();
        var (operations, worker) = Services(f);
        await using var db = await f.Database.OpenAsync(default);
        var scans = await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Scans");
        var refresh = new Luma.Server.Features.Indexing.AutomaticLibraryRefresh(f.Database, f.Options, NullLogger<Luma.Server.Features.Indexing.AutomaticLibraryRefresh>.Instance);
        refresh.ApplySettings(1, new(WatcherDebounceSeconds: 0, FileStabilitySeconds: 0));
        var one = await operations.QueueAsync(new(1, "recycle", "one.jpg"), default);
        var two = await operations.QueueAsync(new(1, "recycle", "two.jpg"), default);
        Assert.Equal("queued", (await operations.GetAsync(two.Id, default)).State);
        foreach (var id in new[] { one.Id, two.Id }) await ResumeQueuedAsync(f, operations, worker, id);
        refresh.Observe(f.Root, Path.Combine(f.Root.Path, "one.jpg"), WatcherChangeTypes.Deleted);
        refresh.Observe(f.Root, Path.Combine(f.Root.Path, "two.jpg"), WatcherChangeTypes.Deleted);
        refresh.Observe(f.Root, f.Root.Path, WatcherChangeTypes.Changed);
        await refresh.FlushStableChangesAsync(default);
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM DirtyFolders"));
        Assert.Equal(scans, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Scans"));
        Assert.Equal(2, (await operations.TrashAsync(1, null, default)).Count);
        Assert.True(File.Exists(Path.Combine(f.Root.Path, "keep.jpg")));
        // An unrelated external change in the same directory must still be discovered.
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "external.jpg"), "external");
        refresh.Observe(f.Root, Path.Combine(f.Root.Path, "external.jpg"), WatcherChangeTypes.Created);
        await refresh.FlushStableChangesAsync(default);
        await refresh.FlushStableChangesAsync(default);
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM DirtyFolders"));
    }

    [Fact]
    public async Task Queue_rejects_overlapping_sources_and_destinations_but_accepts_distinct_files()
    {
        await using var f = await PipelineFixture.CreateAsync();
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "album"));
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "album", "one.jpg"), "one");
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "two.jpg"), "two");
        await f.ScanAsync();
        var (operations, _) = Services(f);
        await operations.QueueAsync(new(1, "copy", "album", "copied"), default);
        Assert.Equal("path_busy", (await Assert.ThrowsAsync<ApiRequestException>(() => operations.QueueAsync(new(1, "recycle", "album/one.jpg"), default))).Code);
        Assert.Equal("path_busy", (await Assert.ThrowsAsync<ApiRequestException>(() => operations.QueueAsync(new(1, "move", "two.jpg", "copied"), default))).Code);
        await operations.QueueAsync(new(1, "recycle", "two.jpg"), default);
    }

    [Fact]
    public async Task Copy_indexes_only_the_new_path_keeps_source_identity_and_copies_tags()
    {
        await using var f = await PipelineFixture.CreateAsync();
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "album", "inner"));
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "album", "inner", "photo.jpg"), "original");
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "sibling.jpg"), "sibling");
        await f.ScanAsync();
        await using var db = await f.Database.OpenAsync(default);
        var sourceId = await db.ExecuteScalarAsync<long>("SELECT Id FROM Media WHERE RelativePath='album/inner/photo.jpg'");
        var siblingScan = await db.ExecuteScalarAsync<long>("SELECT LastSeenScanId FROM Media WHERE RelativePath='sibling.jpg'");
        await db.ExecuteAsync("INSERT INTO Tags(Id,Name,NormalizedKey) VALUES(1,'test','test'); INSERT INTO MediaTags VALUES(@sourceId,1)", new { sourceId });
        var (operations, worker) = Services(f);
        var row = await RunAsync(operations, worker, f, new(1, "copy", "album", "copied"));
        Assert.Equal("completed", row.State);
        Assert.Equal("original", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, "copied", "inner", "photo.jpg")));
        Assert.Equal(sourceId, await db.ExecuteScalarAsync<long>("SELECT Id FROM Media WHERE RelativePath='album/inner/photo.jpg'"));
        Assert.Equal(siblingScan, await db.ExecuteScalarAsync<long>("SELECT LastSeenScanId FROM Media WHERE RelativePath='sibling.jpg'"));
        Assert.Equal(2, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM MediaTags"));
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Scans WHERE State IN ('queued','running')"));
        await Assert.ThrowsAsync<ApiRequestException>(() => operations.QueueAsync(new(1, "copy", "album", "copied"), default));
        Assert.Equal("original", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, "album", "inner", "photo.jpg")));
    }

    [Fact]
    public async Task Interrupted_partial_copy_rebuilds_private_payload_without_publishing_partial_bytes()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "photo.jpg"), "complete original");
        await f.ScanAsync();
        var (operations, worker) = Services(f);
        var queued = await operations.QueueAsync(new(1, "copy", "photo.jpg", "copy.jpg"), default);
        var payload = MutationPaths.Internal(f.Root, MutationPaths.OperationsDirectory, queued.Id, "payload");
        Directory.CreateDirectory(Path.GetDirectoryName(payload)!);
        await File.WriteAllTextAsync(payload, "partial");
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("UPDATE FileOperations SET State='running' WHERE Id=@Id", queued);
        await worker.RecoverAsync(default);
        Assert.Equal("completed", (await operations.GetAsync(queued.Id, default)).State);
        Assert.Equal("complete original", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, "copy.jpg")));
        Assert.Equal("complete original", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, "photo.jpg")));
    }

    [Fact]
    public async Task Restore_overlap_checks_the_journal_source_instead_of_the_client_supplied_path()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "photo.jpg"), "original");
        await f.ScanAsync();
        var (operations, worker) = Services(f);
        var recycled = await RunAsync(operations, worker, f, new(1, "recycle", "photo.jpg"));
        await operations.QueueAsync(new(1, "restore", "photo.jpg", RecycleId: recycled.Id), default);
        var error = await Assert.ThrowsAsync<ApiRequestException>(() => operations.QueueAsync(new(1, "restore", "different.jpg", RecycleId: recycled.Id), default));
        Assert.Equal("path_busy", error.Code);
    }

    private sealed class SimulatedCrash : Exception;
    [Theory]
    [InlineData("copy")]
    [InlineData("move")]
    public async Task Explicit_replacement_preserves_the_old_file_and_tags_in_recycle_bin(string kind)
    {
        await using var f = await PipelineFixture.CreateAsync();
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "source.jpg"), "new bytes");
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "target.jpg"), "old bytes");
        await f.ScanAsync();
        await using var db = await f.Database.OpenAsync(default);
        var oldId = await db.ExecuteScalarAsync<long>("SELECT Id FROM Media WHERE RelativePath='target.jpg'");
        var sourceId = await db.ExecuteScalarAsync<long>("SELECT Id FROM Media WHERE RelativePath='source.jpg'");
        await db.ExecuteAsync("INSERT INTO Tags(Id,Name,NormalizedKey) VALUES(99,'old','OLD'); INSERT INTO MediaTags VALUES(@oldId,99)", new { oldId });
        var (operations, worker) = Services(f);
        var conflict = await Assert.ThrowsAsync<ApiRequestException>(() => operations.QueueAsync(new(1, kind, "source.jpg", "target.jpg"), default));
        Assert.Equal("destination_exists", conflict.Code);
        var replaced = await RunAsync(operations, worker, f, new(1, kind, "source.jpg", "target.jpg", ReplaceExisting: true));
        Assert.Equal("completed", replaced.State);
        Assert.NotNull(replaced.ReplacementId);
        Assert.Equal("new bytes", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, "target.jpg")));
        Assert.Equal("old bytes", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, ".luma-trash", replaced.ReplacementId!, "content")));
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM MediaTags WHERE MediaId=@oldId AND TagId=99", new { oldId }));
        Assert.Equal("missing", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Media WHERE Id=@oldId", new { oldId }));
        await Assert.ThrowsAsync<ApiRequestException>(() => new Luma.Server.Features.Media.OriginalContent(f.Database, f.Options).ServeAsync(oldId, false, new Microsoft.AspNetCore.Http.DefaultHttpContext(), default));
        await Assert.ThrowsAsync<ApiRequestException>(() => operations.QueueAsync(new(1, "delete", "target.jpg"), default, mediaId: oldId));
        Assert.Equal("new bytes", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, "target.jpg")));
        var targetId = await db.ExecuteScalarAsync<long>("SELECT Id FROM Media WHERE PathKey=@key", new { key = f.Root.Key("target.jpg") });
        Assert.NotEqual(oldId, targetId);
        if (kind == "move") Assert.Equal(sourceId, targetId);
        else Assert.True(File.Exists(Path.Combine(f.Root.Path, "source.jpg")));
        var restored = await RunAsync(operations, worker, f, new(1, "restore", "target.jpg", "previous.jpg", replaced.ReplacementId));
        Assert.Equal("completed", restored.State);
        Assert.Equal("old bytes", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, "previous.jpg")));
        Assert.Equal(oldId, await db.ExecuteScalarAsync<long>("SELECT Id FROM Media WHERE PathKey=@key", new { key = f.Root.Key("previous.jpg") }));
    }

    [Fact]
    public async Task Cancelling_a_queued_replacement_keeps_both_originals_in_place()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "source.jpg"), "new bytes");
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "target.jpg"), "old bytes");
        var (operations, _) = Services(f);
        var accepted = await operations.QueueAsync(new(1, "copy", "source.jpg", "target.jpg", ReplaceExisting: true), default);
        var queued = await operations.GetAsync(accepted.Id, default);
        var child = await Assert.ThrowsAsync<ApiRequestException>(() => operations.CancelAsync(queued.ReplacementId!, default));
        Assert.Equal("dependent_operation", child.Code);
        await operations.CancelAsync(accepted.Id, default);
        Assert.Equal("cancelled", (await operations.GetAsync(queued.ReplacementId!, default)).State);
        Assert.Equal("new bytes", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, "source.jpg")));
        Assert.Equal("old bytes", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, "target.jpg")));
    }

    [Fact]
    public async Task Replacing_a_destination_that_contains_the_source_is_rejected()
    {
        await using var f = await PipelineFixture.CreateAsync();
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "album", "nested"));
        var (operations, _) = Services(f);
        await Assert.ThrowsAsync<ApiRequestException>(() => operations.QueueAsync(new(1, "move", "album/nested", "album", ReplaceExisting: true), default));
        Assert.True(Directory.Exists(Path.Combine(f.Root.Path, "album", "nested")));
    }

    [Fact]
    public async Task Folder_replacement_keeps_the_recycled_tree_restorable_with_original_ids()
    {
        await using var f = await PipelineFixture.CreateAsync();
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "source"));
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "target"));
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "source", "new.jpg"), "new bytes");
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "target", "old.jpg"), "old bytes");
        await f.ScanAsync();
        await using var db = await f.Database.OpenAsync(default);
        var oldId = await db.ExecuteScalarAsync<long>("SELECT Id FROM Media WHERE RelativePath='target/old.jpg'");
        var (operations, worker) = Services(f);
        var result = await RunAsync(operations, worker, f, new(1, "move", "source", "target", ReplaceExisting: true));
        Assert.Equal("completed", result.State);
        Assert.Equal("new bytes", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, "target", "new.jpg")));
        Assert.False(File.Exists(Path.Combine(f.Root.Path, "target", "old.jpg")));
        var restored = await RunAsync(operations, worker, f, new(1, "restore", "target", "previous", result.ReplacementId));
        Assert.Equal("completed", restored.State);
        Assert.Equal("old bytes", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, "previous", "old.jpg")));
        Assert.Equal(oldId, await db.ExecuteScalarAsync<long>("SELECT Id FROM Media WHERE PathKey=@key", new { key = f.Root.Key("previous/old.jpg") }));
    }

    [Fact]
    public async Task Replacement_resolves_existing_case_aliases_using_the_library_key_policy()
    {
        await using var f = await PipelineFixture.CreateAsync();
        f.Root.CaseSensitive = false;
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("UPDATE Libraries SET CaseSensitive=0");
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "source.jpg"), "new bytes");
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "Target.jpg"), "old bytes");
        await f.ScanAsync();
        var (operations, worker) = Services(f);
        var result = await RunAsync(operations, worker, f, new(1, "copy", "source.jpg", "target.JPG", ReplaceExisting: true));
        Assert.Equal("completed", result.State);
        Assert.Equal("new bytes", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, "target.JPG")));
        Assert.Equal("old bytes", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, ".luma-trash", result.ReplacementId!, "content")));
    }

}
