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
        await Assert.ThrowsAsync<ApiRequestException>(() => operations.QueueAsync(new(1, "mkdir", "new"), default));
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
        Assert.Equal(1, await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Scans WHERE State='queued'"));
    }

    [Fact]
    public async Task Waiting_upload_reserves_the_library_without_consuming_a_worker()
    {
        await using var f = await PipelineFixture.CreateAsync();
        var (operations, uploads, _) = Services(f);
        var upload = await uploads.CreateAsync(new(1, "photo.jpg", 3), default);
        await Assert.ThrowsAsync<ApiRequestException>(() => operations.QueueAsync(new(1, "mkdir", "new"), default));
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
}
