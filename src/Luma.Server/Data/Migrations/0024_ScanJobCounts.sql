-- Scan progress was counted by aggregating every job the scan owns, on every request:
--   SELECT State,COUNT(*) FROM ProcessingJobs WHERE ScanId=@id GROUP BY State
-- On a 200k-item library that reads 200k index entries, and two components poll it every three
-- seconds while a scan runs. Together with the refetches each poll triggered, that starved the
-- database on a self-hosted disk: folder listings that answer in about a second when the server is
-- quiet took 52 and 64 seconds during a scan.
--
-- Keep the counts instead, the way CacheAccounting keeps the cache size. A poll then reads a
-- handful of rows whatever the library's size.
CREATE TABLE ScanJobCounts (
    ScanId INTEGER NOT NULL REFERENCES Scans(Id), State TEXT NOT NULL,
    Count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(ScanId, State)
) WITHOUT ROWID;

INSERT INTO ScanJobCounts(ScanId,State,Count)
SELECT ScanId,State,COUNT(*) FROM ProcessingJobs GROUP BY ScanId,State;

-- A job moves between scans as well as between states: the discovery upsert re-points ScanId at
-- whichever scan last saw the file, so both columns have to be followed.
CREATE TRIGGER ProcessingJobs_CountInsert AFTER INSERT ON ProcessingJobs BEGIN
    INSERT INTO ScanJobCounts(ScanId,State,Count) VALUES(NEW.ScanId,NEW.State,1)
      ON CONFLICT(ScanId,State) DO UPDATE SET Count=Count+1;
END;
CREATE TRIGGER ProcessingJobs_CountUpdate AFTER UPDATE OF State,ScanId ON ProcessingJobs
WHEN OLD.State<>NEW.State OR OLD.ScanId<>NEW.ScanId BEGIN
    UPDATE ScanJobCounts SET Count=Count-1 WHERE ScanId=OLD.ScanId AND State=OLD.State;
    INSERT INTO ScanJobCounts(ScanId,State,Count) VALUES(NEW.ScanId,NEW.State,1)
      ON CONFLICT(ScanId,State) DO UPDATE SET Count=Count+1;
END;
CREATE TRIGGER ProcessingJobs_CountDelete AFTER DELETE ON ProcessingJobs BEGIN
    UPDATE ScanJobCounts SET Count=Count-1 WHERE ScanId=OLD.ScanId AND State=OLD.State;
END;
