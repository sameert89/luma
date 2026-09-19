-- Indexing now prepares thumbnails only; an image's large preview is prepared when someone opens it.
ALTER TABLE ProcessingJobs ADD COLUMN WantPreview INTEGER NOT NULL DEFAULT 0;

-- Earlier releases generated a preview for every image during indexing, several times the size of
-- all thumbnails together. Release them; thumbnails, tags and album covers are kept, so no re-index
-- is needed. The startup cache sweep deletes the files; the accounting trigger frees quota now.
UPDATE CacheEntries SET State='evicted',SizeBytes=0 WHERE Variant='preview' AND State='ready';

-- Retry work that failed only because the old pipeline was congested (deadlines, busy tools, cache I/O).
UPDATE Media SET ProcessingStatus='pending' WHERE ProcessingStatus='failed' AND EXISTS (
  SELECT 1 FROM ProcessingJobs j WHERE j.MediaId=Media.Id AND j.SourceRevision=Media.SourceRevision
    AND j.State='failed' AND j.FailureCode IN ('processing_timeout','tool_unavailable','cache_io'));
UPDATE ProcessingJobs SET State='pending',Attempts=0,FailureCode=NULL,NextAttemptAt='2000-01-01T00:00:00.0000000+00:00'
  WHERE State='failed' AND FailureCode IN ('processing_timeout','tool_unavailable','cache_io');
