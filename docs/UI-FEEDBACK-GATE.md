# Stage 4–5 UI feedback verification

## Acceptance

On 2026-09-17 the user reported a positive client review and authorized proceeding through this gate. The idle-folder indexing issue observed by the development team was handled as a follow-up. See [the stage 6 handoff](STAGE-6-HANDOFF.md) for the behavior, remaining limits and next-stage scope. Earlier statements below that leave the gate open describe the pre-acceptance review state.

## September 17 follow-up

- Shared Radix dialogs and sheets now animate on entry and exit. The viewer stays mounted until its exit finishes, and its accessible title remains available with the visual header hidden.
- Folder, search and section navigation have a short entrance transition; image navigation uses directional motion and fades cached previews when loaded. Routine motion lasts 150–180 ms and respects reduced motion. No outgoing gallery collection is retained.
- Added Cinema red, Midnight blue, OLED black and Forest dark themes with independent previews and persistent selection.
- Cancelled scans no longer display paused jobs as active preparation. Both cancellation controls immediately refresh progress; pending cancellation says “Cancelling…”.
- Selection mode displays a highlighted “Done selecting” action. Shared native checkboxes use a full 44-pixel target, themed borders and keyboard focus indicators. The sort control uses the shared pill shape.
- Entering Saved clears inherited folder/search filters. Browser regressions check a persisted like through refresh and section navigation. This fixes filter-induced disappearance; it does not establish that every reported real-library disappearance has the same cause.

These changes remain subject to user review. Stages 4–5 are not marked accepted by this verification record.

Follow-up validation: `dotnet build` passes without warnings; `dotnet test --no-build` passes 38 tests with one Unix-only skip. `npm run build`, `npm test` (5 tests) and `npm run lint` pass on Node 24.21.0. `npx playwright test` passes 20 applicable desktop/mobile cases, with two mobile-only cases skipped on desktop. An intermediate run incorrectly looked for the desktop-only sort control on mobile; that assertion was corrected. Final screenshots include red/blue themed galleries and selection on both screen sizes and were visually inspected.

The September 16 feedback pass implements:

- Right-anchored mobile search that expands from its icon and changes the icon to a cross; pill-shaped desktop search.
- Hidden horizontal scrollbars on folder and breadcrumb strips while retaining touch scrolling and keyboard access.
- Generated thumbnail covers on library cards and folder links, including nested-folder media.
- A Radix confirmation explaining rescan disk/CPU cost before posting a scan request, plus visible mobile scan/preparation progress and on-demand counters.
- Independent theme previews for Dark, White, Catppuccin, Orange/Black and Red/White. Light themes use native light form controls; orange uses neutral deep-black surfaces.
- Scrollable theme settings that remain clear of the fixed mobile navigation.

## Validation

Backend: `dotnet build` passes without warnings; `dotnet test --no-build` passes 38 tests, with the Unix-only symlink test skipped on Windows. The cover regression checks nested descendants, unprepared media, current revisions, missing records and operation with original folders offline.

Frontend: `npm test` passes 5 tests; `npm run build` and `npm run lint` pass. FNM was initialized directly without loading a PowerShell profile, and the production build and browser suite were checked using Node 24.21.0.

Browser: `npx playwright test` passes all 12 applicable desktop/mobile tests; two mobile-specific tests are skipped in the desktop project. Tests verify loaded covers, search focus/open/close and right anchoring, theme switching and settings scroll bounds, confirmation before any rescan POST, visible scan progress, filter containment, viewer focus restoration, tag editing and bounded virtualization.

Rendered library, search, scan-progress and theme screenshots under `src/Luma.Web/test-results/` were visually inspected after the final changes. These use synthetic media; they do not establish Raspberry Pi processing throughput or replace real-library user review. Native video playback remains the separate stage 6 deliverable.
