-- Earlier file operations refreshed the source checkpoint but not the browse sort key.
-- Repair known dates without touching original media or enumerating directories.
UPDATE Folders SET ModifiedTicks=SourceModifiedTicks WHERE SourceModifiedTicks>ModifiedTicks;

-- Moving a directory preserves its filesystem timestamp. Its immutable snapshot
-- identifies the directory even if it has since moved again.
WITH activity AS MATERIALIZED (
  SELECT snapshot.FolderId,MAX(luma_ticks(operation.FinishedAt)) AS Ticks
  FROM FileOperations operation
  JOIN OperationFolders snapshot ON snapshot.OperationId=CASE WHEN operation.Kind='restore' THEN operation.RecycleId ELSE operation.Id END
    AND snapshot.OriginalPath=operation.Source
  WHERE operation.State='completed' AND operation.Kind IN ('move','restore')
    AND operation.IsDirectory=1 AND operation.FinishedAt IS NOT NULL
  GROUP BY snapshot.FolderId
)
UPDATE Folders SET ModifiedTicks=MAX(ModifiedTicks,(SELECT Ticks FROM activity WHERE FolderId=Folders.Id))
WHERE Id IN (SELECT FolderId FROM activity) AND ModifiedTicks<(SELECT Ticks FROM activity WHERE FolderId=Folders.Id);
