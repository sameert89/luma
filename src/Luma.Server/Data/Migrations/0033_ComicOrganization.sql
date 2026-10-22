ALTER TABLE PanelSources ADD COLUMN ExcludeFromGallery INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IX_PanelSources_Gallery ON PanelSources(LibraryId,PathKey) WHERE ExcludeFromGallery=1;
CREATE TABLE ComicTags (
    ComicId INTEGER NOT NULL REFERENCES Comics(Id),
    TagId INTEGER NOT NULL REFERENCES Tags(Id),
    PRIMARY KEY(ComicId,TagId)
);
CREATE INDEX IX_ComicTags_Tag ON ComicTags(TagId,ComicId);
DROP INDEX IX_ComicJobs_Active;
CREATE UNIQUE INDEX IX_ComicJobs_Active ON ComicJobs(LibraryId,COALESCE(Source,'')) WHERE State IN ('queued','running');
