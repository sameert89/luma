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

During concurrent browse/index: background work averages at most two CPU cores (200% Linux process CPU), server plus child-process RSS at most 1 GiB, and average disk throughput at most 40 MiB/s over 60 s. Default limits are in INDEXING.md; tune downward if latency exceeds target. No unbounded queues, tasks, SQL result materialization, or request-time media processing.

Client test on a 4 GiB Android device and desktop Chromium, 60 Hz: first visible gallery within 1.5 s warm LAN, frame time p95 ≤20 ms, fewer than 5% dropped frames, no routine input stalls >100 ms. After 30 minutes/10,000 traversed items, JS heap ≤150 MiB, tab memory ≤350 MiB, ≤300 media cells mounted, ≤600 retained summaries, and at most three active/nearby full-size media. Evict old pages while retaining ID/cursor/scroll anchors. Reels preload at most one preceding and one following item; only the active video plays.

## Reproducible measurement procedure

1. Record commit, OS/kernel, .NET/Node/browser versions, hardware, storage free space, power/thermal state and configuration. Use production frontend and Release server, disable developer tools except collection instrumentation. Preserve the source read-only mount.
2. Fixture generator (delivered with query implementation) uses a fixed seed and reports distributions: 5 roots, nested folders, 5% null captured dates, equal timestamps/names, 20% tagged, 1000 distinct tags with skew, 5% liked and 2% disliked, dimensions/types/extensions matching the real workload. Keep fixture manifest and generation command with results. Synthetic results are SQL-only evidence.
3. Warm up 200 requests. Run at least 1000 requests per query at concurrency 1 and 4, including first page and pages after 100k/900k rows via real cursors. Record p50/p95/p99, error rate and query plans. Run cold-cache trials separately (restart and document whether OS page cache was cleared); never merge warm/cold samples.
4. Repeat with a representative initial scan and incremental scan running at defaults. Sample process/child RSS, CPU, disk I/O and queue depth every second for 10 minutes. Report peaks and 60-second averages. Verify originals-unavailable browsing and instrument forbidden source/tool calls.
5. Scroll for 30 minutes through 10k items on desktop and mobile. Collect frame-time/drop metrics, heap snapshots at 0/15/30 minutes, DOM cell counts, retained query pages, network requests and active videos. Exercise viewer open/close and back navigation.
6. Publish raw samples, exact commands, fixture manifest, query plans, percentile calculation and pass/fail table under `docs/performance/`. Repeat three times, report worst run. Stage 2 only establishes infrastructure; these targets are validated in stages 4–7, not represented as already achieved.
