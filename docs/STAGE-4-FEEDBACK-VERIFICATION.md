# Stage 4 feedback follow-up

Implemented and verified locally on 2026-09-16. This follows the reported real-library findings without changing stage 6's video/reels scope.

## Changes

- Libraries-only homepage with prominent discovery and preview preparation counts. No homepage media query. Dark surfaces and lavender accents follow the supplied mockups; filters are grouped by purpose. Shared theme tokens, native controls and Radix dialogs remain in use, with short color transitions respecting reduced motion.
- Pending thumbnails/previews show preparation placeholders without issuing cache requests. Bounded gallery summaries and the active viewer refresh while preparation is pending. Failed preparation is distinguished from pending work.
- Cache HTTP requests enqueue bounded background demand instead of writing to SQLite. Existing pending/running jobs do not need another write. A writer-lock regression verifies unavailable-cache responses remain prompt.
- Discovery commits at most 32 entries per batch and yields between batches. Processing no longer sleeps after every successful job. Idle processing avoids repeated empty claim writes, and expired-lease recovery runs every 30 seconds.
- Image workers reuse killable decoder processes for up to 128 requests, with a shared bounded allocator per process. Regression coverage includes corrupt input followed by valid work across recycling.
- Folder search includes descendants by default; filter controls retain an explicit subfolder choice. Existing HTTP filter semantics are unchanged.
- Removed the originals banner and the “Original availability” detail. Deleted indexed paths are checked by a bounded background worker; normal browsing remains SQLite/cache-only. Missing records retain tags/cache but disappear from default results. See [ADR 0005](adr/0005-indexing-feedback.md).
- Cancellation, restart behavior and reconciliation delays are documented in [INDEXING.md](INDEXING.md).

## Verification

| Command | Result |
| --- | --- |
| `dotnet build Luma.slnx -c Release` | Passed; no warnings/errors |
| `dotnet test Luma.slnx -c Release --no-build` | 37 passed; one existing Windows symlink test skipped |
| `npm run build` in `src/Luma.Web` | Passed |
| `npm run test` | 5 passed |
| `npm run lint` | Passed |
| `npm run test:e2e` | 6 passed across desktop/mobile |
| `docker build -t luma:stage4-feedback .` | Passed, Linux amd64 |
| Docker smoke with a read-only source mount | Three images prepared; homepage and each generated preview returned HTTP 200 |
| `git diff --check` | Passed |

Browser tests check libraries-only home, actual image loading, viewer navigation/focus restoration, search and bulk tags. The scrolling check waits for eight additional cursor pages and verifies at most 80 mounted cells and 300 retained summaries. Desktop/mobile screenshots were inspected. Synthetic browser fixtures now use platform-native cache paths and consistent ready-job state.

During implementation, verification caught an outdated synchronous queue assertion, a missing internal processing-status property, and a SQLite integer/Boolean constructor mismatch in presence checking. These were fixed; the final runs above passed.

## Decoder measurement

Command: `dotnet run --project tests/Luma.Tools -c Release --no-build -- decode-benchmark .local/decoder-feedback 20`.

Twenty sequential decodes of one synthetic 1920 × 1080 JPEG, each producing and validating a thumbnail and preview, took **18.36 seconds** with one fresh process per image and **3.71 seconds** with process reuse (about **4.9× faster**, **5.39 images/second**). Both measurements include startup. The benchmark was run separately from builds and tests. [Raw results](performance/stage4-feedback-decoder.json).

This isolates decoder startup savings; it does not measure discovery, database publication, concurrent browsing, a mixed real collection, or Raspberry Pi throughput. The user's library and target environment remain inaccessible from development.

## Remaining planned scope and practical limits

- Video playback, range streaming and reels remain stage 6. This build displays video posters.
- Source disappearance detection is eventual: the default 100 records per 10 seconds takes roughly five hours to visit 177,000 records, plus I/O time. An explicit scan reconciles sooner and discovers additions/restorations/replacements. Unavailable roots preserve their records.
- A folder can still be empty before discovery reaches it. The UI explains this; no invented percentage is shown for an unknown discovery total.
- The real-library throughput and target-hardware performance acceptance checks still require user-environment verification.
