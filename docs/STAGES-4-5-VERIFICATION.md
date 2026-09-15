# Stages 4–5 verification

Implemented 2026-09-16. Stages 4 and 5 add SQLite-only library/folder browsing, signed cursor pagination, generated-cache HTTP serving, a responsive virtualized gallery and viewer, the initial search/filter contract, tag editing and bulk operations, and persisted preferences.

## Functional evidence

Backend integration tests cover tied-key forward/backward pagination, cursor tampering and filter mismatch, every initial filter class, Unicode and literal wildcard text, recursive folders, query-consistent neighbors, cached serving while originals are absent, ETag responses, regeneration demand, tag normalization, atomic/idempotent bulk edits, and documented limits.

Playwright uses a deterministic 1,500-item generated-cache fixture against a Release server and production frontend preview. The six desktop/mobile checks cover cached previews, neighbor navigation, search, selection and bulk tags, keyboard dialogs, focus and scroll restoration, responsive overflow, and virtualization. The long-scroll check asserts no more than 80 mounted cells and 300 retained media summaries after page eviction.

Normal browse and search SQL only references SQLite. Cache responses open generated cache paths; full integrity verification and repair remain bounded background work. Backend tests remove the source fixture before browsing cached media to protect this invariant.

## Local synthetic query evidence

Commands:

```text
dotnet run --project tests/Luma.Tools -c Release -- perf .local/perf-stage45-120k 120000
dotnet run --project tests/Luma.Tools -c Release -- perf .local/perf-stage45-1m 1000000
```

The tool performs 20 warmups and 200 sequential samples per query with a 60-item page. Results below are milliseconds on `Microsoft Windows 10.0.26200`; they measure in-process server query code with warm SQLite pages and do not include HTTP, LAN, browser, original-media processing, or concurrent indexing.

| Rows | Query | p50 | p95 | p99 |
| ---: | --- | ---: | ---: | ---: |
| 120,000 | gallery | 0.83 | 1.14 | 1.50 |
| 120,000 | date | 28.76 | 36.67 | 44.83 |
| 120,000 | one tag | 30.14 | 35.21 | 39.36 |
| 120,000 | keyword | 1.18 | 1.79 | 2.04 |
| 120,000 | combined | 16.80 | 19.90 | 21.18 |
| 1,000,000 | gallery | 0.92 | 1.75 | 2.97 |
| 1,000,000 | date | 274.58 | 305.27 | 324.37 |
| 1,000,000 | one tag | 294.49 | 347.56 | 399.64 |
| 1,000,000 | keyword | 11.78 | 14.61 | 15.69 |
| 1,000,000 | combined | 158.03 | 180.55 | 208.29 |

At 120,000 rows, traversing 100,000 results through real signed cursors took 1.61 seconds; at one million rows it took 2.69 seconds. A 500-media/two-tag atomic edit took 21.59 ms and 24.54 ms respectively. Peak process working set was 82 MiB and 86 MiB. Gallery, folder, type, preference, date, FTS, and tag plans use their intended indexes; date/tag combinations also need bounded temporary ordering. Raw results and query plans are in [120k results](performance/stages-4-5-local-120k.json) and [one-million results](performance/stages-4-5-local-1m.json).

The one-million local run meets the p95/p99 synthetic targets, while the p50 target is missed by date, one-tag, and combined searches. These results are diagnostic only. The representative 120,000-file library and Raspberry Pi 5 are not accessible from the development environment, so Pi/LAN latency, concurrent indexing, real decoder throughput, idle resources, and the 30-minute client profiling procedure remain pending target-environment acceptance work.

## Verification commands

```text
dotnet build Luma.slnx -c Release
dotnet test Luma.slnx -c Release --no-build
cd src/Luma.Web
npm run generate:api
npm run lint
npm run build
npm test
npm run test:e2e
docker compose config --quiet
docker build -t luma:stages-4-5 .
docker run --rm -d --name luma-stage45-smoke -p 5280:5080 luma:stages-4-5
# Verified /api/status, the frontend root, and `ffmpeg -version`, then stopped the container.
```
