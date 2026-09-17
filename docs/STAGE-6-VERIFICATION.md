# Stage 6 implementation and verification

## Delivered behavior

- Explicit `GET /api/media/{id}/original` opens a validated source file as an asynchronous, range-capable stream. `download=true` requests an attachment. Unknown/disabled records return 404; missing/unreadable originals or rejected source paths return the common 503 `source_unavailable` problem. Original access uses the existing root containment/link checks. It never runs processing tools or changes originals.
- Video playback uses themed overlay controls for play/pause, seek, current time, speed and fullscreen instead of browser-default controls. Playback failures retain download and stream-URL copy actions with VLC instructions. No automatic transcoding is introduced.
- Images use generated previews until the user explicitly requests an original or actual size. Fit/fill persists across the viewing session, while zoom controls/wheel/pinch, drag pan, visual rotation and fullscreen remain per item. Previous/next buttons, keyboard navigation and horizontal swipes share the existing query order. Accepted entry/exit motion, reduced motion, focus restoration and gallery scroll restoration remain in place.
- Reels use the same search, tag, date, preference and sort filters as the gallery, but entering Reels clears the current library/folder browse location and forces `mediaType=video`. Path/library narrowing remains available through the filters sheet. One active video is mounted; only the next generated poster is preloaded when available. Replacing/leaving an active video pauses it and releases its source. Mute defaults on. Reels default to fill, use vertical entry motion, keep browser-native video controls hidden, and expose a thin bottom seek bar that remains tappable/clickable. Speed, download and external-player actions remain in the options sheet. Auto-scroll is a single icon toggle that advances videos when playback ends. Tags can be shown and edited.
- Reels keep separate fit/fill defaults: normal viewer media starts in Fit, Reels starts in Fill, and each mode can be toggled from the options sheet. The Reels bottom seek bar sits directly above the mobile bottom navigation, and the tag editor uses a taller themed sheet. Reels videos can be opened in the normal viewer UI from the options sheet.
- Reels now render as an immersive viewer: the search/header chrome and gallery heading are hidden, the Luma mark with a reels icon floats over the media, and filters/mute/auto-scroll/tags/next/previous controls sit in a floating control stack. Reels fullscreen targets the whole reels surface so its overlay UI remains visible; the normal viewer still fullscreens the media stage for longer viewing.
- Media-stage fit/fill, image tools, fullscreen, download and external-player actions live behind a sheet opened by an icon button. The obsolete Open original link was removed; Download uses the shared themed link control. The options button is positioned away from like/details and navigation controls in the normal viewer and stays on the lower-right control rail in Reels.
- Browser Back dismisses details, viewer and other sheets in order, then returns through library/folder/search/mode navigation. Dialog history setup tolerates React StrictMode and non-secure mobile LAN origins where `crypto.randomUUID` is unavailable. Search/filter application replaces its temporary sheet entry with the resulting view.
- Home library cards open directly when clicked; the only separate card action is the rescan/reload control. Subfolders render as media-sized cards in the gallery content area instead of top pills, so a folder containing only child folders no longer looks empty. Empty Search opens an instructional state instead of a random unfiltered feed.
- Visible gallery/search/Reels items with pending cache entries call `POST /api/media/priority`, which only updates existing SQLite processing jobs for those media IDs. The endpoint validates 1 to 200 positive IDs and wakes waiting/pending jobs by moving their next attempt earlier. It does not enumerate directories, touch originals, decode media or invoke processing tools during browse.
- Settings includes application help for keyboard shortcuts, mobile gestures and the external-player workflow.

## Verification

Commands run from the repository root unless marked otherwise. Node commands initialize FNM and select Node 24; PowerShell runs with `login:false`.

- `dotnet build`: zero warnings/errors.
- `dotnet test --no-build`: 43 passed, one Unix-only skip.
- `npm run generate:api --prefix src/Luma.Web`: passed; original and visible-media priority endpoints included in generated contracts.
- `npm run build --prefix src/Luma.Web`: passed.
- `npm test --prefix src/Luma.Web`: 14 passed.
- `npm run lint --prefix src/Luma.Web`: passed.
- Focused browser run (`npm run test:e2e -- e2e/stage6.spec.ts`, from `src/Luma.Web`): 9 passed, one desktop skip for the physical-touch-only case. `npm run test:e2e --prefix src/Luma.Web`: 31 passed, three desktop skips for mobile-only cases. The focused suite was repeated after compacting controls and extending vertical touch coverage.

Backend regression coverage verifies original bytes, partial-range bytes and length, 416, attachment disposition, 404, traversal rejection and source loss. Frontend unit coverage also traverses ten reels items and verifies at most three retained query entries, one mounted image, one nearby preload and release on exit. Frontend unit coverage verifies cached-first image access, explicit originals, sticky fit/fill, keyboard zoom/rotation, themed playback speed, blocked autoplay and StrictMode resource cleanup. Shared modal coverage verifies dialogs open without secure-context crypto APIs, covering actual-phone LAN access for filters, viewer details and player sheets. Browser tests use a generated four-second H.264 MP4 and a deliberately invalid MKV in the disposable fixture. Original generation occurs only in test setup.

Intermediate checks found an outdated image-only browser assertion, a captions lint rule requiring a documented exception for personal media without caption assets, and missing SQLite helper registration in the Node browser-fixture setup. A later playback check exposed an autoplay rejection overwriting a codec failure; the failure state now preserves the external-player guidance. The retained-state test also caught a TypeScript-only test selector mismatch during the production build; it was corrected. These issues were corrected; no required build, unit-test, lint or browser failures remain.

`git diff --check` reports pre-existing whitespace in `USER_FEEDBACK.md` (lines 328 and 344); that unrelated feedback history was preserved. Desktop/video and mobile/reels screenshots were visually inspected.

## Outstanding acceptance gates

Update 2026-09-17: the user confirmed Gate 6 was implemented and user-tested. Gallery/Reels use the same applicable filter semantics without requiring shared state; clearing browse scope is intentional. Auto-scroll is a simple on/off toggle. The full playback control set applies to the normal video viewer, not Reels. Remaining findings and target-environment measurements are tracked under [Gate 7](GATE-7.md).

Local desktop and mobile Chromium emulation does not establish Raspberry Pi throughput, real Android/iOS codec support, 30-minute client frame/memory budgets, or concurrent indexing performance. These target-hardware/device measurements from PERFORMANCE.md remain required for the Gate 7 release validation. No target-hardware performance result is claimed by this local verification record.
