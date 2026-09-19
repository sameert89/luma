-- Cover lookup excludes unprocessed files and seeks by library/folder before cache checks.
CREATE INDEX IX_Media_AlbumCover ON Media(LibraryId, FolderId, Id)
WHERE Availability='present' AND ProcessingStatus='ready';
