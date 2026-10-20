using Luma.Server.Features.Indexing;
using Dapper;
using Luma.Server.Features.Files;
using Luma.Server.Features.Uploads;
using Luma.Server.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace Luma.Server.Tests;

public sealed class UploadSessionTests
{
    private static (FileOperations Operations, UploadSessions Uploads, FileOperationWorker Worker) Services(PipelineFixture f)
    {
        f.Root.Writable = true;
        var operations = new FileOperations(f.Database, f.Options);
        return (operations, new(f.Database, operations, new ConfigurationBuilder().Build()), new(operations, f.Database, NullLogger<FileOperationWorker>.Instance));
    }

    [Fact]
    public async Task Retrying_creation_after_a_lost_response_returns_the_durable_session()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var (_, uploads, _) = Services(f);
        var id = Guid.NewGuid().ToString("N");
        var request = new UploadRequest(1, "photo.jpg", 3, id);
        await uploads.CreateAsync(request, default);
        await uploads.AppendAsync(id, 0, new MemoryStream("abc"u8.ToArray()), 3, default);
        var restarted = new UploadSessions(f.Database, new FileOperations(f.Database, f.Options), new ConfigurationBuilder().Build());
        var checkpoint = await restarted.CreateAsync(request, default);
        Assert.Equal(id, checkpoint.Id);
        Assert.Equal(3, checkpoint.CommittedOffset);
        var conflict = await Assert.ThrowsAsync<ApiRequestException>(() => restarted.CreateAsync(request with { Target = "different.jpg" }, default));
        Assert.Equal("upload_request_mismatch", conflict.Code);
        await using var db = await f.Database.OpenAsync(default);
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM UploadSessions"));
    }

    [Fact]
    public async Task Active_destinations_respect_the_root_case_policy()
    {
        await using var f = await PipelineFixture.CreateAsync();
        f.Root.CaseSensitive = false;
        var (_, uploads, _) = Services(f);
        await uploads.CreateAsync(new(1, "Photo.jpg", 3), default);
        var conflict = await Assert.ThrowsAsync<ApiRequestException>(() => uploads.CreateAsync(new(1, "photo.JPG", 3), default));
        Assert.Equal("library_busy", conflict.Code);
    }

    [Fact]
    public async Task Failed_staging_deletion_keeps_the_session_reserved_until_cancel_retries()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var (operations, uploads, _) = Services(f);
        var upload = await uploads.CreateAsync(new(1, "photo.jpg", 3), default);
        await uploads.AppendAsync(upload.Id, 0, new MemoryStream("abc"u8.ToArray()), 3, default);
        var staging = Path.Combine(f.Root.Path, ".luma-uploads", upload.Id, "content");
        File.Delete(staging);
        Directory.CreateDirectory(staging);
        await Assert.ThrowsAnyAsync<IOException>(async () =>
        {
            try { await uploads.ChangeStateAsync(upload.Id, "cancel", default); }
            catch (UnauthorizedAccessException error) { throw new IOException("Staging is not a file", error); }
        });
        Assert.Equal("waitingForClient", (await uploads.GetAsync(upload.Id, default)).State);
        await Assert.ThrowsAsync<ApiRequestException>(() => operations.QueueAsync(new(1, "mkdir", "photo.jpg"), default));
        Directory.Delete(staging);
        await uploads.ChangeStateAsync(upload.Id, "cancel", default);
        Assert.Equal("cancelled", (await uploads.ChangeStateAsync(upload.Id, "cancel", default)).State);
    }

    [Fact]
    public async Task Upload_folder_creation_distinguishes_a_directory_from_a_file_collision()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var (operations, _, _) = Services(f);
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "chapter"));
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "file"), "original");
        var folder = await Assert.ThrowsAsync<ApiRequestException>(() => operations.QueueAsync(new(1, "mkdir", "chapter"), default));
        Assert.Equal("directory_exists", folder.Code);
        var file = await Assert.ThrowsAsync<ApiRequestException>(() => operations.QueueAsync(new(1, "mkdir", "file"), default));
        Assert.Equal("destination_exists", file.Code);
        Assert.Equal("original", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, "file")));
    }

    [Fact]
    public async Task Offset_is_durable_and_duplicate_chunks_cannot_append_twice()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var (_, uploads, _) = Services(f);
        var upload = await uploads.CreateAsync(new(1, "photo.jpg", 6), default);
        var first = await uploads.AppendAsync(upload.Id, 0, new MemoryStream("abc"u8.ToArray()), 3, default);
        Assert.Equal(3, first.CommittedOffset);
        var duplicate = await Assert.ThrowsAsync<ApiRequestException>(() => uploads.AppendAsync(upload.Id, 0, new MemoryStream("abc"u8.ToArray()), 3, default));
        Assert.Equal("upload_offset_mismatch", duplicate.Code);
        var restarted = new UploadSessions(f.Database, new FileOperations(f.Database, f.Options), new ConfigurationBuilder().Build());
        Assert.Equal(3, (await restarted.GetAsync(upload.Id, default)).CommittedOffset);
        await restarted.AppendAsync(upload.Id, 3, new MemoryStream("def"u8.ToArray()), 3, default);
        Assert.Equal("abcdef", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, ".luma-uploads", upload.Id, "content")));
        Assert.False(File.Exists(Path.Combine(f.Root.Path, "photo.jpg")));
    }

    [Fact]
    public async Task Interrupted_chunk_keeps_committed_prefix_and_discards_its_tail_on_retry()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var (_, uploads, _) = Services(f);
        var upload = await uploads.CreateAsync(new(1, "photo.jpg", 6), default);
        await uploads.AppendAsync(upload.Id, 0, new MemoryStream("abc"u8.ToArray()), 3, default);
        await Assert.ThrowsAsync<ApiRequestException>(() => uploads.AppendAsync(upload.Id, 3, new MemoryStream("x"u8.ToArray()), 3, default));
        Assert.Equal(3, (await uploads.GetAsync(upload.Id, default)).CommittedOffset);
        await uploads.AppendAsync(upload.Id, 3, new MemoryStream("def"u8.ToArray()), 3, default);
        Assert.Equal("abcdef", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, ".luma-uploads", upload.Id, "content")));
    }

    [Fact]
    public async Task Publication_is_journaled_and_indexing_only_sees_completed_files()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var (operations, uploads, worker) = Services(f);
        var upload = await uploads.CreateAsync(new(1, "photo.jpg", 6), default);
        await Assert.ThrowsAsync<ApiRequestException>(() => uploads.FinalizeAsync(upload.Id, default));
        await uploads.AppendAsync(upload.Id, 0, new MemoryStream("abcdef"u8.ToArray()), 6, default);
        Assert.Empty(SourceTraversal.Enumerate(f.Root.Path));
        var finalized = await uploads.FinalizeAsync(upload.Id, default);
        Assert.Equal(finalized.OperationId, (await uploads.FinalizeAsync(upload.Id, default)).OperationId);
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("UPDATE FileOperations SET State='running'");
        await worker.ExecuteOperationAsync(await operations.GetAsync(finalized.OperationId!, default), false, default);
        Assert.Equal("completed", (await uploads.GetAsync(upload.Id, default)).State);
        Assert.Equal("abcdef", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, "photo.jpg")));
        Assert.Equal(0, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Scans WHERE State='queued'"));
        Assert.Equal("present", await db.ExecuteScalarAsync<string>("SELECT Availability FROM Media WHERE RelativePath='photo.jpg'"));
        var request = await db.ExecuteScalarAsync<string>("SELECT Request FROM MetadataJobs WHERE Kind='import' ORDER BY Id DESC LIMIT 1");
        Assert.NotNull(request);
        Assert.Contains("MediaIds", request);
        Assert.DoesNotContain("\"MediaIds\":null", request);
    }

    [Fact]
    public async Task Waiting_upload_reserves_only_its_target_without_consuming_a_worker()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var (operations, uploads, _) = Services(f);
        var upload = await uploads.CreateAsync(new(1, "photo.jpg", 3), default);
        Assert.Equal("queued", (await operations.GetAsync((await operations.QueueAsync(new(1, "mkdir", "unrelated"), default)).Id, default)).State);
        await Assert.ThrowsAsync<ApiRequestException>(() => operations.QueueAsync(new(1, "mkdir", "photo.jpg"), default));
        await uploads.ChangeStateAsync(upload.Id, "pause", default);
        await Assert.ThrowsAsync<ApiRequestException>(() => uploads.AppendAsync(upload.Id, 0, new MemoryStream("abc"u8.ToArray()), 3, default));
        await uploads.ChangeStateAsync(upload.Id, "resume", default);
        await uploads.AppendAsync(upload.Id, 0, new MemoryStream("abc"u8.ToArray()), 3, default);
        await uploads.ChangeStateAsync(upload.Id, "cancel", default);
        Assert.False(File.Exists(Path.Combine(f.Root.Path, ".luma-uploads", upload.Id, "content")));
        Assert.Equal("cancelled", (await uploads.GetAsync(upload.Id, default)).State);
        Assert.Equal("queued", (await operations.GetAsync((await operations.QueueAsync(new(1, "mkdir", "new"), default)).Id, default)).State);
    }

    [Fact]
    public async Task Chunk_limits_and_changed_destinations_are_rejected()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var (_, uploads, _) = Services(f);
        var upload = await uploads.CreateAsync(new(1, "photo.jpg", 3), default);
        await Assert.ThrowsAsync<ApiRequestException>(() => uploads.AppendAsync(upload.Id, 0, Stream.Null, UploadSessions.ChunkBytes + 1L, default));
        await uploads.AppendAsync(upload.Id, 0, new MemoryStream("abc"u8.ToArray()), 3, default);
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "photo.jpg"), "replacement");
        await Assert.ThrowsAsync<ApiRequestException>(() => uploads.FinalizeAsync(upload.Id, default));
        Assert.Equal("replacement", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, "photo.jpg")));
    }
    [Fact]
    public async Task Distinct_uploads_can_start_and_finalize_while_other_publications_are_queued()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var (operations, uploads, _) = Services(f);
        await operations.QueueAsync(new(1, "mkdir", "unrelated"), default);
        var first = await uploads.CreateAsync(new(1, "first.jpg", 0), default);
        var second = await uploads.CreateAsync(new(1, "second.jpg", 0), default);
        Assert.Equal("finalizing", (await uploads.FinalizeAsync(first.Id, default)).State);
        Assert.Equal("finalizing", (await uploads.FinalizeAsync(second.Id, default)).State);
        Assert.Equal("waitingForClient", (await uploads.CreateAsync(new(1, "third.jpg", 0), default)).State);
        var conflict = await Assert.ThrowsAsync<ApiRequestException>(() => operations.QueueAsync(new(1, "mkdir", "first.jpg"), default));
        Assert.Equal("path_busy", conflict.Code);
    }

    [Fact]
    public async Task Uploads_reject_overlapping_queued_subtrees_but_allow_sibling_paths()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var (operations, uploads, _) = Services(f);
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "album"));
        await operations.QueueAsync(new(1, "move", "album", "moved"), default);
        var conflict = await Assert.ThrowsAsync<ApiRequestException>(() => uploads.CreateAsync(new(1, "album", 0), default));
        Assert.Equal("path_busy", conflict.Code);
        Directory.CreateDirectory(Path.Combine(f.Root.Path, "sibling"));
        Assert.Equal("waitingForClient", (await uploads.CreateAsync(new(1, "sibling/new.jpg", 0), default)).State);
    }

    [Fact]
    public async Task Replacing_an_upload_keeps_the_old_file_until_journaled_publication_and_recycles_it()
    {
        await using var f = await PipelineFixture.CreateAsync();
        await File.WriteAllTextAsync(Path.Combine(f.Root.Path, "photo.jpg"), "old bytes");
        await f.ScanAsync();
        var (operations, uploads, worker) = Services(f);
        await Assert.ThrowsAsync<ApiRequestException>(() => uploads.CreateAsync(new(1, "photo.jpg", 3), default));
        var upload = await uploads.CreateAsync(new(1, "photo.jpg", 3, ReplaceExisting: true), default);
        await uploads.AppendAsync(upload.Id, 0, new MemoryStream("new"u8.ToArray()), 3, default);
        Assert.Equal("old bytes", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, "photo.jpg")));
        await Assert.ThrowsAsync<ApiRequestException>(() => uploads.FinalizeAsync(upload.Id, default));
        var finalized = await uploads.FinalizeAsync(upload.Id, default, replaceExisting: true);
        Assert.Equal("old bytes", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, "photo.jpg")));
        await using var db = await f.Database.OpenAsync(default);
        await db.ExecuteAsync("UPDATE FileOperations SET State='running' WHERE Id=@Id", new { Id = finalized.OperationId });
        await worker.ExecuteOperationAsync(await operations.GetAsync(finalized.OperationId!, default), false, default);
        var published = await operations.GetAsync(finalized.OperationId!, default);
        Assert.Equal("completed", published.State);
        Assert.Equal("new", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, "photo.jpg")));
        Assert.Equal("old bytes", await File.ReadAllTextAsync(Path.Combine(f.Root.Path, ".luma-trash", published.RecycleId!, "content")));
    }

}
