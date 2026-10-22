-- Captions are discovered/prepared only on explicit playback requests, never indexing/browse.
CREATE TABLE CaptionCache (
    MediaId INTEGER NOT NULL REFERENCES Media(Id) ON DELETE CASCADE,
    SourceKey TEXT NOT NULL, TrackId TEXT NOT NULL,
    RelativePath TEXT NOT NULL UNIQUE, RawRelativePath TEXT,
    SizeBytes INTEGER NOT NULL, LastAccessAt TEXT NOT NULL,
    PRIMARY KEY(MediaId,SourceKey,TrackId)
);
CREATE INDEX IX_CaptionCache_Access ON CaptionCache(LastAccessAt);
