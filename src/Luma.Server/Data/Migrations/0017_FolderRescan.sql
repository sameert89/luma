-- A folder rescan covers the folder and everything beneath it. Folder-demand indexing
-- (opening a folder that was never indexed) still reads only the folder's own entries.
ALTER TABLE Scans ADD COLUMN Recursive INTEGER NOT NULL DEFAULT 0;
