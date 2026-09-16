ALTER TABLE Scans ADD COLUMN FolderId INTEGER REFERENCES Folders(Id);
ALTER TABLE Folders ADD COLUMN DirectIndexedAt TEXT;
UPDATE Folders SET DirectIndexedAt=(SELECT FinishedAt FROM Scans WHERE Id=Folders.LastSeenScanId AND State='completed');
