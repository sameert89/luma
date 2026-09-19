"""Measure indexing query plans against synthetic 120k/1m SQLite rows; no media IO."""
import json
import pathlib
import sqlite3
import statistics
import sys
import time

root = pathlib.Path(__file__).resolve().parents[2]
claim = """SELECT j.rowid FROM ProcessingJobs j INDEXED BY IX_Jobs_Ready
WHERE j.State='pending' AND j.NextAttemptAt<=? AND j.MediaType=? AND j.EncoderVersion=1
AND EXISTS(SELECT 1 FROM Media m JOIN Libraries l ON l.Id=m.LibraryId JOIN Scans s ON s.Id=j.ScanId
WHERE m.Id=j.MediaId AND m.SourceRevision=j.SourceRevision AND m.Availability='present'
AND l.Enabled=1 AND s.State IN ('running','completed'))
ORDER BY j.NextAttemptAt,j.MediaId LIMIT 1"""
for size in (120_000, 1_000_000):
    db = sqlite3.connect(':memory:')
    db.executescript((root / 'src/Luma.Server/Data/Migrations/0002_Indexing.sql').read_text())
    db.execute("INSERT INTO Libraries(Id,Name,Path,CaseSensitive) VALUES(1,'Fixture','/media',1)")
    db.execute("INSERT INTO Scans(Id,LibraryId,State,StartedAt) VALUES(1,1,'completed','2026')")
    db.execute("INSERT INTO Folders(Id,LibraryId,RelativePath,PathKey) VALUES(1,1,'','')")
    for start in range(1, size+1, 200):
        db.executemany('''INSERT INTO Media(Id,LibraryId,FolderId,RelativePath,PathKey,FileName,MediaType,MimeType,Extension,
        SizeBytes,ModifiedAt,IndexedAt,EffectiveDate,LastSeenScanId) VALUES(?,1,1,?,?,'fixture.jpg','image','image/jpeg','.jpg',10,'2026','2026','2026',1)''',
                       ((i, str(i), str(i)) for i in range(start, min(start+200, size+1))))
        db.executemany("INSERT INTO ProcessingJobs(MediaId,SourceRevision,EncoderVersion,ScanId,MediaType,NextAttemptAt) VALUES(?,1,1,1,'image','2026')",
                       ((i,) for i in range(start, min(start+200, size+1))))
    db.commit()
    db.execute('ANALYZE')
    output = {'rows': size, 'sqliteVersion': sqlite3.sqlite_version, 'queries': {}}
    for name, sql, parameters in [
        ('imageClaim', claim, ('2027','image')),
        ('emptyVideoClaim', claim, ('2027','video')),
        ('reconciliation', 'SELECT Id FROM Media WHERE LibraryId=? AND LastSeenScanId<>? LIMIT 200', (1,0)),
        ('failurePage', 'SELECT Id FROM ProcessingFailures WHERE ScanId=? AND Id>? ORDER BY Id LIMIT 101', (1,0)),
        ('pathIdentity', 'SELECT Id FROM Media WHERE LibraryId=? AND PathKey=?', (1,str(size))),
    ]:
        plan = [row[3] for row in db.execute('EXPLAIN QUERY PLAN ' + sql, parameters)]
        for _ in range(5):
            list(db.execute(sql, parameters))
        samples = []
        for _ in range(50):
            before = time.perf_counter()
            list(db.execute(sql, parameters))
            samples.append((time.perf_counter()-before)*1000)
        output['queries'][name] = {'plan': plan, 'medianMs': round(statistics.median(samples),3), 'maxMs': round(max(samples),3)}
    print(json.dumps(output, indent=2), flush=True)
    db.close()
