CREATE INDEX IX_FileOperations_RecycleCleanup ON FileOperations(Id) WHERE State='completed' AND Kind IN ('restore','purge');
