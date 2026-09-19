# Product implementation audit

Historical pre-Gate-7 audit. The staging implementation now addresses these functional findings; current results and outstanding release measurements are recorded in [Stage 7 verification](STAGE-7-VERIFICATION.md).

Reviewed 2026-09-17 against PRODUCT.md, DELIVERY-PLAN.md, API.md, TAGGING.md, INDEXING.md, MEDIA-CACHE.md, PERFORMANCE.md, the implementation, and existing verification records.

Gate 6 is treated as implemented and user-tested, as reported by the user. This audit does not reopen that acceptance. Where accepted behavior differs from the written product contract, the difference is recorded separately so it can be resolved deliberately. Hardware measurements are not inferred from functional acceptance.

The user subsequently clarified the requirements: Gallery/Reels share applicable filter semantics, not synchronized selected state; auto-scroll is a simple toggle; full playback controls apply only to the normal video viewer. PRODUCT.md and DELIVERY-PLAN.md now reflect these decisions. All remaining findings are assigned to [Gate 7](GATE-7.md).

## Features still missing

| Feature | Current implementation and remaining work | Evidence |
| --- | --- | --- |
| Remaining deterministic sorts | Only modified-date ordering, ascending/descending, is implemented. Add captured/effective date, name, media type, and size sorts with stable ID tie-breakers, cursor support, matching viewer/reels navigation, and measured indexes. | `src/Luma.Server/Features/Media/MediaQuery.cs`, `MediaBrowser.cs`; `src/Luma.Web/src/app/App.tsx` |
| Grouping | `groupBy` exists in the query shape but only `none` is accepted. Folder/date/type group ordering, headers, and page-boundary handling are absent. | `MediaQuery.Normalize`; `src/Luma.Web/src/features/browse/Gallery.tsx` |
| Stable shuffle | No seed parameter, random-key migration, shuffle query/cursors, or shuffle control. | `MediaQuery.cs`, `CursorSigner.cs`, `Data/Migrations/` |
| Custom gallery covers | Automatic library/folder covers exist. User-selected covers, persistence, selection/reset controls, and invalid-selection fallback remain missing. | `docs/API-COVERS.md`; `src/Luma.Server/Features/Libraries/LibraryBrowser.cs` |
| Filtered random-image content API | `/api/random` is absent. It must return image content, apply applicable shared filters, select cache-ready images, and avoid full-result random sorting or request-time original processing. | `src/Luma.Server/Features/Media/MediaEndpoints.cs`; `docs/API.md` |
| Explicit metadata tag import | No embedded EXIF/XMP/optional-sidecar keyword import workflow or background import jobs. Ordinary media metadata extraction does not implement this tag import. Add normalized union merging, bounded work, per-item invalid-tag reporting, and idempotent retry. | `docs/TAGGING.md`; `src/Luma.Server/Features/Tags/TagService.cs`, `MediaProcessing/MediaProcessor.cs` |
| XMP-only tag export | No downloadable XMP archive, media-ID filenames, relative-path manifest, snapshot handling, or external merge instructions. | `docs/TAGGING.md`; `MediaEndpoints.cs` |
| Disliked-media full-path export | Likes/dislikes and filtering exist, but no explicit UTF-8 JSON Lines export of disliked IDs, configured full paths, and presence state, including missing media. | `docs/TAGGING.md`; `MediaEndpoints.cs` |

These are implementation gaps, rather than merely missing acceptance measurements. They make up the bulk of remaining Stage 7 product scope.

## Partial workflows and product-contract differences

| Workflow | Gap | Evidence / interpretation |
| --- | --- | --- |
| Large folder collections | The API paginates child folders, but the frontend requests 48 and never advances `folderCursor`. More than 48 direct child folders cannot be reached through folder cards. Add bounded folder traversal controls or incremental loading. | `App.tsx`: folder query, `folderCards`, and all `setFolderCursor` calls; `LibraryBrowser.FoldersAsync` |
| Mobile sorting | The only sort control is hidden below `sm`; the filter sheet has no sort/order alternative. Mobile users cannot select even the existing oldest/newest ordering. | `App.tsx`: `Sort media` select; `FilterForm.tsx` |
| Library-scoped search | The server accepts `libraryId` and library/folder navigation can establish scope, but the search/filter sheet has no explicit library selector. Choosing a library from navigation resets the current search/filter state. | `App.tsx`: `visitLibrary`; `FilterForm.tsx` |
| Advanced query choices | Server-side `tagMode=any/all` and `availability=present/missing/all` exist, but the filter UI exposes neither. These are API/UI completeness differences; availability is not a separate initial PRODUCT.md filter requirement. | `MediaQuery.cs`; `FilterForm.tsx` |
| Photo and mixed-media Reels | Reels always forces `mediaType=video`; choosing Photos in filters cannot enable photo Reels. Image-rendering support exists in the shared stage and tests, but the actual app route excludes it. | `Reels.tsx`: `queryFilters`; `App.tsx`: Reels props |
| Normal video viewer audio | Play/pause, seek, speed, fit/fill, fullscreen, and original streaming exist. Volume adjustment and mute/unmute do not exist in the normal viewer. Native controls are disabled. Reels has its own mute toggle. | `MediaStage.tsx`: video and options controls; `Viewer.tsx` |
| Keyboard seeking in Reels | The seek bar is a button whose handler calculates time from click coordinates. It has no keyboard range/step implementation, so it does not provide usable keyboard seeking. Use an accessible seek control consistent with the shared design system. | `MediaStage.tsx`: `seekFromBar`, `Seek video` button |
| Collections destination | The product contract describes Collections as albums, folders, tags, and favourites. The destination is currently labelled Saved and renders only liked media. Folder and tag workflows exist elsewhere; a consolidated Collections destination is incomplete against that contract. User-created albums are not sufficiently specified to assume a new album-management feature. | `PRODUCT.md`: primary destinations; `App.tsx`: `collections`, `galleryFilters` |

Passing current tests does not establish completeness for these workflows; the findings above come from tracing reachable UI behavior and supported server parameters.

Resolved requirement findings: Gallery/Reels query preservation is not required; the same applicable filter semantics with mode-specific selected state is intentional. The existing auto-scroll toggle satisfies the requirement; configurable timing is not required. Reels does not need the normal player's full/native control set. Normal viewer audio controls and accessibility of the existing Reels seek control remain actionable findings. Photo/mixed-media selection remains a separate written requirement and is not removed by these clarifications.

## Existing product coverage

| Product area | Status |
| --- | --- |
| Libraries-only home, multiple configured roots, folder navigation | Implemented, subject to child-folder pagination gap above. Library configuration is server-side; a UI library manager is not an explicit initial requirement. |
| Explicit initial scans, confirmed rescans, folder-demand discovery, progress/cancel/retry support | Implemented. Detailed operation/retry endpoints and configuration are documented in README.md. |
| Bounded indexing, incremental reconciliation, interruption recovery, corrupt-file isolation | Implemented with backend tests and small read-only Linux fixture evidence; full target-library throughput is separate acceptance work. |
| Generated thumbnails, image previews, video posters, cache verification/regeneration/quota handling | Implemented. Automatic cached descendant covers are also implemented. |
| Cache/database-backed indexed browse | Implemented with original-unavailable regression coverage; no new architecture work is required merely to complete the missing features. |
| Responsive virtualized mixed-media gallery, lazy images, video indicators, bounded retained pages | Implemented. Query data is capped at five 60-item pages; long-session resource measurements remain separate. |
| Keyword/path/prefix/suffix, library/folder, tags, dates, type/extensions, size, orientation, dimensions/aspect, tagged state, preference filters | Implemented on the server; UI scope/tag-mode gaps are listed above. Search within a folder enables recursive results by default when submitting a keyword. |
| Tag normalization, autocomplete, create/add/remove, viewer editing, Enter submission | Implemented. Multiple assignments are supported through repeated editing. |
| Selected-media bulk tag add/remove | Implemented with a dedicated atomic bounded endpoint, up to 500 media; no per-media HTTP loop. |
| Like/favourite, dislike, preference filters, Saved/Favourites destination | Implemented. Saved is a favourites view; custom user collections are not separately defined as an initial deliverable. |
| Image viewer previous/next, cached preview, fit/fill, actual size/original access, zoom/pan, visual rotation, fullscreen, metadata/tags | Implemented. Navigation, touch gestures, Back handling, focus and scroll restoration have existing coverage. |
| Browser video decoding, range streaming, external-player handoff, autoplay/error handling | Implemented. Missing normal-viewer audio controls are listed above. No automatic transcoding is needed. |
| Reels vertical navigation, active playback cleanup, bounded nearby preload, mute, simple auto-scroll toggle, optional tags/editor | Implemented and user-tested. Mode-specific selected query state is accepted; photo/mixed-media selection remains listed above. |
| Required themes, reusable tokens, local font, shared icons | Implemented: Dark, White, Catppuccin, Orange & Black, Red & White, plus Cinema, Midnight, OLED and Forest. Theme selection persists locally. |
| Mobile bottom navigation, filter sheets, viewer swipes, pinch/pan, Back stack | Implemented; mobile sort access is incomplete. |
| Application shortcut/gesture/external-player help | Implemented in Settings. |
| Preservation of originals and read-only media support | Implemented. Metadata export and dislike export still need implementation as explicit operations. |
| Docker single-service packaging, bundled FFmpeg, read-only `/media`, persistent `/data` | Implemented in root Dockerfile/compose.yaml. Stage 7 should not treat initial packaging as missing. |
| Installation/configuration and basic migration/backup/restore/cache recovery guidance | Present in README.md. Remaining work is a concrete Docker-volume upgrade/backup/restore/recovery procedure and target-environment validation, rather than documentation from scratch. |

## Remaining release validation and documentation

- Validate Docker on Raspberry Pi 5 / Debian 13 / ARM64 with the documented storage and read-only mounts. Existing packaging alone does not prove target deployment.
- Record 120,000-item real-library browse/search/bulk-edit latency and memory, including concurrent initial/incremental indexing, CPU, disk I/O, and idle-resource budgets. Existing local synthetic results do not substitute for this.
- Measure new sorts/grouping/shuffle/random under broad and selective filters on large datasets, check indexes, and verify deterministic cursor traversal and shared navigation.
- Record the 30-minute/10,000-item client memory/frame/DOM-retention procedure and real-device codec behavior if not already covered by the user's Gate 6 testing. User testing is accepted; exact performance figures are not available in this checkout.
- Verify deployment upgrade/migrations, consistent database backup/restore, restart, cache loss/regeneration, and unavailable-source scenarios on the target configuration. Small-fixture recovery checks already exist.
- Finish reconciling stale documentation: DELIVERY-PLAN.md now counts themes and Docker packaging as delivered; API.md's introduction still predates implemented browse/tag/original endpoints; STAGE-6-HANDOFF.md contains historical not-yet-implemented statements. Preserve historical evidence while making current status clear.

Authentication, AI/face/object search, camera/duration/facial/delta filters, cloud sync, automatic albums, duplicate detection, maps, media editing, collaborative sharing, and complex roles are deferred or explicit non-goals. They are not initial-release missing features.

## Suggested completion order

1. Complete existing browsing workflows under Gate 7: child-folder pagination, mobile sort access, normal viewer audio controls, keyboard Reels seeking, search/filter choices, photo/mixed-media Reels selection, and Collections. Preserve the clarified mode-state and simple-toggle decisions.
2. Implement remaining sorts, grouping, stable shuffle, and custom covers with cursor/index checks; add random-image content using the validated random-key strategy.
3. Implement bounded metadata import and both export workflows, preserving originals and the public-path exception.
4. Complete deployment procedures, target-hardware acceptance evidence, and the final product checklist. Themes and initial Docker packaging can be counted as already delivered.

## Verification during this audit

No application behavior was changed. Only this audit document was added.

| Command | Result |
| --- | --- |
| `dotnet build Luma.slnx` | Passed, zero warnings/errors. |
| `dotnet test Luma.slnx --no-build` | Passed: 43 passed, one Unix-only skip on Windows. |
| `npm run build` in `src/Luma.Web` | Passed. Repeated with the required Node 24.21.0 after the initial Node 22.17.0 run. |
| `npm test` in `src/Luma.Web` | Passed: 15 tests in five files. Repeated on Node 24.21.0. |
| `npm run lint` in `src/Luma.Web` | Passed, including the repeat on Node 24.21.0. |
| `npm run test:e2e` in `src/Luma.Web` | Incomplete/failing: two desktop cases timed out in the shared `browsing.spec.ts` beforeEach while waiting for exact button name `Open Sample library`. Current library cards no longer use that accessible name. Stopped the remaining run after confirming the repeated setup failure; not a successful browser-suite verification. This run used Node 22.17.0. No E2E claim is based on this run. |

The stale browser setup should be repaired before claiming a green full release verification. It is test-maintenance work, not evidence that the corresponding product actions are unimplemented. Traces/error contexts were produced under `src/Luma.Web/test-results/` (ignored artifacts).
