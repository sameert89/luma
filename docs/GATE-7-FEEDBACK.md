# Gate 7 feedback verification

Date: 2026-09-18. This records the follow-up round after the Gate 7 staging delivery. It resolves the reported preview-preparation and Reels findings and completes the outstanding million-row query benchmark. It does not change the [Gate 7 release blockers](GATE-7.md), which remain open.

## Reported findings

1. Preview priority does not work in search results, which stay on "Preparing preview…"; previews should be requested and filled in so the person can see what they searched for.
2. Reels filters are not preserved.
3. The Reels progress bar is always visible; it should appear when the bottom area is tapped and fade otherwise.
4. Reels cannot be paused by tapping the centre.
5. Double tapping should like an item. Not previously required.
6. Preview preparation in a folder looks random instead of following the order shown.

## Causes

Findings 1 and 6 share the queue. `POST /api/media/priority` moved every requested media to the same `NextAttemptAt`, so the worker's `ORDER BY NextAttemptAt, MediaId` fell back to media ID. Preparation therefore followed insertion order rather than the displayed order, and reordered results such as newest-first looked arbitrary. Reproduced against a 600-file library: a request listing `401, 201, 402, 202, …` in display order was prepared as `201, 202, …, 401, 402, …`.

Finding 1 had a second cause. The request only woke jobs whose owning scan was `running` or `completed`, and the worker claims under the same condition. Media discovered by a scan that was later cancelled or interrupted therefore had no runnable owner. Opening that folder repaired it, because folder-demand discovery re-homes its jobs, but search spans folders and only the current folder is queued. Reproduced by cancelling the scan that owned 40 media: search results stayed at 30 of 60 prepared indefinitely, and the priority request returned 204 without changing anything.

The client compounded this. The gallery sent only the rows in the viewport, once per media, in whatever order the virtualizer yielded, and never re-sent after a failed request. The viewer and Reels never asked at all.

Findings 2 to 5 are Reels interaction gaps. Entering Reels rebuilt its query from the current gallery or search filters, so anything chosen in Reels was discarded on the next visit. The seek control was rendered unconditionally. No gesture was bound to the media surface other than swipe navigation, and Reels had no like control.

## Changes

`MediaBrowser.PrioritizeAsync` stamps each requested position with its own `NextAttemptAt` inside a reserved window before ordinary work, so preparation follows the requested order; a later request sorts after an earlier one rather than starving it. Before that, it adopts requested jobs whose scan can no longer run them into the newest runnable scan of the same library, and leaves alone any media whose library has none. Both statements run in one transaction, keep the existing `IX_Jobs_Ready` ordering, and still only update existing rows: no enumeration, no original access, no generation. The request contract is unchanged and the generated contracts do not drift.

`usePreviewPriority` replaces the gallery's inline request and is shared with the viewer and Reels. Callers pass items in display order; the gallery starts at the first visible row, continues through the loaded pages and wraps to the rows above, so the viewport is asked for first. Batches stay at the endpoint's 200-ID bound, are sent only when the ordered set of unprepared media changes, settle for 300 ms so scrolling does not send a request per frame, and retry a failed request up to three times with a 3 s gap.

Reels stores the filters and sort it was last used with, restores them on return and persists them across restarts; a first visit still clears the library/folder scope and defaults to videos. Its seek control is hidden until the strip holding it is tapped, then fades out after three seconds; it also reveals itself on keyboard focus and stays in the accessibility tree throughout. Tapping the media toggles playback, and double tapping likes the item with a brief confirmation. The single-tap action waits out the double-tap window so liking never toggles playback on its way through. Reels also gained a Like control in its button column, so the gesture is a shortcut rather than the only way to like, and `PUT /api/media/{id}/preference` is unchanged.

Documented in [MEDIA-CACHE.md](MEDIA-CACHE.md), [API.md](API.md) and [PRODUCT.md](PRODUCT.md). PRODUCT.md previously allowed mode switching to discard the Reels query; that is now a preserved per-mode query at the user's request. API.md also had two double-encoded ellipses left from the Gate 7 encoding conversion; they are corrected.

## Commands and results

Windows terminals used `login:false`. Frontend commands ran in `src/Luma.Web` with Node 24.21.0 prepended to PATH.

| Command | Final result |
| --- | --- |
| `dotnet build Luma.slnx -c Release` | Pass, zero warnings/errors |
| `dotnet test Luma.slnx -c Release` | 58 passed, one Unix-only symlink test skipped on Windows |
| `npm run build` | Pass |
| `npm test` | 21 passed |
| `npm run lint` | Pass |
| `npm run generate:api` | Pass; contract and generated-type hashes unchanged from Gate 7 |
| `dotnet run --project tests/Luma.Tools -c Release --no-build -- seed .local/browser-fixture-v2 1500`, then `npx playwright test` | 55 passed, three desktop skips for mobile-only scenarios |
| `dotnet run --project tests/Luma.Tools -c Release --no-build -- gate7-queries .local/perf-stage45-1m 1000000 20` | Pass on the second attempt; see [Stage 7 verification](STAGE-7-VERIFICATION.md) |

Backend regression tests cover the requested preparation order and the adoption of media left by a cancelled scan, including the case where no runnable scan exists and the job is correctly left alone. Frontend tests cover the request order, the settle and bounded-retry behaviour, the Reels tap, double-tap and seek-strip behaviour, and the preserved Reels query. Browser scenarios cover the displayed-order request on both viewports, an unindexed folder preparing from what is on screen, the seek control revealing and fading, double tap liking and persisting to Favourites, and the Reels query surviving a trip through Search.

## Failures found and corrected

The million-row benchmark aborted on a cold page cache; it is recorded in the Stage 7 verification rather than hidden, and the run was repeated with the fixture resident.

Two browser scenarios initially depended on fixture state they did not own: loose `palette-*.jpg` files that cache maintenance deletes, and the media that `stage6.spec.ts` creates in its own `beforeAll`, which had not run yet. They now copy from a registered cache entry and create their own clip. A run against a fixture carrying media folders accumulated from earlier sessions failed nine mobile browsing scenarios on a library cover whose generated file had been evicted; rebuilding the disposable fixture cleared it, and no application change was needed. The Reels unit test fixture omitted `thumbnail`, which the shared priority hook reads; the fixture now matches the contract.

Double tapping the exact centre of a paused Reels video reaches the centred play affordance rather than the media surface. That is the correct result for that control, and the surrounding surface likes as expected; the browser scenario taps clear of it.

## Manual verification

A 600-file library of real JPEGs across three folders was indexed by a Release server, with processing limited to one worker so ordering was observable.

- Before: a request in display order was prepared in media-ID order.
- Before: with the owning scan cancelled, 30 of 60 search results never prepared.
- After: the same cancelled-scan search reached 60 of 60, and the previously stuck media was prepared in exactly the requested order.
- After: on a fresh index, preparation followed the displayed order apart from work already in flight when the request arrived.

This is a local functional check on synthetic media, not a release measurement.
