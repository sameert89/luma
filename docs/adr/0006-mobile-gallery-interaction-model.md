# ADR 0006: Media-first mobile gallery interaction

Status: accepted, stage 4 and 5 feedback follow-up.

## Context

Mobile feedback showed the library header, breadcrumb and scan counters taking most of the viewport, filters overflowing in two columns, and media details competing with the asset being viewed. The application must remain efficient for very large collections and low-end hardware.

## Decision

- The mobile shell has five persistent destinations: Library, Reels, Search, Collections and Settings. It uses a compact top search bar and fixed bottom navigation.
- Gallery status and scan controls are disclosed on demand. They are not part of the normal gallery viewport.
- Filter controls use a one-column mobile sheet and two columns only from the small desktop breakpoint upward.
- The viewer is a full viewport media surface. Its actions are overlays; metadata, preferences and tag editing are in a separate accessible details sheet.
- Collection results remain cursor-paginated and virtualized. The browser never receives a complete folder tree or complete media metadata set merely to render navigation.
- Mobile search is anchored on the right. Its field expands from the search button over 180 ms, and that button changes to a cross. Reduced-motion preferences disable the reveal animation. Desktop search uses the same pill input.
- Album covers are selected in the existing summary queries from SQLite's processed-media, folder-ancestry and ready-cache indexes. A partial album-cover index excludes pending discovery records. Covers only use current-revision generated thumbnails; no request-time original access or per-card API query is added.
- Every rescan action first explains the full-library disk and CPU cost in a Radix dialog. A compact progress button remains visible in mobile browsing and opens detailed scan counters.
- Theme previews have their own scoped design tokens. White and Red/White are light themes with native light controls; Orange/Black uses neutral black surfaces and orange accents. Dark and Catppuccin use dark controls.

## Consequences

The UI keeps browsing responsive and preserves screen area for media. It uses the existing React, Radix and Tailwind stack, with no new client cache, service, worker process or infrastructure dependency.

The decision follows useful lessons from other gallery products without copying their deployment model: Aves connects albums, photos and tags in a single browsing flow; PiGallery2's own discussion identifies the cost of directory-first client filtering for very large libraries; Immich separates visible job state and bounded worker throughput. PiGallery2's [CoverManager](https://github.com/bpatrik/pigallery2/blob/master/src/backend/model/database/CoverManager.ts) selects a media item inside a directory or its descendants, and its directory component displays that item's thumbnail. Luma uses ready cached descendants and avoids whole-subtree sorting. Luma retains its SQLite-only, cache-first architecture and does not introduce Immich-style services or queues.
