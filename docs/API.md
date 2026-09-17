# HTTP API contract

Gate 7 implements status, indexing/scans, library/folder navigation, media queries/detail/neighbors/cache/original streaming, tags/preferences, custom folder/library covers, cached random image content, Collections tag pages, and metadata jobs. Development OpenAPI and generated `contracts/luma.json` describe implemented HTTP shapes. Same-origin JSON uses camelCase, UTC ISO 8601 timestamps, integer IDs within JavaScript's safe range, and no source paths except the explicit dislike export.

## Foundation and errors

`GET /api/status` returns 200 `{ "status": "ready", "schemaVersion": 11 }` after a successful SQLite query. Database failure returns 503 `database_unavailable`. Migration failure prevents startup. No root scan or source access is performed.

Errors use `application/problem+json`: `{ "type": "about:blank", "title": "...", "status": 400, "code": "invalid_request", "traceId": "..." }`. Optional `errors` maps field names to message arrays. Never return stack traces, SQL, absolute paths or exception messages. Codes: 400 `invalid_request`/`invalid_cursor`, 404 `not_found`, 409 `conflict`, 413 `request_too_large`, 429 `rate_limited`, 503 `database_unavailable`/`cache_unavailable`, 500 `internal_error`. A future explicit expired cursor returns 410 `cursor_expired`. Unsupported methods return 405 `method_not_allowed`. Unknown API routes remain JSON 404, never the frontend shell.

## Shared media query (stages 4–7)

`GET /api/media` returns `{ items, nextCursor, previousCursor }`. Default page size 60, maximum 200, minimum 1; invalid limits return 400. Do not return an implicit total count. Summary fields: id, fileName, mediaType, dimensions, durationMs, effectiveDate, preference, availability and versioned cache URLs/status. Tags on a page use one batched query, never N+1.

All predicates combine with AND, except alternatives within a repeated field. Unknown parameters/enums and contradictory ranges return 400. Empty filters are omitted. Normalize searchable text to NFC/invariant uppercase like tag keys; literal `%` and `_` are escaped. Parameters:

| Parameter | Meaning |
| --- | --- |
| libraryId, folderId | Optional root/folder ID; folder must belong to specified root |
| recursive | False by default for a folder; without folder, query all selected roots |
| q | Whitespace-separated partial words, maximum 200 characters. Every word must occur in the normalized filename, root-relative path or assigned tags, in any order; punctuation remains literal. No typo correction |
| path | Literal substring of stored root-relative path, never a source read |
| startsWith, endsWith | Literal filename prefix/suffix, maximum 200 characters |
| tag | Repeated normalized tag names, at most 50; unknown tag means empty result |
| tagMode | all (default) or any; applies only to tag predicates |
| tagged | true/false; false with tag values is invalid |
| mediaType | image/video; omitted means both |
| extension | Repeated lowercase extension without dot, at most 20 |
| dateFrom, dateTo | Inclusive start/exclusive end UTC, over effectiveDate |
| minSizeBytes, maxSizeBytes | Inclusive nonnegative byte bounds |
| orientation | landscape/portrait/square; exact stored width/height comparison |
| minWidth, width, minHeight, height | Inclusive minimum/exact positive dimensions; unknown dimensions do not match |
| minAspectRatio, maxAspectRatio | Inclusive positive finite bounds over width/height; unknown dimensions excluded |
| preference | neutral/liked/disliked; omitted means all |
| availability | present (default)/missing/all; root unavailability does not itself mark files missing |
| sort, order | modified (default), captured, name, type, size, shuffle; asc/desc (default desc) |
| seed | Required for repeatable shuffle; server supplies one if absent and returns it with query state |
| groupBy | none/folder/date/type; presentation headers within paginated results, no full-result materialization |

`effectiveDate = capturedAt ?? modifiedAt ?? indexedAt`, persisted on indexing. The captured sort and date filter use effectiveDate; modified uses `modifiedAt ?? indexedAt`. Group date means UTC day of effectiveDate. Grouping orders group keys ascending and applies the chosen sort direction and ID tie-breaker within each group; folder grouping uses folder ID, type grouping image before video. Unknown dimensions and metadata sort last where applicable. String ordering is normalized binary ordering; ties always use ID in the chosen direction. Group headers may repeat across page boundaries and clients merge adjacent identical headers.

Opaque base64url cursors encode a versioned payload signed with a persisted server key: canonical filter/sort/group fingerprint, seed, direction, last composite sort tuple and ID. Limits and direction may change, filters/order may not. Bad encoding/signature/fingerprint returns 400. No offset pagination. Previous page uses the inverse seek/order and reverses the returned page. Cursors are not snapshots: concurrent inserts before a cursor are seen after refresh; edits to ordering/filter fields can cause omission/repetition. Clients deduplicate IDs; a refreshed query restarts traversal. Fixed datasets must traverse without gaps or duplicates. Signing-key reset invalidates existing cursors.

## Query and index candidates

All tables/indexes below are introduced with the owning feature's migration and checked with `EXPLAIN QUERY PLAN` on 120k and 1m fixtures. Use parameterized SQL; allowlist order clauses.

| Query | Candidate strategy |
| --- | --- |
| modified/captured/name/type/size | Persist non-null sort keys; B-tree `(availability, key, id)`, root/folder-scoped `(rootId, availability, key, id)`/`(folderId, availability, key, id)` only for measured common sorts. Seek `(key,id) >/< (@key,@id)`; no OFFSET |
| folders/recursive | `(parentId,id)` folder index; ancestry `(ancestorId,descendantId)` joins indexed `(folderId,id)` media |
| tags all/any, tagged | `(tagId,mediaId)` semi-joins or grouped matching IDs with count = tag count; `(mediaId,tagId)` EXISTS/NOT EXISTS |
| keyword/path/endsWith | FTS5 trigram candidate index for substrings of 3+ characters, then exact literal verification; reversed normalized filename B-tree for suffix. Short substrings scan narrowed SQL candidates, bounded by query deadline |
| startsWith/name | Binary normalized key range, with escaped literal prefix verification |
| library/type/extension/preference | Equality predicates, measured leading equality + sort composites; extension/type/preference each have ID lookup indexes |
| dates/size/dimensions/aspect/orientation | Persist effective date, aspect ratio and orientation; range B-trees for selective candidate IDs, intersect with query, residual predicates for combinations. Avoid an index for every combination |
| grouping | Persist date-day key; `(groupKey,sortKey,id)` for measured combinations. Rare combinations may sort the narrowed SQLite result under deadline; benchmark before release |
| shuffle | Persist a uniformly generated 63-bit random key and `(availability,randomKey,id)` index. Seed maps to a pivot; seek from pivot then wrap once, cursor records segment/key/ID. Seed rotates a fixed random permutation, not an independent permutation; filters apply before page limit. Grouping + shuffle rotates within each group |
| random image | Same filtered random-key pivot with wrap, LIMIT 1, cache-ready images only. Unequal key gaps create selection bias: acceptable for decoration, not statistical sampling. No `ORDER BY random()` over a full result |

Rare broad substring/multifilter queries have a 2 s database execution deadline; return 503 `query_timeout` with narrower-search guidance. This is a safety ceiling, not permission to exceed common-query budgets. Candidate strategies must be measured in their implementation stage; no performance result is claimed by this contract.

## Remaining endpoint behavior

| Endpoint | Behavior / stage |
| --- | --- |
| GET /api/libraries; GET /api/folders?parentId=… | ID/name/root availability and paginated direct folders, max 200, SQLite only; stage 4 |
| POST /api/libraries/{id}/scans; GET /api/scans/{id}; POST /api/scans/{id}/cancel | Start 202 with Location; inspect counters/failures; idempotent cancel 202, conflict if active scan exists; stage 3 |
| GET /api/media/{id} | Metadata detail, 404 unknown; no filesystem access; stage 4 |
| GET /api/media/{id}/cache/{revision}/{variant} | Generated content, ETag/304; see MEDIA-CACHE.md; stage 4 |
| GET /api/media/{id}/original | Explicit original download/stream; single range 206, unsatisfiable 416, unavailable source 503 `source_unavailable`; stage 6 |
| GET /api/tags?prefix=… | Bounded autocomplete; stage 5 |
| POST /api/media/priority | `{ids}`, 1–200 distinct positive IDs in display order, 204; see MEDIA-CACHE.md; stage 6 |
| POST /api/tags | Create or return existing normalized tag, 201 new/200 existing; stage 5 |
| PUT /api/tags/{id} | `{name}` renames, or merges into an existing same-key tag; 200 with the resulting tag, 404 unknown; Gate 7 feedback |
| DELETE /api/tags/{id} | Removes the tag and every assignment; 204, 404 unknown; Gate 7 feedback |
| POST /api/media/tags | Atomic bulk `{mediaIds, addTagIds, removeTagIds}`, 204; limits in TAGGING.md; stage 5 |
| PUT /api/media/{id}/preference | `{preference}` neutral/liked/disliked; 204; stage 5 |
| PUT /api/folders/{id}/cover | `{mediaId}` or null for default; must be present descendant in same root; 204; stage 7 |
| GET /api/random | Same filters, forces images; conflicting video filter 400; returns cached preview content, no match 404, cache pressure 503; no-store; stage 7 |
| POST /api/exports/dislikes; POST /api/exports/xmp; POST /api/imports/tags | Explicit bounded jobs, 202 with Location; inspect via GET /api/jobs/{id}, download finished exports via GET /api/jobs/{id}/content; stage 7 |

`POST /api/imports/tags` accepts either an explicit `mediaIds` selection (1–500) or, with `mediaIds` omitted, a `query` scoping every present item to import — unbounded in count, walked one item at a time; see TAGGING.md.

Default covers select the first cache-ready descendant using modified-descending order; stale custom covers fall back without reading originals. Covers refer to IDs and retain preference when a source is temporarily unavailable.

Mutation JSON is limited to 64 KiB except streamed import/export jobs; invalid bodies return common 400/413. No request accepts an arbitrary source path for streaming. Library paths are private local configuration. Export retention defaults to 24 hours and counts against a separate 1 GiB job quota; jobs fail visibly on quota exhaustion. Only implemented endpoints are generated into frontend contracts.

## Stage 3 indexing administration

`GET /api/indexing` returns `{ libraries, cachePressure, cacheBytes, discoveryWorkers, processingWorkers, imageWorkers, videoWorkers, queueCapacity }`. Each library has `id`, `name`, `availability` (`unknown|available|unavailable`) and nullable `latestScanId`. It reads SQLite/configuration only; it does not inspect source roots.

`POST /api/libraries/{id}/scans` accepts `{ "force": false, "retryFailures": false }` (both fields optional; an empty JSON object is valid). It returns 202 `{ "id": scanId }` with `Location: /api/scans/{scanId}`; an unknown/disabled library returns 404 and an existing queued/running traversal returns 409.

`GET /api/scans/{id}?afterFailureId=0` returns the ID, library ID, traversal state, discovered/skipped counts, start/finish timestamps, nullable traversal `failureCode`, processing counts (`pending`, `processing`, `ready`, `failed`), `failures` and nullable `nextFailureId`. States are `queued|running|completed|cancelled|interrupted|failed`. `completed` describes a successful traversal; processing may continue. Pending includes jobs waiting for the next scan/source availability. Processing counts describe jobs currently associated with that scan; later scans can adopt unchanged work. Failure history remains attached to the scan that recorded it.

Failure entries contain `{ id, mediaId, code, occurredAt }`, at most 100 per response. Pass `nextFailureId` as `afterFailureId` to continue; no offsets or implicit unbounded history. A negative value returns 400. Unknown scan IDs return 404.

`POST /api/scans/{id}/cancel` returns 202 `{ "id": scanId }` with Location, including repeated cancellation. It stops traversal and outstanding processing. If traversal already succeeded, cancellation does not undo its completed reconciliation; otherwise unseen rows are not marked missing. A finished scan with no outstanding work is a no-op; unknown IDs return 404.

Failure codes include `source_unavailable`, `source_changed`, `invalid_media`, `dimensions_exceeded`, `memory_limit`, `invalid_generated_media`, `tool_unavailable`, `tool_output_exceeded`, `cache_io`, `processing_timeout`, `database_busy`, `indexing_failed` and `interrupted`. `cache_pressure` pauses a job and appears in administrative status without exposing a file path. Stage 3 introduced these administration endpoints; subsequent stages add the remaining endpoints above.

## Stage 6 original access

`GET /api/media/{id}/original` is implemented as explicit source access, separate from indexed browse/detail/cache requests. Inline streaming is the default; optional `download=true` uses attachment disposition with the indexed filename. The server validates the stored relative path against the configured enabled library root and rejects links and paths outside it. Single-byte-range requests return 206; unsatisfiable ranges return 416. ASP.NET Core handles range processing without buffering the whole original. Unknown/disabled records return 404; missing/unreadable source files return 503 `source_unavailable` using the common error contract. Cancellation flows through database lookup and HTTP streaming. Files are opened read-only; there is no decoding or transcoding.

Unsupported browser codecs: copy the absolute original stream URL from the viewer, then paste it into an external player's network-stream command (for example VLC's Open Network Stream). The player must be able to reach this server. The browser can also explicitly open or download the original. There is no server-side player launch or codec conversion.

## Gate 7 implementation details

Media summaries include nullable `groupKey` and `groupLabel`. Clients merge adjacent equal keys across page boundaries. Date grouping uses the stored UTC effective-date day; type grouping puts images before videos. Sort direction applies within each group. Name sorting uses normalized binary keys; captured sorting uses effective date with its documented fallback.

Shuffle seeks ascending random key from a seed-derived pivot and wraps once, including within each group. `order` does not change that permutation. `MediaPage.seed` returns the server-generated seed when absent: send it on subsequent page/neighbor requests. Changed seeds, filters, sorts or grouping invalidate cursors. No query uses full-result random sorting. UI reshuffle creates a new seed.

`GET /api/collections/tags?cursor=...` returns `{ items, nextCursor, previousCursor }`, at most 50 tags in stable creation-ID order with opaque forward/backward cursors. Prefix autocomplete remains separate.

`PUT /api/folders/{id}/cover` accepts `{ "mediaId": 123 }` or `{ "mediaId": null }` to reset. A library uses its `rootFolderId`; no duplicated library cover state is stored. Selection must be a present descendant in the same library. Unknown folders are 404; invalid selections 400. Stale cache revisions, moved/missing selections fall back to automatic. Eligible cached selections survive temporarily unavailable sources. Selection never processes originals.

`GET /api/random` returns generated JPEG preview content with `Cache-Control: no-store`. Shared predicates apply; images are forced. Video-only or cursor requests are 400, no matching indexed image is 404, and matches with no ready preview are 503 `cache_unavailable`. Physical cache loss returns 503 and queues recovery. It returns content directly, never original data, JSON descriptors or redirects. Random-key gap bias is acceptable for decoration.

Metadata POST bodies are `{ "mediaIds": [123], "query": { "libraryId": 1 }, "includeSidecars": true }`. All fields are optional. IDs are deduplicated and capped at 500; unknown references are 404 and invalid selections/cursors 400. Imports act on the explicit selection or every matching present item when IDs are omitted. The folder import UI sends only library/folder scope, without gallery filters or IDs, to import all direct indexed photos and videos. Exports without IDs stream all matching records in 100-row ID batches; sort/group/page limit do not restrict the export set. Dislike exports force disliked preference and all availability states, including missing records.

`POST /api/imports/tags`, `/api/exports/xmp`, `/api/exports/dislikes` return 202 `{ "id": jobId }` and `Location: /api/jobs/{id}`. A single in-process worker drains a durable SQLite queue of at most 16 active jobs; a full queue is 429. `GET /api/jobs/{id}?afterMediaId=...` returns kind/state/timestamps, processed/failed counts, failure code/content URL and at most 100 per-item import results; continue with `nextMediaId`. States: queued/running/completed/failed/expired. Completed imports may have findings; inspect counts and item codes. Resubmit the selected IDs to retry idempotently.

Imports recognize image XMP `dc:subject`, EXIF `XPKeywords`, and video format/stream `keywords`/`subject`. Optional adjacent `original.ext.xmp` and `original.xmp` files are both unioned. Paths remain server-controlled and root/link checked. Image metadata identification runs in a cancellable child with a 128 MiB managed heap cap and a 32 MiB decoder allocation cap; no pixel decoding is needed. Each item has a 30-second deadline. XMP/tool output is capped at 4 MiB; video probes use one thread, a fixed demuxer and local protocols. Existing tag spelling and assignments survive; valid union merging is atomic and enforces 100 tags/item. Findings include invalid_tags, invalid_metadata, source_unavailable and metadata_timeout.

Export `snapshotAt` identifies a SQLite read snapshot established at processing start, not enqueue time. All media/tag batches use it; later edits require a new export. XMP ZIPs contain media-ID `.xmp` files, `paths.jsonl` (media/library IDs, relative paths and sidecar names), and `MERGE-INSTRUCTIONS.txt`. Only explicit disliked JSON Lines downloads contain absolute configured source paths and availability; reconstructing them never stats originals.

`GET /api/jobs/{id}/content` streams completed exports as attachments. Downloads expire after 24 hours and share a separate 1 GiB quota, checked against uncompressed output and final archive bytes. Quota exhaustion is visible as `job_quota_exceeded`; missing/unfinished/expired downloads are 404. Queued jobs survive restart. Running jobs fail as `interrupted`, partial files are discarded and explicit retry is safe. These operations never rewrite embedded metadata, write adjacent source sidecars or delete originals.
