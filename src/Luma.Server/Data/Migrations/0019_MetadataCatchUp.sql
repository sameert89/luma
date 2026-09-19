-- Opening an indexed folder checks whether an import ever attempted each of its media,
-- so the check needs to find a media item's job items without scanning every job.
CREATE INDEX IX_MetadataJobItems_Media ON MetadataJobItems(MediaId,JobId);
