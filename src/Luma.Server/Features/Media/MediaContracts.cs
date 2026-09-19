namespace Luma.Server.Features.Media;

public sealed record TagSummary(long Id,string Name);
public sealed record CacheRepresentation(string Url,string Status,int? Width,int? Height);
public sealed record MediaSummary(long Id,long LibraryId,long FolderId,string FileName,string MediaType,string Extension,
    long SizeBytes,int? Width,int? Height,long? DurationMs,string ModifiedAt,string EffectiveDate,string? CapturedAt,
    string Preference,string Availability,CacheRepresentation Thumbnail,CacheRepresentation Preview,IReadOnlyList<TagSummary> Tags,string? GroupKey = null,string? GroupLabel = null,WatchState? WatchProgress = null);
public sealed record MediaPage(IReadOnlyList<MediaSummary> Items,string? NextCursor,string? PreviousCursor,string? Seed = null);
public sealed record MediaNeighbors(MediaSummary? Previous,MediaSummary? Next);
public sealed record MediaPriorityRequest(IReadOnlyList<long> Ids,bool Previews = false);
public sealed class MediaRow
{
    public long Id {get;set;} public long LibraryId {get;set;} public long FolderId {get;set;}
    public string FileName {get;set;}=""; public string MediaType {get;set;}=""; public string Extension {get;set;}="";
    public long SizeBytes {get;set;} public int? Width {get;set;} public int? Height {get;set;} public long? DurationMs {get;set;}
    public string ModifiedAt {get;set;}=""; public long ModifiedTicks {get;set;} public string EffectiveDate {get;set;}="";
    public string? CapturedAt {get;set;} public string Preference {get;set;}=""; public string Availability {get;set;}="";
    public long EffectiveTicks {get;set;} public string NameKey {get;set;}=""; public long RandomKey {get;set;}
    public long SourceRevision {get;set;}
    public string ProcessingStatus {get;set;}="";
    // The group a row was listed under when the group is not one of its own columns: tag grouping
    // repeats a row under each of its tags, so the listing stamps the tag it came from.
    public long? GroupValue {get;set;}
}
