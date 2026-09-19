-- Automatic discovery is configured per library. Watchers only identify affected paths;
-- the existing bounded scan/processing pipeline remains responsible for all source work.
ALTER TABLE Libraries ADD COLUMN RefreshMode TEXT NOT NULL DEFAULT 'watcher';
ALTER TABLE Libraries ADD COLUMN RefreshOnOpen INTEGER NOT NULL DEFAULT 1;
ALTER TABLE Libraries ADD COLUMN PeriodicIntervalMinutes INTEGER NOT NULL DEFAULT 60;
ALTER TABLE Libraries ADD COLUMN WatcherDebounceSeconds INTEGER NOT NULL DEFAULT 5;
ALTER TABLE Libraries ADD COLUMN FileStabilitySeconds INTEGER NOT NULL DEFAULT 10;
ALTER TABLE Libraries ADD COLUMN LastPeriodicScanAt TEXT;

-- The root folder did not previously retain its own directory timestamp. This column is
-- also used for every folder's cheap refresh-on-open comparison.
ALTER TABLE Folders ADD COLUMN SourceModifiedTicks INTEGER NOT NULL DEFAULT 0;

-- Watcher events are hints. Persisting the coalesced affected folder means a restart cannot
-- lose an already-debounced change, while the primary key collapses event storms.
CREATE TABLE DirtyFolders (
    LibraryId INTEGER NOT NULL REFERENCES Libraries(Id),
    RelativePath TEXT NOT NULL,
    PathKey TEXT NOT NULL,
    Recursive INTEGER NOT NULL DEFAULT 0,
    Priority INTEGER NOT NULL DEFAULT 1,
    DetectedAt TEXT NOT NULL,
    PRIMARY KEY(LibraryId, PathKey)
) WITHOUT ROWID;
CREATE INDEX IX_DirtyFolders_Priority ON DirtyFolders(Priority DESC, DetectedAt, LibraryId);

-- Open-folder refreshes outrank watcher work, which outranks optional periodic scans.
ALTER TABLE Scans ADD COLUMN Priority INTEGER NOT NULL DEFAULT 0;
