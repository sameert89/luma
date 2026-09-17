# Gate 7 staging verification

Date: 2026-09-17. Status: implementation delivered for staging; release acceptance remains open. See [handoff](STAGE-7-HANDOFF.md), [Gate 7 checklist](GATE-7.md) and [deployment instructions](DEPLOYMENT.md).

## Delivered behavior

All audited functional gaps are implemented: bounded child-folder pagination, mobile sorting, library-scoped search, tag all/any and availability filters, normal-player volume/mute, native keyboard seeking, photo/mixed Reels, Collections, six stable cursor sorts, folder/date/type grouping, seeded shuffle, persisted/resettable custom covers, cached random image content, explicit metadata tag import, snapshot XMP archives and missing-inclusive disliked-path exports. Metadata item results are paginated in the UI so findings beyond the first 100 remain reachable. Shared controls, generated contracts, SQLite and bounded in-process work retain the architecture invariants.

Backend regression tests cover tied sort/group keys, forward/backward traversal and matching neighbors; long Unicode filename cursors; covers and fallback; random errors/content with originals absent; metadata embedded/sidecar union, normalization, idempotence, invalid input and unavailable originals; export snapshots; queue and quota boundaries. Frontend tests and browser scenarios cover selected Reels filters, seek semantics, immediate scan-status refresh, pagination, mobile controls, search scope, custom covers, Collections, persisted shuffle seeds and keyboard audio/seek interaction.

## Commands and results

All Windows terminals used `login:false` (no profile). Frontend checks explicitly prepended Node `C:\Users\samee\AppData\Roaming\fnm\node-versions\v24.21.0\installation` to PATH; Node 24.21.0 was used for final validation. Commands below are run from the repository root unless a directory is specified.

| Command | Final result |
| --- | --- |
| `dotnet build Luma.slnx -c Release` | Pass, zero warnings/errors |
| `dotnet test Luma.slnx -c Release --no-build` | 56 passed, one Unix-only symlink test skipped on Windows |
| `npm run build` in `src/Luma.Web` | Pass |
| `npm test` in `src/Luma.Web` | 17 passed |
| `npm run lint` in `src/Luma.Web` | Pass |
| `npm run generate:api` in `src/Luma.Web` | Pass; second generation produced identical contract/type hashes |
| `dotnet run --project ../../tests/Luma.Tools -c Release --no-build -- seed ../../.local/browser-fixture-v2 1500`, then `npx playwright test` in `src/Luma.Web` | 45 passed, three desktop skips for mobile-only scenarios |
| `npx playwright test e2e/gate7.spec.ts --grep 'requested themes'` in `src/Luma.Web` | Two additional checks passed, desktop and Pixel 7 emulation; all five requested themes across cached search/gallery, viewer and photo Reels |
| `docker build -t luma:gate7-staging .` | Pass, final production frontend/server image |
| `python tests/stage7/verify_deployment.py` | All six upgrade/recovery phases passed |
| `git -c core.safecrlf=false diff --check` | Pass |

The full browser suite used production frontend and Release server, one worker, desktop Chromium and Pixel 7 emulation. Keyboard volume, mute/unmute, normal-video and Reels seek were exercised with native sliders. Cached images were decoded in each requested theme. These are functional checks, not a real Android codec or long-session resource certification.

Contract drift hashes: `contracts/luma.json` SHA256 `FC87C0E7281DBDCC98F5B9CE177A61730D4038401370E9FDE2ED1A4FA9F3E5CC`; generated TypeScript SHA256 `0BEE1EE2CE2169BAA19C8F8D78752A9C9622480AC68883F3E39CD23C5560407D`.

## Failures found and corrected

The original library-card accessible names made old browser selectors ambiguous. Explicit card names and selectors now agree. Gallery restoration assumed an absolute scroll offset despite preceding folder cards; it now accounts for that leading content and the test restores a position inside the gallery. Opening scan controls previously waited for the polling interval before fetching scan readiness, which left the mobile start action disabled; opening now refreshes immediately and has a regression test.

Initial large-query runs exposed a two-second SQL timeout: newly introduced indexes had no statistics while older indexes had analyzed statistics, so SQLite chose a random-key scan and temporary sort for modified ordering. Migration 10 analyzes Media after adding the indexes. Single-tag all-mode also unnecessarily grouped tag results; its equivalent single-tag semijoin now avoids that work. Final synthetic measurements use those corrections. A first million-row attempt during overlapping container/browser/random work also exceeded the SQL deadline; it was rerun with that competing work stopped, without weakening the deadline. Shuffle links without a seed and maximum-length Unicode filename cursors received regression fixes before the final build.

Early commands also encountered a frontend command run from the repository root instead of its package directory, a no-profile Node 22 default, and Windows tool DLL locks during overlapping benchmark/build commands. Package commands were rerun in the frontend directory under Node 24; subsequent tool execution used `--no-build` after the solution build. API documentation contained legacy non-UTF8 encoding; it is now UTF8 and passes whitespace validation. A later direct Playwright rerun without reseeding also failed because disposable fixture palette files had been cleaned up (four setup failures, eight scenarios not run). Reseeding with the existing tool repaired setup. The final full suite uses that documented seed step. No application change was needed for this fixture failure.

## Local deployment evidence

Final image ID: `sha256:c2f4810db55be77f71f616122dbefbb6549d720217add31adda0c9ff0654d984`.

[Raw Docker commands and results](performance/stage7-local-deployment.json) record six isolated Docker Desktop Linux AMD64 phases: stopped schema-7 backup; schema 7→11 upgrade with tags/preferences and new APIs; restart persistence; cache loss with forced regeneration; unavailable-source cached browsing plus disliked-path export; and restoration of a consistent snapshot into a fresh volume. Read-only media mounts were used. The deliberately invalid video produces one expected `invalid_media` processing result; valid fixture media becomes ready. Test containers/volumes were cleaned up. This is local deployment evidence, not the required Pi run.

## Local large-query evidence

`dotnet run --project tests/Luma.Tools -c Release --no-build -- gate7-benchmark .local/perf-stage45-120k 120000` measures six sorts × four grouping choices × broad/selective filters with 20 warmups and 200 samples. [120k synthetic report](performance/stage7-local-120k.json) includes query plans and exhaustive traversal. Worst p95 was 118.494 ms (shuffle/type/selective); all 48 combinations were below 150 ms on this Windows development machine. All six sorts traversed exactly 120,000 distinct IDs without omissions or duplicates.

The analogous million-row command was attempted with 20 measured samples and five warmups per combination: `dotnet run --project tests/Luma.Tools -c Release --no-build -- gate7-benchmark .local/perf-stage45-1m 1000000 20`. One attempt timed out during selective measurement under competing load; another completed measurement phases but timed out during traversal, so it did not produce a final percentile report. The tool now checkpoints completed query measurements and records traversal failures instead of discarding all evidence. `dotnet run --project tests/Luma.Tools -c Release --no-build -- gate7-traversal .local/perf-stage45-1m 1000000 20` isolates exhaustive traversal; final results are recorded below. Investigation isolated a deep type-sort issue: SQLite repeatedly scanned tied text type keys. Type pages now seek IDs within each of the two allowed types, including grouped pages, without changing cursor semantics or adding indexes. Mixed-media forward/backward/group/neighbor tests pass for all six sorts. The two-second SQL deadline is unchanged; stress and concurrent-indexing budgets still require prescribed release measurements.

`python tests/stage7/benchmark_random.py .local/perf-stage45-120k` and the equivalent million-row fixture command measure the exact cache-ready random SQL predicate with broad and selective image filters, both pivot halves and wraparound, 200 warmups and 1,000 samples. Cache metadata in these fixtures is synthetic: no original or generated file is read. The C# tool's older `randomReports` field measures only a raw pivot lookup, without cache readiness, and is not evidence for the full random endpoint. Real cached JPEG response behavior is verified separately in backend and container tests.

These fixtures have one library/two folders and correlated synthetic tags, rather than the representative multi-root fixture distribution prescribed in PERFORMANCE.md. Some checks ran alongside local builds/browser work. Results are local diagnostic evidence; reduced samples, one run, concurrency one and lack of real indexing prevent claiming release performance acceptance. Peak tool working set includes the exhaustive traversal HashSet and is not server resident-memory evidence.

After the type-seek fix, [million-row traversal](performance/stage7-local-1m-traversal.json) passes all six sorts: exactly 1,000,000 distinct IDs each, without omissions, duplicates or SQL timeouts. [Before/after deep type query plans](performance/stage7-type-seek-plans.json) show the change from a type-only range to an equality on type plus an ID range. The plan comparison uses Python SQLite, whose version is recorded separately.

Final code is additionally measured with `gate7-queries .local/perf-stage45-120k 120000 20` and `gate7-queries .local/perf-stage45-1m 1000000 20` through the same Release tool command. Each checks all 48 sort/group/filter combinations with five warmups and 20 measured samples, recording sorted raw latency samples and query plans. These reduced-sample final-code diagnostics complement the earlier 200-sample 120k run; they are not the prescribed release protocol.

## Outstanding release requirements

- Raspberry Pi 5, 4 GiB, Debian 13 ARM64 container installation and recovery on the documented USB3/Btrfs RAID1 storage.
- Representative actual 120k media library during initial and incremental indexing, including latency, CPU, child-process RSS, disk and queue measurements.
- Full PERFORMANCE.md methodology: representative distributions, cold trials, concurrency one/four, deep cursors, 1,000 samples and three repeated runs with worst-run results.
- Thirty-minute / 10k-item desktop and real 4 GiB Android frame, dropped-frame, heap/tab-memory, DOM/retention and device codec results.

Gate 7 must remain open until these required measurements are linked and accepted. The staging implementation does not claim that unavailable target-hardware evidence has been collected.
