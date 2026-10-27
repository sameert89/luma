ALTER TABLE Folders ADD COLUMN Missing INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IX_Folders_Missing ON Folders(Id) WHERE Missing=1;
CREATE INDEX IX_FileOperations_Trash_Page ON FileOperations(LibraryId,CreatedAt DESC,Id DESC) WHERE Kind='recycle' AND Restored=0;
CREATE INDEX IX_UploadSessions_Cleanup ON UploadSessions(Id) WHERE State IN ('completed','cancelled');
CREATE INDEX IX_FileOperations_RecycleActive ON FileOperations(RecycleId) WHERE State IN ('queued','running','reserved','deleting','published','finalizing','needsAttention');
