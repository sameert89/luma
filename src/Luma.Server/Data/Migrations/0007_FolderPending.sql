CREATE INDEX IX_Media_FolderPending ON Media(FolderId,Id)
WHERE Availability='present' AND ProcessingStatus='pending';
