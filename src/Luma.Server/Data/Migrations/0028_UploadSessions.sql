CREATE TABLE UploadSessions (
    Id TEXT PRIMARY KEY,
    LibraryId INTEGER NOT NULL REFERENCES Libraries(Id),
    Target TEXT NOT NULL,
    SizeBytes INTEGER NOT NULL,
    CommittedOffset INTEGER NOT NULL DEFAULT 0,
    State TEXT NOT NULL DEFAULT 'waitingForClient',
    CreatedAt TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL,
    OperationId TEXT REFERENCES FileOperations(Id),
    QueueDismissed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IX_UploadSessions_Active ON UploadSessions(LibraryId,State);
CREATE UNIQUE INDEX IX_UploadSessions_Target ON UploadSessions(LibraryId,Target) WHERE State IN ('waitingForClient','paused','finalizing');
ALTER TABLE FileOperations ADD COLUMN UploadId TEXT REFERENCES UploadSessions(Id);
