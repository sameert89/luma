CREATE TABLE Libraries (
    Id INTEGER PRIMARY KEY, Name TEXT NOT NULL, Path TEXT NOT NULL UNIQUE,
    CaseSensitive INTEGER NOT NULL, Enabled INTEGER NOT NULL DEFAULT 1,
    Availability TEXT NOT NULL DEFAULT 'unknown'
);
CREATE TABLE Scans (
    Id INTEGER PRIMARY KEY, LibraryId INTEGER NOT NULL REFERENCES Libraries(Id),
    State TEXT NOT NULL, Force INTEGER NOT NULL DEFAULT 0, RetryFailures INTEGER NOT NULL DEFAULT 0,
    Discovered INTEGER NOT NULL DEFAULT 0, Skipped INTEGER NOT NULL DEFAULT 0,
    StartedAt TEXT NOT NULL, FinishedAt TEXT, FailureCode TEXT
);
CREATE UNIQUE INDEX IX_Scans_Active ON Scans(LibraryId) WHERE State IN ('queued','running');
CREATE TABLE Folders (
    Id INTEGER PRIMARY KEY, LibraryId INTEGER NOT NULL REFERENCES Libraries(Id),
    ParentId INTEGER REFERENCES Folders(Id), RelativePath TEXT NOT NULL, PathKey TEXT NOT NULL,
    LastSeenScanId INTEGER REFERENCES Scans(Id), UNIQUE(LibraryId, PathKey)
);
CREATE INDEX IX_Folders_Parent ON Folders(ParentId, Id);
CREATE TABLE FolderAncestry (
    AncestorId INTEGER NOT NULL REFERENCES Folders(Id), DescendantId INTEGER NOT NULL REFERENCES Folders(Id),
    PRIMARY KEY(AncestorId, DescendantId)
);
CREATE INDEX IX_FolderAncestry_Descendant ON FolderAncestry(DescendantId, AncestorId);
CREATE TABLE Media (
    Id INTEGER PRIMARY KEY, LibraryId INTEGER NOT NULL REFERENCES Libraries(Id),
    FolderId INTEGER NOT NULL REFERENCES Folders(Id), RelativePath TEXT NOT NULL, PathKey TEXT NOT NULL,
    FileName TEXT NOT NULL, MediaType TEXT NOT NULL, MimeType TEXT NOT NULL, Extension TEXT NOT NULL,
    SizeBytes INTEGER NOT NULL, ModifiedAt TEXT NOT NULL, IndexedAt TEXT NOT NULL,
    SourceRevision INTEGER NOT NULL DEFAULT 1, LastSeenScanId INTEGER NOT NULL REFERENCES Scans(Id),
    Availability TEXT NOT NULL DEFAULT 'present', ProcessingStatus TEXT NOT NULL DEFAULT 'pending',
    Width INTEGER, Height INTEGER, DurationMs INTEGER, CapturedAt TEXT, EffectiveDate TEXT NOT NULL,
    Preference TEXT NOT NULL DEFAULT 'neutral', UNIQUE(LibraryId, PathKey)
);
CREATE INDEX IX_Media_Reconcile ON Media(LibraryId, LastSeenScanId);
CREATE INDEX IX_Media_Folder ON Media(FolderId, Id);
CREATE TABLE ProcessingJobs (
    MediaId INTEGER NOT NULL REFERENCES Media(Id), SourceRevision INTEGER NOT NULL, EncoderVersion INTEGER NOT NULL,
    ScanId INTEGER NOT NULL REFERENCES Scans(Id), MediaType TEXT NOT NULL, State TEXT NOT NULL DEFAULT 'pending',
    Attempts INTEGER NOT NULL DEFAULT 0, NextAttemptAt TEXT NOT NULL, LeaseUntil TEXT, Claim TEXT,
    FailureCode TEXT, PRIMARY KEY(MediaId, SourceRevision, EncoderVersion)
);
CREATE INDEX IX_Jobs_Ready ON ProcessingJobs(State, MediaType, NextAttemptAt, MediaId);
CREATE INDEX IX_Jobs_Lease ON ProcessingJobs(State, MediaType, LeaseUntil);
CREATE INDEX IX_Jobs_Scan ON ProcessingJobs(ScanId, State, MediaId);
CREATE TABLE ProcessingFailures (
    Id INTEGER PRIMARY KEY, ScanId INTEGER NOT NULL REFERENCES Scans(Id), MediaId INTEGER REFERENCES Media(Id),
    Code TEXT NOT NULL, OccurredAt TEXT NOT NULL
);
CREATE INDEX IX_Failures_Scan ON ProcessingFailures(ScanId, Id);
CREATE TABLE CacheEntries (
    MediaId INTEGER NOT NULL REFERENCES Media(Id), SourceRevision INTEGER NOT NULL, Variant TEXT NOT NULL,
    EncoderVersion INTEGER NOT NULL, State TEXT NOT NULL, RelativePath TEXT NOT NULL UNIQUE,
    SizeBytes INTEGER NOT NULL, Width INTEGER NOT NULL, Height INTEGER NOT NULL, ContentHash TEXT NOT NULL,
    LastAccessAt TEXT NOT NULL, PRIMARY KEY(MediaId, SourceRevision, Variant, EncoderVersion)
);
CREATE INDEX IX_Cache_Lru ON CacheEntries(State, Variant, LastAccessAt);
CREATE INDEX IX_Scans_Library ON Scans(LibraryId, Id);
CREATE TABLE CacheAccounting (Id INTEGER PRIMARY KEY CHECK(Id=1), SizeBytes INTEGER NOT NULL DEFAULT 0);
INSERT INTO CacheAccounting(Id) VALUES(1);
CREATE TRIGGER CacheEntries_Insert AFTER INSERT ON CacheEntries BEGIN
    UPDATE CacheAccounting SET SizeBytes=SizeBytes+NEW.SizeBytes WHERE Id=1;
END;
CREATE TRIGGER CacheEntries_Update AFTER UPDATE OF SizeBytes ON CacheEntries BEGIN
    UPDATE CacheAccounting SET SizeBytes=SizeBytes+NEW.SizeBytes-OLD.SizeBytes WHERE Id=1;
END;
CREATE TRIGGER CacheEntries_Delete AFTER DELETE ON CacheEntries BEGIN
    UPDATE CacheAccounting SET SizeBytes=SizeBytes-OLD.SizeBytes WHERE Id=1;
END;
