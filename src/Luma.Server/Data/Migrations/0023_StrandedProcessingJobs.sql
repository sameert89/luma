-- Jobs discovered by a scan that was cut off by a restart were left pending while their scan was
-- marked 'interrupted'. The processing worker claims only jobs whose scan is running or completed,
-- so those jobs became unclaimable without ever being attempted, and stayed in the queue as
-- outstanding work for the life of the install -- one report had 7,663 of them, unchanged across
-- days, with the workers spinning over them.
--
-- Park them where the rest of the system expects deferred work to sit: showing an item adopts its
-- own job, and a scan that rediscovers the media adopts the rest. This covers every terminal scan
-- state, not just 'interrupted', so a job orphaned by a cancelled or failed scan is healed too.
UPDATE ProcessingJobs SET State='waiting', Claim=NULL, LeaseUntil=NULL
WHERE State='pending' AND ScanId IN (SELECT Id FROM Scans WHERE State NOT IN ('running','completed'));
