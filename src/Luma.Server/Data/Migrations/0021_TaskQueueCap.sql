-- Finished background jobs used to stay in the queue until someone cleared them, so a library
-- that rescans often accumulated hundreds. Each new job now dismisses every finished job beyond
-- the ten most recent of its kind; active jobs and their history in Scans/MetadataJobs are untouched.
CREATE TRIGGER Scans_QueueCap AFTER INSERT ON Scans BEGIN
  UPDATE Scans SET QueueDismissed=1
  WHERE QueueDismissed=0
    AND (State IN ('cancelled','failed','interrupted') OR State='completed' AND NOT EXISTS(SELECT 1 FROM ProcessingJobs WHERE ScanId=Scans.Id AND State IN ('pending','running')))
    AND Id < (SELECT MIN(Id) FROM (SELECT Id FROM Scans WHERE QueueDismissed=0
      AND (State IN ('cancelled','failed','interrupted') OR State='completed' AND NOT EXISTS(SELECT 1 FROM ProcessingJobs WHERE ScanId=Scans.Id AND State IN ('pending','running')))
      ORDER BY Id DESC LIMIT 10));
END;
CREATE TRIGGER MetadataJobs_QueueCap AFTER INSERT ON MetadataJobs BEGIN
  UPDATE MetadataJobs SET QueueDismissed=1
  WHERE QueueDismissed=0 AND State IN ('completed','cancelled','failed','expired')
    AND Id < (SELECT MIN(Id) FROM (SELECT Id FROM MetadataJobs WHERE QueueDismissed=0
      AND State IN ('completed','cancelled','failed','expired') ORDER BY Id DESC LIMIT 10));
END;
