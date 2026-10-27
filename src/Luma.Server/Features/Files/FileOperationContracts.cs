namespace Luma.Server.Features.Files;

public sealed record FileOperationRequest(long LibraryId, string Kind, string Source, string? Destination = null, string? RecycleId = null, bool ReplaceExisting = false);
public sealed record FileOperationAccepted(string Id);
public sealed record FileCapability(long LibraryId, bool Writable);
public sealed record FileCapabilities(bool AccessConfigured, IReadOnlyList<FileCapability> Libraries);
public sealed class FileOperation
{
    public string Id { get; set; } = "";
    public long LibraryId { get; set; }
    public string Kind { get; set; } = "";
    public string Source { get; set; } = "";
    public string? Destination { get; set; }
    public string? RecycleId { get; set; }
    public string? ReplacementId { get; set; }
    public string? UploadId { get; set; }
    public bool IsDirectory { get; set; }
    public long SourceSize { get; set; }
    public long SourceModifiedTicks { get; set; }
    public string State { get; set; } = "queued";
    public string CreatedAt { get; set; } = "";
    public string? FinishedAt { get; set; }
    public string? FailureCode { get; set; }
    public string? RecoveryState { get; set; }
    public bool RecoveryRequested { get; set; }
    public bool Restored { get; set; }
}

public sealed record FileLocation(long LibraryId, string RelativePath);
public sealed record FileItemRequest(long LibraryId, string Kind, long? MediaId = null, long? FolderId = null, string? Destination = null, bool ReplaceExisting = false);

public sealed record FileSelectionRequest(long[] MediaIds, long[] FolderIds);
// SQLite reports NULL UNION columns as blobs. Property mapping lets Dapper handle
// either files or folders as the first row without inferring a constructor signature.
public sealed class FileClipboardEntry
{
    public required long LibraryId { get; set; }
    public required string RelativePath { get; set; } = "";
    public required long? MediaId { get; set; }
    public required long? FolderId { get; set; }
}
