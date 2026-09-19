CREATE INDEX IX_Folders_Parent_Name ON Folders(ParentId,Hidden,RelativePath COLLATE NOCASE,Id);
