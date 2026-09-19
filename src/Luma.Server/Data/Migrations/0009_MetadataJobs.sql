CREATE TABLE MetadataJobs (
    Id INTEGER PRIMARY KEY, Kind TEXT NOT NULL, State TEXT NOT NULL,
    Request TEXT NOT NULL, CreatedAt TEXT NOT NULL, SnapshotAt TEXT,
    FinishedAt TEXT, Processed INTEGER NOT NULL DEFAULT 0,
    Failed INTEGER NOT NULL DEFAULT 0, FailureCode TEXT,
    ContentBytes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IX_MetadataJobs_Queue ON MetadataJobs(State,Id);
CREATE TABLE MetadataJobItems (
    JobId INTEGER NOT NULL REFERENCES MetadataJobs(Id) ON DELETE CASCADE,
    MediaId INTEGER NOT NULL, Code TEXT NOT NULL,
    PRIMARY KEY(JobId,MediaId)
);
