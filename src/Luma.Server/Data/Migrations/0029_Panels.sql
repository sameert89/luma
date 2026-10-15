CREATE TABLE Comics (
    Id INTEGER PRIMARY KEY,
    LibraryId INTEGER NOT NULL REFERENCES Libraries(Id),
    RelativePath TEXT NOT NULL,
    PathKey TEXT NOT NULL,
    Format TEXT NOT NULL,
    Title TEXT NOT NULL,
    Series TEXT NOT NULL DEFAULT '',
    Author TEXT NOT NULL DEFAULT '',
    Description TEXT NOT NULL DEFAULT '',
    PageCount INTEGER NOT NULL,
    CoverPage INTEGER NOT NULL DEFAULT 0,
    SourceSize INTEGER NOT NULL,
    SourceModifiedTicks INTEGER NOT NULL,
    Revision INTEGER NOT NULL DEFAULT 1,
    Availability TEXT NOT NULL DEFAULT 'present',
    AddedAt TEXT NOT NULL,
    LastJobId INTEGER,
    Favourite INTEGER NOT NULL DEFAULT 0,
    UNIQUE(LibraryId,PathKey)
);
CREATE INDEX IX_Comics_Browse ON Comics(Availability,Id);
CREATE INDEX IX_Comics_Series ON Comics(Series,Id);
CREATE TABLE ComicPages (
    ComicId INTEGER NOT NULL REFERENCES Comics(Id),
    PageIndex INTEGER NOT NULL,
    EntryName TEXT NOT NULL,
    SizeBytes INTEGER NOT NULL,
    PRIMARY KEY(ComicId,PageIndex)
);
CREATE TABLE ComicJobs (
    Id INTEGER PRIMARY KEY,
    LibraryId INTEGER NOT NULL REFERENCES Libraries(Id),
    Source TEXT,
    State TEXT NOT NULL DEFAULT 'queued',
    Processed INTEGER NOT NULL DEFAULT 0,
    Failed INTEGER NOT NULL DEFAULT 0,
    FailureCode TEXT,
    CreatedAt TEXT NOT NULL,
    QueueDismissed INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IX_ComicJobs_Active ON ComicJobs(LibraryId) WHERE State IN ('queued','running');
CREATE TABLE ReadingProgress (
    ComicId INTEGER PRIMARY KEY REFERENCES Comics(Id),
    PageIndex INTEGER NOT NULL DEFAULT 0,
    State TEXT NOT NULL DEFAULT 'unread',
    ReadingSeconds REAL NOT NULL DEFAULT 0,
    Direction TEXT NOT NULL DEFAULT 'ltr',
    LastReadAt TEXT,
    Settings TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IX_ReadingProgress_State ON ReadingProgress(State,LastReadAt,ComicId);
CREATE TABLE ReadingSessions (
    Id TEXT PRIMARY KEY,
    ComicId INTEGER NOT NULL REFERENCES Comics(Id),
    Sequence INTEGER NOT NULL,
    UpdatedAt TEXT NOT NULL
);
CREATE TABLE ComicCache (
    ComicId INTEGER NOT NULL REFERENCES Comics(Id),
    Revision INTEGER NOT NULL,
    Variant TEXT NOT NULL,
    RelativePath TEXT NOT NULL UNIQUE,
    SizeBytes INTEGER NOT NULL,
    LastAccessAt TEXT NOT NULL,
    PRIMARY KEY(ComicId,Revision,Variant)
);
CREATE INDEX IX_ComicCache_Lru ON ComicCache(LastAccessAt);
CREATE TABLE OperationComics (
    OperationId TEXT NOT NULL REFERENCES FileOperations(Id),
    ComicId INTEGER NOT NULL REFERENCES Comics(Id),
    OriginalPath TEXT NOT NULL,
    OriginalAvailability TEXT NOT NULL,
    PRIMARY KEY(OperationId,ComicId)
);
