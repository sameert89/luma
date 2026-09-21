## Target Hardware/Software
- Raspberry Pi 5 (4GB)
- Debian 13
- Storage is plugged in usb3 with a btrfs storage block running RAID 1, on 2 2TB hard drives
- gigabit ethernet

## Target gallery size
- currently 100k images, with 20k videos
- some videos are large, most are portrait reels style

## Budgets (acceptance targets, not measured results)

Measure release builds on the hardware above over wired LAN. Datasets: representative 120,000 items (100k images/20k videos), plus 1,000,000 synthetic database records. API page size 60; warm SQLite/cache. Common queries are unfiltered modified ordering, one root/folder, type, date range, one to three tags and selective keyword combinations.

| Metric | 120k target | 1m synthetic target |
| --- | --- | --- |
| Gallery/folder API p50 / p95 / p99 | 50 / 150 / 300 ms | 75 / 250 / 500 ms |
| Common search p50 / p95 / p99 | 100 / 250 / 500 ms | 150 / 400 / 800 ms |
| Same requests during indexing p95 | gallery 250 ms, search 400 ms | gallery 400 ms, search 600 ms |
| Tag bulk edit, 500 media / 10 tags, p95 | 500 ms | 800 ms |
| Warm generated thumbnail p95 (LAN) | 100 ms | 100 ms |
| Cold first gallery request p95 | 1 s | 1.5 s |
| Server resident memory, browse / indexing peak | 256 / 768 MiB | 320 / 896 MiB |
| Idle CPU / idle disk writes | <1% of one core / <1 MiB per minute | same |

During concurrent browse/index: background decoders run below normal OS priority and may use every otherwise idle core (up to 400% Linux process CPU on the 4-core target), provided browse latency stays within the concurrent-indexing targets above; server plus child-process RSS at most 1 GiB, and average disk throughput at most 40 MiB/s over 60 s. Default limits are in INDEXING.md; tune downward if latency exceeds target. No unbounded queues, tasks, SQL result materialization, or request-time media processing.

Client test on a 4 GiB Android device and desktop Chromium, 60 Hz: first visible gallery within 1.5 s warm LAN, frame time p95 ≤20 ms, fewer than 5% dropped frames, no routine input stalls >100 ms. After 30 minutes/10,000 traversed items, JS heap ≤150 MiB, tab memory ≤350 MiB, ≤300 media cells mounted, ≤600 retained summaries, and at most three active/nearby full-size media. Evict old pages while retaining ID/cursor/scroll anchors. Reels preload at most one preceding and one following item; only the active video plays.

## Reproducible measurement procedure

1. Record commit, OS/kernel, .NET/Node/browser versions, hardware, storage free space, power/thermal state and configuration. Use production frontend and Release server, disable developer tools except collection instrumentation. Preserve the source read-only mount.
2. Fixture generator (delivered with query implementation) uses a fixed seed and reports distributions: 5 roots, nested folders, 5% null captured dates, equal timestamps/names, 20% tagged, 1000 distinct tags with skew, 5% liked and 2% disliked, dimensions/types/extensions matching the real workload. Keep fixture manifest and generation command with results. Synthetic results are SQL-only evidence.
3. Warm up 200 requests. Run at least 1000 requests per query at concurrency 1 and 4, including first page and pages after 100k/900k rows via real cursors. Record p50/p95/p99, error rate and query plans. Run cold-cache trials separately (restart and document whether OS page cache was cleared); never merge warm/cold samples.
4. Repeat with a representative initial scan and incremental scan running at defaults. Sample process/child RSS, CPU, disk I/O and queue depth every second for 10 minutes. Report peaks and 60-second averages. Verify originals-unavailable browsing and instrument forbidden source/tool calls.
5. Scroll for 30 minutes through 10k items on desktop and mobile. Collect frame-time/drop metrics, heap snapshots at 0/15/30 minutes, DOM cell counts, retained query pages, network requests and active videos. Exercise viewer open/close and back navigation.
6. Publish raw samples, exact commands, fixture manifest, query plans, percentile calculation and pass/fail table under `docs/performance/`. Repeat three times, report worst run. Stage 2 only establishes infrastructure; these targets are validated in stages 4–7, not represented as already achieved.

## Folder cover candidates

A folder shows up to five covers drawn from everything beneath it, newest first.
Proving that a file can actually be shown means a lookup into `CacheEntries` for
its thumbnail, and that lookup costs one probe per candidate.

Applied to the whole subtree, that is a probe per file in the folder. Measured on
a 207k-item library, one page of 48 folders visited and sorted **121,207** media
rows, and probed the cache for each, to light up 240 thumbnails — around 85% of
what the page cost. The listing therefore narrows to the newest `CoverWindow`
files per folder by index order first, and only then resolves their thumbnails.

The window is wider than the five covers shown so that files whose thumbnail has
been evicted are passed over rather than leaving a folder short. Widening it
costs a probe per folder per extra slot; it should not be raised without a
measurement.

## Query statistics

SQLite chooses between a seek over a sort index and a scan of the library from
`sqlite_stat1`. Luma's indexes are designed around that choice, so the numbers
recorded there are part of the performance contract rather than an incidental
detail.

Migrations 0010, 0011 and 0022 run `ANALYZE Media`, but on a fresh install they
run before anything is indexed, and statistics describing an empty table would
otherwise stand for the life of the install. `ScanWorker` therefore re-analyses
Media after a scan completes, once the recorded row count and the real one differ
by an order of magnitude. `PRAGMA analysis_limit=400` samples each index rather
than reading it whole, keeping the refresh bounded on a library of any size.

This is insurance rather than a tuning knob. Measured on a 207k-item library, the
folder listing takes the same plan and the same time whether statistics say the
table is empty or describe it correctly — but with **no** statistics at all the
planner picks `IX_Media_AutomaticCover` and the same page takes 26x longer. That
is the failure mode migration 0010 was written against, and keeping the numbers
truthful is what stops a future index from triggering it.

To check an install, compare what the planner believes against what is there:

```sql
SELECT (SELECT COUNT(*) FROM Media) AS actual,
       (SELECT MAX(CAST(stat AS INTEGER)) FROM sqlite_stat1 WHERE tbl='Media') AS planned;
```

## Storage latency

Browse queries are page reads, so their cost is the number of pages they touch
multiplied by what a page read costs. On a database kept on an external or
spinning disk that is allowed to idle, the first read after a quiet period pays
the drive's spin-up before it does any work: measured at 5-6 seconds for a single
`COUNT(*)` on a USB 3 mount.

A query that reads far more pages than it needs is therefore cheap in testing,
where everything is in the OS page cache, and minutes in use. When a report says
the first request after opening the app is slow and every request after it is
immediate, measure the endpoints individually rather than the app as a whole: the
one that is 50x its neighbours is reading pages it does not need.
