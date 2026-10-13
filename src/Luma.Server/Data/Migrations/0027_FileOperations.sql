CREATE TABLE FileOperations (
    Id TEXT PRIMARY KEY,
    LibraryId INTEGER NOT NULL REFERENCES Libraries(Id),
    Kind TEXT NOT NULL,
    Source TEXT NOT NULL,
    Destination TEXT,
    RecycleId TEXT REFERENCES FileOperations(Id),
    IsDirectory INTEGER NOT NULL,
    SourceSize INTEGER NOT NULL,
    SourceModifiedTicks INTEGER NOT NULL,
    State TEXT NOT NULL DEFAULT 'queued',
    CreatedAt TEXT NOT NULL,
    FinishedAt TEXT,
    FailureCode TEXT,
    QueueDismissed INTEGER NOT NULL DEFAULT 0,
    Restored INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IX_FileOperations_Queue ON FileOperations(State,CreatedAt);
CREATE INDEX IX_FileOperations_Library ON FileOperations(LibraryId,State);
CREATE INDEX IX_FileOperations_Trash ON FileOperations(LibraryId,CreatedAt) WHERE Kind='recycle' AND Restored=0;
CREATE TABLE OperationMedia (
    OperationId TEXT NOT NULL REFERENCES FileOperations(Id),
    MediaId INTEGER NOT NULL REFERENCES Media(Id),
    OriginalPath TEXT NOT NULL,
    OriginalAvailability TEXT NOT NULL,
    PRIMARY KEY(OperationId,MediaId)
);
CREATE TABLE OperationFolders (
    OperationId TEXT NOT NULL REFERENCES FileOperations(Id),
    FolderId INTEGER NOT NULL REFERENCES Folders(Id),
    OriginalPath TEXT NOT NULL,
    PRIMARY KEY(OperationId,FolderId)
);
ALTER TABLE Folders ADD COLUMN Recycled INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IX_Folders_Recycled ON Folders(Id) WHERE Recycled=1;
