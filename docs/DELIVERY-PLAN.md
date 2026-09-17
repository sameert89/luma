# Luma delivery plan

Status: stages 1–6 are functionally implemented and Gate 6 is user-tested and accepted. The user accepted the stages 4–5 UI gate on 2026-09-17; the idle-folder discovery follow-up is recorded in [the handoff](STAGE-6-HANDOFF.md). Target-hardware measurements remain release checks and are not implied by functional acceptance. [Gate 7](GATE-7.md) is planned to close all remaining audit findings, missing features, bugs, and release validation.

This plan sequences the requirements in [PRODUCT.md](PRODUCT.md) within the constraints of [ARCHITECTURE.md](../ARCHITECTURE.md) and [AGENTS.md](../AGENTS.md). It does not replace those contracts. Deferring a feature to a later stage does not remove it from the intended initial product.

## Starting point

At planning time the repository contained architecture, product, and contributor instructions, with no application code, database schema, build configuration, or test infrastructure. Stages 1 and 2 now provide the contracts and application foundation described below.

`README.md` and `docs/API.md` were empty when this plan was prepared. `docs/PERFORMANCE.md` identifies the Raspberry Pi 5 with 4 GB RAM, Debian 13, USB 3 storage, and a current library of approximately 100,000 images and 20,000 videos, but does not yet define measurable performance budgets.

The previously missing indexing, tagging, and media-cache contracts now exist. The empty `docs/adrs/` directory was replaced by `docs/adr/` with the foundation decision.

## Delivery approach

Deliver working vertical slices, with large-library browsing performance taking priority over feature breadth. Use one ASP.NET Core application, SQLite with Dapper, generated cache files, and a React frontend. Background processing runs within the application with configured concurrency limits.

Already-indexed gallery and search requests must use only SQLite and generated cache files. They must never enumerate media directories, stat originals, extract metadata, invoke media-processing tools, or decode original images. Explicit original viewing, downloading, and video streaming may access source media as allowed by the architecture.

Stages are ordered by dependency, not calendar estimates. A stage is complete only when its deliverables and exit criteria are satisfied and verification results are recorded. If a criterion cannot be met, record the limitation and resolve it before treating the stage as complete.

| Stage | Delivery | Depends on | Result |
| --- | --- | --- | --- |
| 1 | Core contracts and performance budgets | Existing documents | Implementation decisions are explicit |
| 2 | Application foundation | Stage 1 | Buildable, tested application skeleton |
| 3 | Indexing and generated cache | Stage 2 | A resumable, bounded media pipeline |
| 4 | First usable browsing release | Stage 3 | Folder-to-gallery-to-preview workflow |
| 5 | Search, tags, and preferences | Stage 4 | Searchable and editable library |
| 6 | Video and reels experience | Stage 5 | Complete primary viewing modes |
| 7 | Remaining product scope and deployment | Stage 6 | Initial release validated on target hardware |

## Stage 1 — Define core contracts

Completed 2026-09-15. Contracts: [API](API.md), [indexing](INDEXING.md), [tagging](TAGGING.md), [cache](MEDIA-CACHE.md), [performance targets and procedure](PERFORMANCE.md), and [foundation ADR](adr/0001-foundation.md). Query/index strategies are candidates to validate in their feature stages; no target-hardware results are claimed.

### Deliverables

- Populate `docs/API.md` with endpoint behavior, common errors, page limits, opaque cursors, and the shared query contract.
- Create `docs/INDEXING.md`, `docs/TAGGING.md`, and `docs/MEDIA-CACHE.md`.
- Extend `docs/PERFORMANCE.md` with numerical budgets and a reproducible measurement procedure.
- Resolve the ADR directory naming mismatch and record architectural decisions where needed.
- Define the initial supported media formats and the behavior for unsupported or corrupt files.

### Decisions to settle

- Media identity and scan reconciliation: moves, renames, replacements, missing files, interrupted scans, unavailable roots, and retry behavior. Incomplete scans must not cause unseen records to be treated as deleted.
- Folder navigation: direct children versus recursive results, multiple library roots, and the meaning of grouping and custom gallery covers.
- Query semantics: filters, tag combination rules, supported sorts, stable tie-breakers, null dates, forward/backward navigation, and mutations between pages. Include all product filters in the contract even when their implementation is staged.
- Shuffle and random selection: define repeatability, cursor behavior, filtering, and acceptable selection bias. Do not assume a full-result random sort will meet the performance budget.
- Cache lifecycle: variants, versioning, invalidation, disk usage, atomic publication, missing/corrupt entries, and background regeneration. A cache miss must not trigger original processing within a browse request.
- Tag normalization: case-insensitive uniqueness, Unicode behavior, bulk operation limits, and import/export merge semantics.
- Public paths: normal media responses use IDs; explicitly document the product-required full-path dislike export as a separate operation.
- Resource limits: queue capacity, worker concurrency, cancellation, and backpressure on low-end hardware.

### Exit criteria

- Contracts describe normal operation, recovery, and relevant error cases without contradicting the architecture.
- Performance budgets cover gallery/search latency, sustained browser memory, scrolling, server memory, and resource use during concurrent indexing and browsing.
- Each planned sort/filter has a candidate query and indexing strategy. Experimental results may refine these during implementation.

## Stage 2 — Scaffold the application

Completed 2026-09-15. The .NET/SQLite server, generated OpenAPI/TypeScript contracts, React application shell, Tailwind tokens/shared controls, Radix Dialog, unit/integration/browser tests and CI are implemented. See [README](../README.md) for commands and [verification](STAGES-1-2-VERIFICATION.md) for results. Only `/api/status` and development OpenAPI are implemented; media features remain in later stages.

### Deliverables

- Create the .NET 10 ASP.NET Core server and React/TypeScript/Vite frontend.
- Add SQLite connection setup and versioned migrations; keep explicit SQL alongside the feature that owns it.
- Establish generated frontend API types and the common server error contract.
- Add backend and frontend test infrastructure and CI build/test checks.
- Establish Tailwind design tokens, shared controls, approved Radix primitives, accessibility linting, and the application shell.
- Document local configuration and development commands.

### Exit criteria

- Backend and frontend build from a clean checkout and their initial tests pass.
- The frontend can call the server using generated contracts.
- Database initialization and migration execution work against a fresh database.
- Shared controls provide keyboard operation, accessible names, and visible focus.

## Stage 3 — Build indexing and generated cache

### Deliverables

- Configure media roots and persist indexed media, metadata, scan state, and processing failures.
- Implement initial and incremental scans with bounded queues and configurable worker counts.
- Generate image thumbnails/previews and video posters independently of browse requests.
- Support interruption recovery, retries, and cache invalidation according to stage 1 contracts.
- Expose basic scan progress and failures so the pipeline can be operated and diagnosed.

### Exit criteria

- A representative mixed library indexes successfully with originals mounted read-only.
- A corrupt or unsupported file does not terminate the scan.
- Restarting an interrupted scan converges without duplicate media records or lost application state.
- Incremental scans handle additions, changes, and missing media according to the documented identity policy.
- Workers, queues, and external media processes remain within configured bounds; cancellation stops work cleanly.
- Missing or corrupt generated files can be recovered through background processing.

## Stage 4 — Deliver the first usable browsing release

### Deliverables

- Implement database-backed library/folder navigation and a first deterministic cursor-paginated sort.
- Build a responsive virtualized gallery with lazy thumbnail loading and clear video indicators.
- Add cached image previews, previous/next navigation, and restoration of query and scroll position when closing the viewer.
- Provide loading, empty, unavailable-cache, and error states with keyboard-accessible navigation.

### Exit criteria

- The complete workflow works: configure a folder → index → browse thumbnails → open a preview → return to the same browsing position.
- With generated cache intact and source media unavailable, indexed gallery, folder navigation, and cached preview browsing continue to work.
- Automated checks verify that browse requests do not call source-filesystem or media-processing operations.
- Deep pagination has deterministic ordering on a fixed dataset without missing or duplicate items.
- DOM size and retained frontend query data remain bounded during long browsing sessions.
- Browse performance meets stage 1 budgets on the current-library dataset, including while indexing runs.

This is the first usable milestone, not the complete initial product release.

## Stage 5 — Add search, tagging, and preferences

### Deliverables

- Implement query state shared by gallery and its viewer, and reusable query/filter semantics for Reels with mode-specific state.
- Add the product's initial searches and filters: keyword/name/path, library, tags, dates, media type, extension, starts/ends with, size, orientation, dimensions, aspect ratio, tagged/untagged, and liked/disliked state.
- Add tag autocomplete, creation, removal, and fast editing from the viewer.
- Add dedicated bounded server-side bulk tag operations and gallery selection.
- Persist likes/favourites and dislikes in SQLite without modifying originals.

### Exit criteria

- Gallery and viewer preserve identical query/filter semantics and navigation order.
- Case variants resolve to one logical tag according to the normalization contract.
- Bulk changes avoid one HTTP request or database query per media item and honor documented limits and transaction behavior.
- Query plans and representative common/selective filter combinations are checked against suitable indexes and performance budgets.
- Tag editing works with keyboard-only interaction and on mobile.
- Domain behavior and mutation edge cases have tests.

## Stage 6 — Complete video and reels experiences

Functional implementation delivered and user-tested/accepted 2026-09-17. See [implementation and verification](STAGE-6-VERIFICATION.md). Outstanding target-client and Raspberry Pi measurements are tracked as Gate 7 release checks. Gallery/Reels state synchronization, configurable auto-scroll timing, and the full normal-player control set in Reels are not acceptance requirements.

### Deliverables

- Add native browser video playback, range-capable streaming, and external-player access for unsupported browser formats.
- Complete viewer controls: fit/fill, actual-size images, zoom/pan, visual rotation, fullscreen, metadata, original access, and video playback controls.
- Add Reels using the same applicable query/filter semantics with mode-specific state, vertical navigation, bounded nearby-item preloading, mute, an on/off auto-scroll toggle, and optional visible tags. Full playback controls apply to the normal video viewer.
- Document keyboard shortcuts in application help and complete mobile interactions.

### Exit criteria

- Supported videos play and seek correctly; unsupported formats offer the documented external-player workflow.
- Only active/nearby reels media are mounted or preloaded, and inactive video playback stops.
- Gallery and Reels use consistent applicable filter/sort semantics; switching modes may change selected values and reset library/folder scope. Their state does not need to be synchronized.
- Browser autoplay restrictions and failed playback produce usable controls and states.
- Viewer and reels remain responsive on mobile and meet client resource budgets.
- No automatic original transcoding is introduced.

## Stage 7 — Complete initial product scope and deployment

Current status: product implementation delivered for staging on 2026-09-17. [Verification](STAGE-7-VERIFICATION.md) records passing local checks and synthetic evidence; [handoff](STAGE-7-HANDOFF.md) records deployment and remaining acceptance work. Raspberry Pi, real-library indexing and real-device long-session requirements remain open.

The authoritative completion checklist is [Gate 7](GATE-7.md), based on the [product implementation audit](PRODUCT-IMPLEMENTATION-AUDIT.md) and the user's clarified requirements. This gate includes all unresolved findings and bugs, not only new Stage 7 features.

### Deliverables

- Complete remaining sorts, grouping, stable shuffle, custom gallery covers, and the filtered random-image content endpoint.
- Close existing workflow gaps: child-folder pagination, mobile sort access, library-scoped search, advanced filter choices, normal video viewer audio controls, keyboard Reels seeking, photo/mixed-media Reels selection, and the Collections destination.
- Verify the already-delivered themes through shared tokens: Dark, White, Catppuccin, Orange & Black, and Red & White.
- Add explicit metadata tag import, XMP-only export with merge instructions, and full-path disliked-media list export. Exports do not delete or rewrite originals.
- Validate the existing Docker packaging and bundled media tools on the target deployment, with read-only `/media` and persistent `/data` mounts.
- Document installation, configuration, upgrade/migration handling, consistent database backup and restore, cache regeneration, and failure recovery.
- Validate the complete initial product requirements and record any unresolved release blockers.
- Repair stale browser-test selectors and complete the full desktop/mobile browser suite.

### Exit criteria

- Remaining product workflows meet their functional contracts and relevant performance budgets.
- Shuffle and random endpoints are measured with broad and selective filters on large datasets.
- The container runs on the target Raspberry Pi 5 with 4 GB RAM and the documented Debian/storage configuration.
- The current 120,000-item library is usable during background indexing without exceeding resource budgets.
- Restart, backup/restore, cache loss, and unavailable-source scenarios are verified.
- Backend/frontend builds and tests pass; keyboard and mobile workflows have been reviewed.

## Proposed source layout

Create directories as their functionality is implemented; do not prebuild unused abstractions.

```text
Luma/
├── src/
│   ├── Luma.Server/
│   │   ├── Features/
│   │   │   ├── Libraries/
│   │   │   ├── Indexing/
│   │   │   ├── Media/
│   │   │   └── Tags/
│   │   ├── Data/
│   │   │   └── Migrations/
│   │   └── MediaProcessing/
│   └── Luma.Web/
│       └── src/
│           ├── app/
│           ├── components/ui/
│           ├── features/
│           └── lib/api/
├── tests/
│   └── Luma.Server.Tests/
├── docs/
│   └── adr/
└── deploy/
```

Frontend tests should live alongside their features. Shared connection and migration setup belongs in `Data`; feature SQL stays with its feature. Do not introduce generic repositories or separate domain/service projects without a concrete need.

## Verification and progress tracking

- Use a small mixed-media fixture for functional and recovery checks, the current 120,000-item library for real workload validation, and a synthetic million-record database for query scaling. Synthetic database results do not substitute for actual media-processing or hardware measurements.
- Record dataset size, hardware, cache conditions, concurrent background work, latency percentiles, and memory peaks with performance results.
- Test domain behavior and practical bug regressions. Verify database queries for indexes and N+1 behavior, and frontend flows for bounded rendering and data retention.
- For each implementation delivery, build the backend, run backend tests, build the frontend, and run frontend tests. Record exact commands and failures. Until projects exist, these checks are unavailable.
- Update this document as stages complete, linking implementation and verification evidence. Keep incomplete criteria visible rather than marking partial stages complete.

## Scope boundaries

The initial release does not include cloud synchronization, facial/object recognition, AI search, duplicate detection, automatic albums, media editing, collaborative sharing, clustering, or complex authorization. Authentication is deferred under the existing local/private-network product contract.

Do not add external infrastructure services, unbounded workers, request-time original processing, or automatic original transcoding to satisfy a delivery stage. If a requirement cannot meet the architecture or agreed performance budgets, document the conflict before changing the design.
