ALTER TABLE Scans ADD COLUMN QueueDismissed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE MetadataJobs ADD COLUMN QueueDismissed INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IX_Scans_TaskQueue ON Scans(Id DESC) WHERE QueueDismissed=0;
CREATE INDEX IX_MetadataJobs_TaskQueue ON MetadataJobs(Id DESC) WHERE QueueDismissed=0;
