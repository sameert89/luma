# Stage 6 handoff

## Gate and current behavior

The user accepted the stages 4–5 UI gate on 2026-09-17 after reviewing the motion, themes, album covers, scan controls, selection and preference fixes. Original feedback files remain the review history; do not discard them or unrelated worktree changes.

The subsequent idle-folder issue is addressed by background direct-folder discovery. Opening an unindexed/partially indexed folder queues its direct files and child-folder entries; processing continues after discovery stops. Already-completed folders skip discovery unless pending jobs have no runnable owner. Full rescans remain explicit. Entirely unknown filesystem folders first require discovery of their parent. Subsequent additions to completed folders require a rescan.

Migration 0006 adds nullable scan scope and completed direct-folder discovery timestamps; migration 0007 indexes pending direct-folder media. Regenerate API types with `npm run generate:api` when changing contracts. New endpoint details are in [API-FOLDER-INDEXING.md](API-FOLDER-INDEXING.md); reconciliation/recovery decisions are in [ADR 0007](adr/0007-folder-demand-indexing.md).

## Next implementation: stage 6

1. Native video playback and range-capable original streaming, plus the documented external-player workflow for unsupported browser codecs. Do not introduce automatic transcoding.
2. Viewer fit/fill, actual size, zoom/pan, visual rotation, fullscreen and explicit original access. Preserve the current dialog motion, keyboard focus restoration and query/scroll position.
3. Reels over the existing shared media query: vertical navigation, bounded nearby preloading, mute, configurable auto-scroll and optional tags. Stop inactive playback and avoid mounting entire collections.
4. Application help for keyboard shortcuts and completed phone interactions; validate autoplay restrictions, playback failures and resource limits.

Normal browse/search requests must remain SQLite/generated-cache-only. Explicit original streaming/access belongs in separate endpoints with source-path validation and CancellationToken support. Use existing shared Tailwind tokens and Radix primitives; retain reduced-motion behavior and the accepted dark/light palettes.

## Verification and limits

Backend regression coverage includes direct-folder discovery, preview completion with discovery idle, scoped missing reconciliation, descendant exclusion, preserved preferences, idempotent folder requests and conflict/not-found responses. Browser coverage opens a real unindexed folder in the disposable fixture, waits for generated thumbnails, opens its preview and asserts that no whole-library scan was requested.

This local verification does not establish Raspberry Pi throughput, memory or concurrent indexing budgets. Target-hardware testing remains a release requirement. Stage 6 video/reels deliverables are not implemented by this handoff.

Executed: `npm run generate:api`; `dotnet build` (zero warnings/errors); `dotnet test --no-build` (41 passed, one Unix-only skip); `npm run build`; `npm test` (6 passed); `npm run lint`; `npm run test:e2e` (22 passed, two desktop skips for mobile-only cases). The folder-demand desktop/mobile smoke also passes after migration 0007 is applied to the existing browser fixture. An intermediate backend run had a stale expected schema version; the expectations now match schema version 7. No final failures remain. Generated thumbnails and folder previews were visually inspected on both screen sizes.

PowerShell commands should use `login:false` to avoid Starship noise. Initialize FNM directly and select Node 24 before npm commands.

# Remaining issues
- Animations are not being displayed on desktop
- on mobile its very easy to press backbutton which unloads the whole site ruining the experience, on an app a natural navigation stack would be to go back to the last thing we did
- Swipe controls are missing for photos and videos, even on the non reel player we shold be able to swipe left and right to go to next
- Zoom doesnt work on pictures which is a normal flow for any media viewer

## Stage 6 continuation

The functional implementation and its verification are recorded in [STAGE-6-VERIFICATION.md](STAGE-6-VERIFICATION.md). The earlier handoff remains the historical stages 4–5 gate. Original streaming, native playback, viewer transforms, shared-query reels, shortcut help and Back/swipe/zoom interactions are now implemented. Target-hardware/device performance gates remain outstanding.
