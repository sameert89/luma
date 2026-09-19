# Gate 7 feedback verification, round 2

Date: 2026-09-18. This records the second follow-up round after [Gate 7 feedback verification](GATE-7-FEEDBACK.md). It does not change the [Gate 7 release blockers](GATE-7.md), which remain open.

## Reported findings

1. The three-dot menu button is no longer circular.
2. Main library cards do not fill available space, most visible with a single connected library.
3. Importing existing tags/metadata from media is still a major missing feature.
4. Reels' side controls are too cluttered.
5. The double-tap Like animation briefly flashes/blinks during its fade-out; the heart should be red.
6. Photo auto-scroll in Reels is broken.
7. Shuffle mode in Reels results in a black screen.
8. Opening Reels changes the folder/path that Library later returns to.
9. Tags cannot be renamed or deleted.
10. Collections' separate Folders and Albums sections feel redundant.

## Causes and changes

**1. Icon buttons were ovals, not circles.** `IconButton` wrapped `QuietButton`, inheriting its text padding (`px-3 py-2`) and `min-h-10`. With only an icon and no label text, the box's width and height no longer matched: roughly 44px wide by 40px tall, an oval. `IconButton` now renders its own fixed `size-10` square with no padding, used everywhere an icon-only control appears (Reels, the viewer, the search header, dialogs).

**2. Library cards used a fixed column count.** The home grid and folder-card grid used `grid-cols-2 sm:grid-cols-3 …`: with one item, the grid still allocated the other columns, leaving the card in one corner. Both now use `grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]`, whose collapsing empty tracks let a single card fill the row while more cards still wrap into a normal responsive grid. This is a bracketed Tailwind value because no fixed-scale utility expresses auto-fit/minmax; a comment in `App.tsx` records why.

**3. Metadata import already read EXIF and XMP for photos; video coverage was thinner and query-scoped bulk import didn't exist.** Photos already union embedded EXIF keywords and an embedded XMP `dc:subject` packet (verified by existing tests). Video only read simple container tags (`keywords`/`subject` via ffprobe); most video XMP is a real embedded XMP packet, which those tags don't expose. `MetadataKeywords.ReadEmbeddedXmpPacketAsync` now scans bounded 8 MiB windows near the start and end of the file for a self-delimiting `<?xpacket begin=?>…<?xpacket end=?>` packet — the same container-agnostic technique any XMP reader uses — and unions its keywords for video imports. Import also no longer requires an explicit selection: `POST /api/imports/tags` with `mediaIds` omitted now walks every item matching `query`, one at a time like a scan, mirroring how `Export XMP` already works library-wide with no selection. Export remains XMP-only, unchanged.

**4. Reels' button column occupied a large share of the viewport.** Filters, Like, Mute, Auto-scroll, Tags, Previous and Next were seven always-visible circular buttons stacked down the right edge. They now sit behind a single "Reels menu" toggle that drops them open below it (the same collapsing-grid-track technique used for the mobile search reveal, applied vertically) and stay open across repeated taps until explicitly closed — one extra step to open, not one per action. Video-specific display options (fit/fill, zoom, playback speed, fullscreen, download, stream URL) were left in MediaStage's existing "More options" sheet; folding those into the same menu as well would need lifting that state out of MediaStage, which this pass did not do.

**5. The like animation's easing produced a visible flicker; color was themed, not red.** `@keyframes luma-like` used one `ease-out` curve across a rise-then-fall keyframe pair. Applied to the fall (opacity 1→0), `ease-out` drops quickly then lingers near-zero for a long tail, which reads as a second flash rather than a clean fade. The fall now gets its own `ease-in` curve (declared on the peak keyframe), accelerating smoothly to exactly 0. The heart uses `fill-red-500 text-red-500` — a deliberate, brand-independent choice (the universal "double-tap to like" red, distinct from the app's own themed accent used for the persistent Liked badge elsewhere) rather than a new design-system color.

**6. Photo auto-scroll: no reproducible defect found; effect dependencies tightened regardless.** A fake-timer unit test exercising the exact reported scenario (auto-scroll enabled, current item a photo, `next` already resolved) advances correctly. The auto-scroll effect's dependency on the `next` and `item` *objects* was nonetheless real over-sensitivity: any incidental new object with the same id (a query settling, structural-sharing edge case) would restart the three-second count before it fired. It now depends on `item?.id`, `item?.mediaType` and `next` is only read inside the effect for the id/type comparison — the timer no longer resets unless the id or type actually changes. If the photo case still doesn't advance after this, it is not the mechanism this investigation covered and needs a fresh repro.

**7. Shuffle: no reproducible defect found in query logic or navigation; a real display gap was found and fixed.** Extensive testing — photos, videos with real playable files, mixed grouping, repeated Next — found shuffle mode's backend query and Reels' navigation working correctly in every case tried, including the existing `reels honour photos and mixed-media selections` test, which already exercises shuffle end to end. The one failure reproduced was against a synthetic fixture whose video rows have no real backing file: reaching one under shuffle correctly reports `source_unavailable`, but the failure text sat in a small strip at the bottom of an otherwise solid-black stage — easy to miss, and indistinguishable at a glance from the reel being stuck. That message is now a centered, clearly visible panel in Reels specifically (the normal viewer's smaller chrome already made its equivalent message legible). If shuffle is still reproducibly broken with real, available media, this fix will not have addressed it and needs a concrete repro (media type, filters, grouping).

**8. Reels could permanently change the folder/query that Library and Search return to.** `filters` was one shared piece of state reused across sections; entering Reels deliberately clears the library/folder scope (by design), but returning to Library or Search only stripped the Reels-forced video type, leaving the folder cleared or replaced by anything chosen inside Reels' own filter sheet in the meantime — a real loss of place, not the "modes stay independent" behavior already documented. A `browseMemory` ref now records the filters last actually used in Library/Search (mirroring the existing `reelsMemory` used for Reels' own persistence) and restoring either mode from Reels uses that snapshot wholesale instead of patching the Reels-tainted value.

**9. Tags could not be renamed or deleted.** `PUT /api/tags/{id}` renames a tag, merging into an existing tag when the new spelling's key collides with a different one rather than failing (fixing a typo can also deduplicate); `DELETE /api/tags/{id}` removes a tag and every assignment. Collections exposes both from each tag chip: a visible "Manage tag" button (keyboard- and pointer-reachable) opens a small dialog with rename and a confirm-guarded delete; a long press on the chip is a touch shortcut to the same dialog, not a replacement for it.

**10. Collections' library-listing section duplicated the Library tab.** "Folders and albums" listed the same libraries the Library tab's home screen already lists, with identical behavior (open a library). Per the stated test — separate sections are only worth keeping when they behave differently — it is removed; Collections now holds Favourites and Tags, the two views that aren't already a primary destination.

## Commands and results

Windows terminals used `login:false`. Frontend commands ran in `src/Luma.Web` with Node 24.21.0 prepended to PATH.

| Command | Final result |
| --- | --- |
| `dotnet build Luma.slnx -c Release` | Pass, zero warnings/errors |
| `dotnet test Luma.slnx -c Release --no-build` | 62 passed, one Unix-only symlink test skipped on Windows |
| `npm run build` | Pass |
| `npm test` | 25 passed |
| `npm run lint` | Pass |
| `npm run generate:api` | Pass; new `RenameTag`/`DeleteTag` operations present, no other drift |
| `dotnet run --project tests/Luma.Tools -c Release --no-build -- seed .local/browser-fixture-v2 1500`, then `npx playwright test` | 55 passed, three desktop skips for mobile-only scenarios |

Backend regression tests cover: renaming a tag in place, renaming into an existing tag (merge, with media reassignment verified), rejecting an unknown tag ID, deleting a tag and its assignments, and rejecting a repeat delete; a query-scoped import walking every matching item (image and video) with the video item's embedded XMP packet correctly unioned; and the embedded-XMP packet scan finding a packet near the front of a file, only in a bounded tail scan past a large head window, and reporting nothing rather than erroring when absent. Frontend tests cover the icon button's fixed square rendering implicitly through existing suites, the collapsed Reels menu (existing button-column tests updated to open it first), a tag chip's plain click vs. long-press-into-manage-dialog and its cancel-before-threshold case, and a full rename round trip through the manage dialog. Browser scenarios cover tag creation, rename, and delete through Collections, and Reels never changing the folder library returns to.

## Failures found while writing this round's tests

The initial Playwright test for tag rename/delete acted on the fixture's seeded "Family" tag. Playwright reuses one fixture database across the desktop and mobile projects in a single run (`fullyParallel: false`), so the desktop pass deleted "Family" before the mobile pass could find it — not a product defect, a test correctness bug. The test now creates and only ever touches a tag unique to that run. Locating the newly added tag chip also initially used the tag's visible text as its accessible name; `TagEditor`'s existing chip buttons are labelled `Remove tag <name>`, not `<name>`, which the test now matches. Closing the nested "Media details" sheet with two immediate `Escape` presses raced the first dialog's exit animation and left the app in a state where the primary navigation couldn't be reached; the established `page.goBack()` pattern already used elsewhere in this suite for the same nested-dialog case replaced it.

## Manual verification

Reproduced item 7's one real finding (video with no backing file under shuffle) against a live server: before, the stage showed only a small barely-visible text strip against solid black; after, a centered panel states the video could not play, and Previous/Next continue to work normally. Reproduced items 1 and 2 visually in a built frontend. Items 6 and 7's underlying mechanisms were exercised with real ffmpeg-generated video files and fake-timer-driven photo auto-scroll; both held up without the reported failure in every scenario tried, as detailed above.
