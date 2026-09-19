# Stage 3 — Indexing and generated cache verification

Implemented 2026-09-15. Stage 3 supplies the background pipeline and its administrative HTTP API. Gallery, folder navigation, cache-serving endpoints and an indexing UI remain in stage 4.

## Implementation

- Migration 0002 owns libraries, folder ancestry, media identity, scans, durable processing jobs, failure history and cache accounting. Migration 0001 is unchanged.
- Source discovery uses depth-first enumeration and a bounded channel. Each file is committed in a short transaction. A failed, cancelled or interrupted traversal cannot mark unseen media missing. Missing reconciliation and successful traversal completion share a transaction.
- Changed size/mtime or a forced scan preserves the media ID and preference, increments the source revision, clears extracted metadata and schedules current representations. Renames get new IDs. Reappearance reuses the existing path identity.
- The server owns configurable discovery, image, video and aggregate worker limits. Workers claim durable jobs with two-minute leases; restart releases claims and resumes interrupted traversals. Each job launches media tools sequentially, with a 30-second image or 60-second video deadline and process-tree termination on cancellation.
- ImageSharp 3.1.12 runs in a child invocation of the same application. It checks dimensions before pixel decoding, reads the first GIF/TIFF frame, applies EXIF orientation, extracts capture dates, downsamples without upscaling and encodes WebP 75 / JPEG 85 or 80. JPEG alpha uses the shared canvas background. FFprobe reads video metadata; FFmpeg extracts one frame at min(10% duration, 3 seconds), with a first-frame fallback. Original video is never transcoded.
- Cache publication validates generated images, hashes them, atomically renames same-filesystem temporary files and commits only if the job still owns the current revision. Cache-only background verification detects loss/corruption and deduplicates regeneration. Maintenance removes obsolete files and old orphan/temporary files in batches. Byte-accounting triggers, reservations and free-space checks bound generation. LRU cleanup evicts previews first and does not periodically regenerate evicted files.
- `/api/indexing` reports configured libraries, latest scan IDs, cache bytes/pressure and resource limits. Scan endpoints expose traversal state, processing counts and failure history in pages of 100. No diagnostic response exposes source paths or tool output.

## Functional evidence

The automated backend suite covers:

- All six initial image format families and six video extensions, one corrupt JPEG, one unsupported HEIC, nested empty folders, unchanged source bytes and no upscaling.
- EXIF rotation and capture-time offset, alpha flattening, first GIF frame/TIFF page, and the 100-megapixel predecode guard.
- Addition, replacement, force, rename, disappearance, reappearance and preference retention.
- Cancellation after partial discovery, unavailable roots, interruption recovery, durable lease recovery and rejected stale publication.
- Source loss, explicit retry, three delayed transient retries, missing/corrupt cache recovery, preview-first eviction, orphan cleanup and pressure without a regeneration loop.
- Scan conflicts, cancellation, sanitized errors, libraries without scans and paginated failure history.
- Process cancellation within ten seconds. Symlink traversal/root rejection runs on Linux; the test is explicitly skipped on Windows because hosted Windows CI does not grant symlink privileges.

The disposable Linux verification container mounts both repository and fixture read-only. It verifies `EROFS` on a source write attempt, runs the backend suite, starts the real hosted workers, checks all 13 media rows (12 ready, one failed), 24 cache entries, restart convergence, complete cache loss/regeneration and unchanged original hashes. It samples the server and child processes every 50 ms. At defaults, observed maxima were two child processes and one FFmpeg/FFprobe process. The first run peaked at 238,584 KiB combined resident memory on this small fixture. These samples are not a large-library or Raspberry Pi performance result.

## Query checks

[Raw query plans and timings](performance/stage3-query-plans.txt) use SQLite 3.49.1, an in-memory database and 120,000 / 1,000,000 synthetic image records/jobs on the Windows development host. Five warmups precede 50 samples. They test path identity, reconciliation candidates, failure pagination, a ready image claim and an empty video claim against an image backlog.

The initial combined pending/expired claim let SQLite scan the media table and sort the candidate set. The final claim seeks `IX_Jobs_Ready(State, MediaType, NextAttemptAt, MediaId)` and checks eligibility by ID. Expired leases are recovered separately in batches of at most 200 through `IX_Jobs_Lease`. At one million rows, measured medians were 0.004 ms for an image candidate and 0.002 ms for an empty video queue. These measure candidate selection, not processing throughput or HTTP latency. Reconciliation necessarily examines the selected root; its index covers root and last-seen scan ID.

## Reproduce

From the repository root:

```sh
dotnet restore Luma.slnx --locked-mode
dotnet build Luma.slnx -c Release
dotnet test Luma.slnx -c Release --no-build
python tests/stage3/check_queries.py
cd src/Luma.Web
npm run generate:api
npm run lint
npm run build
npm test
npm run test:e2e
```

The backend tests require FFmpeg/FFprobe on PATH. CI installs them on Linux and Windows. ImageSharp and transitive dependencies are pinned in NuGet lockfiles. Contract generation skips database initialization and background workers.

For the read-only check, first generate a fixture in a **new** directory, then build the test-only container:

```sh
python tests/stage3/create_fixture.py .local/stage3-media
docker build -t luma-stage3-verification -f tests/stage3/Dockerfile tests/stage3
docker run --rm --mount type=bind,source=/absolute/path/to/Luma,target=/source,readonly --mount type=bind,source=/absolute/path/to/Luma/.local/stage3-media,target=/media,readonly luma-stage3-verification
```

On Windows, use absolute Windows paths for the two bind sources. The container copies source into its disposable filesystem before building; it does not overwrite local build outputs. This is a verification image, not the stage 7 deployment package.

## Verification results and limits

Final checks passed:

| Command | Result |
| --- | --- |
| `dotnet restore Luma.slnx --locked-mode` | Passed |
| `dotnet build Luma.slnx -c Release --no-restore` | Passed, zero warnings/errors |
| `dotnet test Luma.slnx -c Release --no-build` | Windows: 29 passed, one explicit Linux-only symlink skip; Linux: all 30 passed |
| `npm run generate:api` | Passed; OpenAPI and TypeScript regenerated |
| `npm run lint` | Passed |
| `npm run build` | Passed |
| `npm test` | All three tests passed |
| `npm run test:e2e` | Desktop/mobile Chromium: both passed |
| `python tests/stage3/check_queries.py` | 120k and 1m query plans checked |
| Read-only Docker verification command above | Passed; restart, cache loss and child-process limits verified |

Browser tooling printed the existing harmless `NO_COLOR`/`FORCE_COLOR` notice. No unresolved build/test failures remain. [Read-only run summary](performance/stage3-readonly.json) records the final process/memory sample; the restart also reduced aggregate concurrency to one and checked that new limit. During development, checks exposed and resolved a JPEG filter failure, empty-result DTO materialization, image upscaling and a non-scaling job-claim query. The attempted ImageSharp 4.x build required a license key; the implementation uses 3.1.12 and does not disable license validation.

This delivery does not claim the 120,000-file workload budgets, million-item browse/search budgets, Raspberry Pi throughput, or mobile UI budgets. Those remain stages 4–7 acceptance work. The source fixture is deliberately small and low resolution; it validates format and recovery behavior rather than decoder performance on high-resolution originals. A same-size/same-mtime source edit still needs a forced scan, as specified in the identity contract.
