-- Track the last import so rediscovery can refresh metadata without replacing local edits.
ALTER TABLE Comics ADD COLUMN ImportedMetadata TEXT;
