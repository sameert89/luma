-- Cover selection seeks the newest ready media separately in each descendant folder.
-- Keep the status predicate in the index so unprocessed files do not force a full folder scan.
CREATE INDEX IX_Media_ReadyFolderCover
ON Media(FolderId,ModifiedTicks DESC,Id DESC)
WHERE Availability='present' AND ProcessingStatus='ready';
