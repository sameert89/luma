# Stage 8 — v1.0.2

Requested 2026-09-19. E2E tests are explicitly excluded from this delivery; backend/frontend builds and unit/integration tests remain required.

## Requirements

- Make folder names follow the visible sort direction with indexed cursor pagination; explicitly distinguish media-only date/type/size/shuffle sorts.
- Group browsing by tags, with each tag a section or collection, retaining bounded rendering and pagination.
- Expose configurable Random API URLs in Settings using visible tags, folders, media type and other supported filters.
- Show loading states until media, folder scope and indexing status resolve; show an empty state only after a successful zero-result response and final indexing refresh.
- Keep gallery actions including slideshow inside the three-dot menu. Make active filters compact, with a persistent Show/Hide preference and a hidden horizontal scrollbar. Keep Settings theme/appearance/help widths and card columns aligned.
- Remove the redundant first Results control in metadata import menus and report processed, metadata found, imported/updated, skipped and failed counts accurately.
- Offer index only, index + embedded metadata (default), and index + embedded metadata + adjacent XMP choices. Extraction is a durable asynchronous stage outside indexing transactions, resumes unfinished files, merges idempotently, and skips unchanged source/XMP revisions.
- Retain manual folder and per-file import/re-import for repair and overrides.
- Replace the existing indexing indicator panel with the global task queue; do not add a separate Tasks button. Show queued, running, completed, cancelled and failed operations with counts, cancel actions and explicit Queue again actions. Queue again creates a new task; the stopped one stays terminal. Provide Clear finished to persistently dismiss terminal entries while retaining active work and indexing history.
- Prioritize viewport preview work and interactive browsing over bounded background extraction.
- Diagnose and fix gallery scroll locking, including modal lifecycle and gesture handling.
- Gallery, Reels and Random share explicit query filters. Folder/tag/search scope is visible; reset clears scope to the root. View in Reels carries visible filters and starts at the selected item.
- Provide granular video volume controls. Only the normal video player supports right-side vertical volume swipes with temporary feedback; Reels keeps vertical navigation.
- Persist shared per-video progress in SQLite across sessions/devices on the same instance. Offer Resume from time / Start from beginning. Represent unwatched, in progress and completed on thumbnails; accidental playback must not complete a video.
- Provide two-finger image pinch zoom, bounded panning, double-tap zoom at the tapped region and double-tap reset. Zoomed panning must not navigate.

## Acceptance

Domain behavior and practical regressions are tested. Browse requests remain SQLite/cache-only. No original writes, transcoding, external infrastructure or unbounded processing. Hardware/device performance and gesture acceptance require real-device review.

## Implementation

Functional implementation delivered locally for v1.0.2. [ADR 0009](adr/0009-stage8-metadata-and-playback.md) records durable metadata stages, shared processing limits, shared filters and instance-wide video history. Migration 0013 persists metadata counters/checkpoints/revisions, scan modes and watch progress. Migration 0014 adds the folder name-sort index. Migration 0015 persists dismissed task-queue entries. Generated OpenAPI and TypeScript contracts have been refreshed.

Tag grouping is a paginated collection browser: a multi-tag item belongs to each matching collection, and opening one uses the virtualized cursor gallery. Random URL generation uses the existing photos/GIF-preview content endpoint and current visible filters; video content is still unsupported by that endpoint's contract. Initial indexing offers all three modes. Manual folder and file import remains available, including Reels details. Tasks appear immediately while an enqueue request is pending, in the existing indexing indicator panel. Each operation shows its scope and supports cancellation and explicit requeue; cancelled imports retain their checkpoints and counts. The separate Tasks button is removed.

Dialogs now unmount closed overlays/content immediately, releasing Radix interaction/scroll locks without awaiting exit animations. Gallery flex sizing constrains the scroll viewport. Touch navigation is handled once through pointer events, and volume/pinch/pan gestures suppress navigation appropriately. Open viewer/reel IDs are included in the UI URL and restored on refresh.

[Verification](STAGE-8-VERIFICATION.md) records local builds and unit/integration checks. The intermittent freeze has regression coverage for repeated/nested modal locks and refresh restoration, but its absence over a real-device long session is not yet established. Device pinch/volume behavior and Raspberry Pi performance remain user/hardware acceptance checks. E2E tests were deliberately not run.

Settings follow-up: Theme & appearance, Random media URL and Metadata exchange use matching section-heading typography and widths. Theme previews are compact and display two per row on small screens. Installation guidance remains in README/deployment documentation, with no installation panel in Settings. The task queue keeps its Clear finished toolbar visible while scrolling. Cancelled HTTP browse requests that surface SQLite SQLITE_INTERRUPT are handled as request cancellation; uncancelled database errors and bounded-query timeouts retain their error behavior.
