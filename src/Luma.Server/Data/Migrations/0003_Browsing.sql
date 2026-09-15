ALTER TABLE Media ADD COLUMN NameKey TEXT NOT NULL DEFAULT '';
ALTER TABLE Media ADD COLUMN SearchPath TEXT NOT NULL DEFAULT '';
ALTER TABLE Media ADD COLUMN ReversedName TEXT NOT NULL DEFAULT '';
ALTER TABLE Media ADD COLUMN ModifiedTicks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE Media ADD COLUMN EffectiveTicks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE Media ADD COLUMN AspectRatio REAL GENERATED ALWAYS AS (1.0*Width/NULLIF(Height,0)) VIRTUAL;
ALTER TABLE Media ADD COLUMN Orientation TEXT GENERATED ALWAYS AS
  (CASE WHEN Width IS NULL OR Height IS NULL THEN NULL WHEN Width>Height THEN 'landscape' WHEN Width<Height THEN 'portrait' ELSE 'square' END) VIRTUAL;
UPDATE Media SET NameKey=luma_key(FileName),SearchPath=luma_key(RelativePath),ReversedName=luma_reverse(luma_key(FileName)),
  ModifiedTicks=luma_ticks(ModifiedAt),EffectiveTicks=luma_ticks(EffectiveDate);
CREATE INDEX IX_Media_Modified ON Media(Availability,ModifiedTicks,Id);
CREATE INDEX IX_Media_LibraryModified ON Media(LibraryId,Availability,ModifiedTicks,Id);
CREATE INDEX IX_Media_FolderModified ON Media(FolderId,Availability,ModifiedTicks,Id);
CREATE INDEX IX_Media_TypeModified ON Media(MediaType,Availability,ModifiedTicks,Id);
CREATE INDEX IX_Media_PreferenceModified ON Media(Preference,Availability,ModifiedTicks,Id);
CREATE INDEX IX_Media_Date ON Media(EffectiveTicks,Id);
CREATE INDEX IX_Media_Name ON Media(NameKey,Id);
CREATE INDEX IX_Media_Suffix ON Media(ReversedName,Id);
CREATE INDEX IX_Media_Size ON Media(SizeBytes,Id);
CREATE INDEX IX_Media_Dimensions ON Media(Width,Height,Id);
CREATE INDEX IX_Media_Aspect ON Media(AspectRatio,Id);
CREATE INDEX IX_Media_Extension ON Media(Extension,Id);
CREATE VIRTUAL TABLE MediaSearch USING fts5(NameKey,SearchPath,content='Media',content_rowid='Id',tokenize='trigram case_sensitive 1');
INSERT INTO MediaSearch(MediaSearch) VALUES('rebuild');
CREATE TRIGGER Media_SearchInsert AFTER INSERT ON Media BEGIN
  UPDATE Media SET NameKey=luma_key(NEW.FileName),SearchPath=luma_key(NEW.RelativePath),ReversedName=luma_reverse(luma_key(NEW.FileName)),
    ModifiedTicks=luma_ticks(NEW.ModifiedAt),EffectiveTicks=luma_ticks(NEW.EffectiveDate) WHERE Id=NEW.Id;
  INSERT INTO MediaSearch(rowid,NameKey,SearchPath) SELECT Id,NameKey,SearchPath FROM Media WHERE Id=NEW.Id;
END;
CREATE TRIGGER Media_SearchUpdate AFTER UPDATE OF FileName,RelativePath ON Media
WHEN NEW.FileName<>OLD.FileName OR NEW.RelativePath<>OLD.RelativePath BEGIN
  INSERT INTO MediaSearch(MediaSearch,rowid,NameKey,SearchPath) VALUES('delete',OLD.Id,OLD.NameKey,OLD.SearchPath);
  UPDATE Media SET NameKey=luma_key(NEW.FileName),SearchPath=luma_key(NEW.RelativePath),ReversedName=luma_reverse(luma_key(NEW.FileName)) WHERE Id=NEW.Id;
  INSERT INTO MediaSearch(rowid,NameKey,SearchPath) SELECT Id,NameKey,SearchPath FROM Media WHERE Id=NEW.Id;
END;
CREATE TRIGGER Media_DateUpdate AFTER UPDATE OF ModifiedAt,EffectiveDate ON Media BEGIN
  UPDATE Media SET ModifiedTicks=luma_ticks(NEW.ModifiedAt),EffectiveTicks=luma_ticks(NEW.EffectiveDate) WHERE Id=NEW.Id;
END;
CREATE TRIGGER Media_SearchDelete AFTER DELETE ON Media BEGIN
  INSERT INTO MediaSearch(MediaSearch,rowid,NameKey,SearchPath) VALUES('delete',OLD.Id,OLD.NameKey,OLD.SearchPath);
END;
INSERT INTO ApplicationState(Key,Value) VALUES('cursorKey',lower(hex(randomblob(32))));
