-- Panels shares library change-detection policy, but owns its durable work/checkpoints.
ALTER TABLE ComicJobs ADD COLUMN Shallow INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ComicJobs ADD COLUMN Automatic INTEGER NOT NULL DEFAULT 0;
ALTER TABLE Comics ADD COLUMN SourceFingerprint TEXT;
CREATE TABLE ComicFolders (
    LibraryId INTEGER NOT NULL REFERENCES Libraries(Id),
    RelativePath TEXT NOT NULL,
    PathKey TEXT NOT NULL,
    SourceModifiedTicks INTEGER NOT NULL,
    ParentKey TEXT,
    SeenJobId INTEGER,
    LastJobId INTEGER NOT NULL REFERENCES ComicJobs(Id),
    PRIMARY KEY(LibraryId,PathKey)
);
CREATE TABLE ComicDirtyFolders (
    LibraryId INTEGER NOT NULL REFERENCES Libraries(Id),
    RelativePath TEXT NOT NULL,
    PathKey TEXT NOT NULL,
    Recursive INTEGER NOT NULL DEFAULT 0,
    DetectedAt TEXT NOT NULL,
    PRIMARY KEY(LibraryId,PathKey)
);
ALTER TABLE PanelSources ADD COLUMN LastPeriodicScanAt TEXT;

CREATE INDEX IX_ComicFolders_Parent ON ComicFolders(LibraryId,ParentKey);
CREATE INDEX IX_ComicFolders_Job ON ComicFolders(LastJobId,LibraryId);
