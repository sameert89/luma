-- Folders gain what sorting and search need without touching disk while browsing:
--   NameKey       search key of the folder's own name (prefix seeks and the trigram index)
--   SortKey       natural name order: case and accent insensitive, numbers by value
--   ModifiedTicks the directory's own modified time, recorded by scans (0 when unknown)
ALTER TABLE Folders ADD COLUMN NameKey TEXT NOT NULL DEFAULT '';
ALTER TABLE Folders ADD COLUMN SortKey TEXT NOT NULL DEFAULT '';
ALTER TABLE Folders ADD COLUMN ModifiedTicks INTEGER NOT NULL DEFAULT 0;
-- Until the next scan records the directory's time, the newest file directly inside stands in
-- (a directory's time changes when entries are added, so the two are usually close).
UPDATE Folders SET NameKey=luma_folder_key(RelativePath),SortKey=luma_sort_key(RelativePath),
  ModifiedTicks=COALESCE((SELECT MAX(m.ModifiedTicks) FROM Media m WHERE m.FolderId=Folders.Id AND m.Availability='present'),0);
DROP INDEX IX_Folders_Parent_Name;
CREATE INDEX IX_Folders_Parent_Sort ON Folders(ParentId,Hidden,SortKey,Id);
CREATE INDEX IX_Folders_Parent_Modified ON Folders(ParentId,Hidden,ModifiedTicks,Id);
CREATE INDEX IX_Folders_Name ON Folders(NameKey,Id);
CREATE VIRTUAL TABLE FolderSearch USING fts5(NameKey,content='Folders',content_rowid='Id',tokenize='trigram case_sensitive 1');
INSERT INTO FolderSearch(FolderSearch) VALUES('rebuild');
CREATE TRIGGER Folders_KeysInsert AFTER INSERT ON Folders BEGIN
  UPDATE Folders SET NameKey=luma_folder_key(NEW.RelativePath),SortKey=luma_sort_key(NEW.RelativePath) WHERE Id=NEW.Id;
  INSERT INTO FolderSearch(rowid,NameKey) VALUES(NEW.Id,luma_folder_key(NEW.RelativePath));
END;
CREATE TRIGGER Folders_KeysUpdate AFTER UPDATE OF RelativePath ON Folders
WHEN NEW.RelativePath<>OLD.RelativePath BEGIN
  INSERT INTO FolderSearch(FolderSearch,rowid,NameKey) VALUES('delete',OLD.Id,OLD.NameKey);
  UPDATE Folders SET NameKey=luma_folder_key(NEW.RelativePath),SortKey=luma_sort_key(NEW.RelativePath) WHERE Id=NEW.Id;
  INSERT INTO FolderSearch(rowid,NameKey) VALUES(NEW.Id,luma_folder_key(NEW.RelativePath));
END;
CREATE TRIGGER Folders_KeysDelete AFTER DELETE ON Folders BEGIN
  INSERT INTO FolderSearch(FolderSearch,rowid,NameKey) VALUES('delete',OLD.Id,OLD.NameKey);
END;
