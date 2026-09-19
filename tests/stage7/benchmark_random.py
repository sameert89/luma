"""SQL-only cached-random candidate evidence on an owned synthetic .local fixture.

Cache metadata is synthetic: no cache files or originals are created/read.
"""
import hashlib
import json
import pathlib
import random
import sqlite3
import statistics
import sys
import time

root = pathlib.Path(__file__).resolve().parents[2]
fixture = (root / sys.argv[1]).resolve()
assert fixture.is_relative_to(root / '.local'), 'Use an owned .local synthetic fixture'
db = sqlite3.connect(fixture / 'fixture.db')
db.execute("INSERT INTO Tags(Name,NormalizedKey) VALUES('Staging random','STAGING RANDOM') ON CONFLICT DO NOTHING")
db.execute("INSERT INTO MediaTags SELECT m.Id,t.Id FROM Media m JOIN Tags t ON t.NormalizedKey='STAGING RANDOM' WHERE m.MediaType='image' AND m.Id%41=0 ON CONFLICT DO NOTHING")
db.execute("""INSERT INTO CacheEntries(MediaId,SourceRevision,Variant,EncoderVersion,State,RelativePath,SizeBytes,Width,Height,ContentHash,LastAccessAt)
SELECT Id,SourceRevision,'preview',1,'ready','gate7-synthetic/'||Id||'/preview.jpg',1,Width,Height,'synthetic','2026-09-17T00:00:00Z'
FROM Media WHERE MediaType='image' AND Id<=10000 ON CONFLICT DO NOTHING""")
db.commit()
reports = []
for selective in (False, True):
    predicate = "m.Availability='present' AND m.MediaType='image'"
    if selective:
        predicate += " AND m.Width>=600 AND m.Orientation='landscape' AND m.Id IN (SELECT mt.MediaId FROM MediaTags mt JOIN Tags t ON t.Id=mt.TagId WHERE t.NormalizedKey='STAGING RANDOM')"
    ready = " AND EXISTS(SELECT 1 FROM CacheEntries c WHERE c.MediaId=m.Id AND c.SourceRevision=m.SourceRevision AND c.EncoderVersion=1 AND c.Variant='preview' AND c.State='ready')"
    forward = f'SELECT m.Id,m.SourceRevision FROM Media m WHERE {predicate}{ready} AND m.RandomKey>=? ORDER BY m.RandomKey,m.Id LIMIT 1'
    wrap = f'SELECT m.Id,m.SourceRevision FROM Media m WHERE {predicate}{ready} AND m.RandomKey<? ORDER BY m.RandomKey,m.Id LIMIT 1'
    pivot = int.from_bytes(hashlib.sha256(b'gate7-random').digest()[:8], 'little') & (2**63-1)
    plans = {name: [row[3] for row in db.execute('EXPLAIN QUERY PLAN ' + sql, (pivot,))] for name, sql in [('forward', forward), ('wrap', wrap)]}
    rng = random.Random(7)
    samples = []
    wrapped = 0
    for index in range(1200):
        current_pivot = rng.randrange(2**63)
        started = time.perf_counter()
        row = db.execute(forward, (current_pivot,)).fetchone()
        if row is None:
            wrapped += 1
            row = db.execute(wrap, (current_pivot,)).fetchone()
        assert row is not None, 'Both filter cases must exercise a nonempty cached-image selection'
        if index >= 200:
            samples.append((time.perf_counter()-started)*1000)
    samples.sort()
    reports.append({'selective': selective, 'p50': statistics.median(samples), 'p95': samples[949], 'p99': samples[989], 'samples': 1000, 'warmup': 200, 'wrapped': wrapped, 'latenciesMs': samples, 'plans': plans, 'forwardSql': forward, 'wrapSql': wrap})
report = {'synthetic': True, 'sqlOnly': True, 'physicalCacheFiles': False, 'sqliteVersion': sqlite3.sqlite_version,
          'schemaVersion': db.execute('SELECT MAX(Version) FROM SchemaMigrations').fetchone()[0],
          'rows': db.execute('SELECT COUNT(*) FROM Media').fetchone()[0],
          'syntheticReadyPreviews': db.execute("SELECT COUNT(*) FROM CacheEntries WHERE Variant='preview' AND State='ready'").fetchone()[0],
          'reports': reports}
(fixture / 'gate7-random-results.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps({'rows': report['rows'], 'artifact': str(fixture / 'gate7-random-results.json'),
                  'reports': [{key: item[key] for key in ('selective', 'p50', 'p95', 'p99', 'wrapped')} for item in reports]}, indent=2))
