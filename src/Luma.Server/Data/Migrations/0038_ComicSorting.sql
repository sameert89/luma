ALTER TABLE Comics ADD COLUMN TitleSortKey TEXT NOT NULL DEFAULT '';
UPDATE Comics SET TitleSortKey=luma_natural_key(Title);
CREATE TRIGGER Comics_TitleSort_Insert AFTER INSERT ON Comics BEGIN
    UPDATE Comics SET TitleSortKey=luma_natural_key(NEW.Title) WHERE Id=NEW.Id;
END;
CREATE TRIGGER Comics_TitleSort_Update AFTER UPDATE OF Title ON Comics BEGIN
    UPDATE Comics SET TitleSortKey=luma_natural_key(NEW.Title) WHERE Id=NEW.Id;
END;
CREATE INDEX IX_Comics_TitleSort ON Comics(Availability,TitleSortKey,Id);
CREATE INDEX IX_Comics_AddedSort ON Comics(Availability,AddedAt,Id);
CREATE INDEX IX_Comics_ModifiedSort ON Comics(Availability,SourceModifiedTicks,Id);
CREATE INDEX IX_Comics_LibraryTitleSort ON Comics(LibraryId,Availability,TitleSortKey,Id);
CREATE INDEX IX_Comics_LibraryAddedSort ON Comics(LibraryId,Availability,AddedAt,Id);
CREATE INDEX IX_Comics_LibraryModifiedSort ON Comics(LibraryId,Availability,SourceModifiedTicks,Id);
CREATE INDEX IX_Comics_PathBrowse ON Comics(LibraryId,Availability,PathKey);
