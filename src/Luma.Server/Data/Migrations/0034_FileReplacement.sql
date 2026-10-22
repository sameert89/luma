ALTER TABLE FileOperations ADD COLUMN ReplacementId TEXT REFERENCES FileOperations(Id);
CREATE INDEX IX_FileOperations_Replacement ON FileOperations(ReplacementId) WHERE ReplacementId IS NOT NULL;
CREATE INDEX IX_OperationMedia_Media ON OperationMedia(MediaId,OperationId);
CREATE INDEX IX_OperationFolders_Folder ON OperationFolders(FolderId,OperationId);
CREATE INDEX IX_OperationComics_Comic ON OperationComics(ComicId,OperationId);
