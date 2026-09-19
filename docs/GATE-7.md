# Gate 7 — Close remaining product findings and validate release

Status: staging implementation delivered; release acceptance open. See [verification](STAGE-7-VERIFICATION.md) and [handoff](STAGE-7-HANDOFF.md). Requested by the user on 2026-09-17 after accepting and testing Gate 6. This gate must fix all remaining findings, missing features, and bugs from the [product implementation audit](PRODUCT-IMPLEMENTATION-AUDIT.md), and satisfy the Stage 7 release criteria in [DELIVERY-PLAN.md](DELIVERY-PLAN.md).

## Accepted requirements

- Gallery and Reels use the same applicable filter definitions and server query semantics, with mode-specific selected state. Mode switching may reset library/folder scope and default Reels to videos; synchronization or preservation across modes is not required. Navigation within each mode follows its active query.
- Reels auto-scroll is an on/off toggle. Enabled videos advance at the end; no user-configurable interval is required. Photo/mixed-media selection remains in product scope, and images may use a fixed dwell time.
- The normal video player requires play/pause, seek, volume, mute, fullscreen, playback speed, fit/fill where practical, navigation, tags, and metadata. Reels requires its compact navigation/mute/auto-scroll/filter/tag controls, not the full normal-player controls or browser-native chrome. Optional controls must still be accessible.
- All requested themes, automatic covers, and initial Docker packaging are already delivered. Validate these; do not rebuild them as missing features.

## Completion checklist

### Existing workflows and bugs

- [x] Make all direct child folders reachable beyond the first 48 using bounded paginated loading/navigation.
- [x] Expose sorting on mobile as well as desktop, and keep applicable sort controls available in search and Reels.
- [x] Add explicit library selection to search/filters without unexpectedly discarding the search being scoped.
- [x] Expose supported all/any tag matching and present/missing/all availability choices in the advanced filters.
- [x] Add volume adjustment and mute/unmute to the normal video viewer.
- [x] Make the existing Reels seek control usable with keyboard interaction and an accessible seek value.
- [x] Enable photo, video, and mixed-media selection in Reels. Keep the video default and intentional mode-specific scope behavior; selecting Photos must not be overridden by hard-coded video-only requests.
- [x] Complete Collections as the requested entry point to folders/albums, tags, and favourites, using existing library folders as albums. Do not introduce speculative user-created album management. (The library-listing section was removed in [Gate 7 feedback, round 2](GATE-7-FEEDBACK-2.md) as redundant with the Library tab it duplicated; Collections now holds favourites and tags.)
- [x] Repair stale library-card selectors in browser setup and any further regressions exposed by the full desktop/mobile suite.

### Remaining product features

- [x] Implement captured/effective-date, name, type, and size sorts alongside modified-date ordering, with stable tie-breakers, opaque cursors, and matching viewer/Reels navigation.
- [x] Implement folder/date/type grouping with bounded rendering and correct handling of page-boundary headers.
- [x] Implement seeded stable shuffle using the documented random-key/pivot/wrap strategy, including filtered traversal and grouping behavior.
- [x] Implement user-selected library/folder gallery covers, persistence, reset to automatic covers, validation, and fallback for stale selections.
- [x] Implement `GET /api/random` returning cached image content with applicable search filters and documented empty/error behavior.
- [x] Implement explicit bounded EXIF/XMP and optional-sidecar tag import, normalized union merging, per-item reporting, and idempotent retry.
- [x] Implement XMP-only downloadable export archives, media-ID filenames, relative-path manifests, snapshot semantics, and external merge instructions.
- [x] Implement explicit full-path disliked-media JSON Lines export, including missing records, without accessing or deleting originals.

### Deployment, documentation, and release evidence

- [x] Document concrete Docker-volume installation, upgrades/migrations, consistent database backup/restore, cache regeneration, and failure recovery.
- [ ] Validate the existing container on Raspberry Pi 5 with 4 GB RAM, Debian 13, ARM64, and the documented storage/mount configuration.
- [x] Validate the delivered themes and cached automatic covers across gallery, viewer, Reels, and search on desktop/mobile.
- [ ] Validate restart, upgrade, backup/restore, cache loss, and unavailable-source behavior on the target deployment.
- [x] Measure remaining sorts/grouping/shuffle/random with broad and selective filters on large datasets, including query plans and deterministic cursor traversal.
- [ ] Record real 120,000-item workload performance during browsing and concurrent initial/incremental indexing against PERFORMANCE.md.
- [ ] Record desktop/mobile long-session frame, memory, DOM/data-retention, and relevant real-device codec results. Link any existing user measurements instead of assuming results from functional acceptance.
- [x] Update current product/API/delivery/handoff documentation, preserve historical verification records, and publish Gate 7 implementation/verification evidence and unresolved blockers.

## Exit criteria

All checklist items must be implemented or verified with linked evidence; accepted clarifications above are not reopened as defects. Remaining release blockers must stay explicit, and the gate cannot be marked complete while required items remain unresolved.

Domain changes and practical bug fixes must have appropriate tests. Complete backend build/tests, frontend build/tests, lint, generated-contract drift checks where contracts change, and the full desktop/mobile browser suite. Record exact commands, failures, corrections, and final results in `STAGE-7-VERIFICATION.md` when implementation is delivered. Review keyboard-only and mobile workflows.

Already-indexed browsing/search continues to use SQLite and generated cache only. Use migrations, explicit indexed SQL, cursor pagination, bounded jobs/concurrency, generated frontend contracts, shared design tokens/components, and approved accessible primitives. Preserve originals; do not introduce automatic transcoding or external infrastructure. New APIs must follow existing documented contracts; breaking existing endpoint semantics requires explicit approval.

The checked product items are delivered for staging with linked local evidence. Unchecked target-hardware and release measurements remain required; the gate is not marked complete.
