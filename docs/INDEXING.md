# Indexing contract

## Folder-demand discovery

Opening an incompletely indexed folder queues direct-folder discovery through a separate POST while the library is idle. During a full-library scan, the POST instead hands bounded advisory priority to the owning worker while retaining its 409 response. The worker discovers the requested folder between ordinary discovery batches, under the same scan ID; it does not reconcile missing records early. The worker discovers direct media and child-folder entries using the existing bounds. Successful standalone reconciliation is restricted to that folder; unrelated folders remain untouched. Completed direct discovery is recorded and ordinary revisits do not scan again. Paused pending previews can resume on a later visit. Full rescans remain explicit for subsequent additions/changes. See [the API contract](API-FOLDER-INDEXING.md), [original decision](adr/0007-folder-demand-indexing.md), and [active-scan priority decision](adr/0008-active-scan-folder-priority.md).

Implemented in stage 3; see [verification](STAGE-3-VERIFICATION.md). The server coordinates discovery and processing in background workers, never in browse handlers. Originals are opened read-only.

## Roots, folders and identity

Multiple roots have stable integer IDs and configured absolute paths, never public path identifiers. Reject overlapping roots and duplicate canonical roots. Do not follow symlinks/reparse points; remain within the root. Persist folder IDs and parent relationships, including empty folders; folder navigation reads SQLite. Folder queries default to direct children; `recursive=true` includes descendants via a materialized folder ancestry table indexed in both directions. Root availability is separate from media presence.

An integer media ID is allocated once for a `(rootId, relativePathKey)` entry. Preserve original path spelling; path keys follow the root filesystem's case sensitivity, recorded when configuring the root. Changed size or modification timestamp at the same path is a replacement: retain ID, tags and preferences, increment source revision, clear extracted metadata and invalidate cache. This deliberately cannot detect same-size/same-timestamp edits; an explicit forced scan reprocesses them. No content hashing in routine scans.

Moves/renames create a new ID and leave the former record missing. Do not guess identity or transfer tags from matching names/sizes. Reappearing paths reuse their existing ID. Missing records retain tags and state; hide them by default, allow `availability=missing|all`. No automatic record or original deletion.

## Scan lifecycle and recovery

Persist run ID, root, state, counters, timestamps and per-file failures. One active run per root; duplicate start returns 409. Enumerate lazily into a bounded channel; stamp discovered records with the run ID in small transactions (at most 200 records). Only a successfully completed traversal may mark unseen entries missing. Any directory enumeration failure, root loss, cancellation or crash prevents missing reconciliation for the entire root. Metadata failures for individual discovered files do not make traversal incomplete.

On restart mark running scans interrupted and schedule a fresh traversal; idempotent upserts converge without duplicates. Reconcile missing rows and mark the run complete in one transaction, checking the run still owns the root. Background jobs are durable SQLite state; channels contain only bounded ready work. A persisted job claim has a lease, returned to pending after expiry/restart. Commit outcomes before acknowledging work.

Unsupported files are counted as skipped, without media rows. Corrupt supported files retain a media row with processing status failed and a bounded diagnostic code; continue scanning. Do not expose absolute paths or tool stderr in public errors. Three retries with 5 s, 30 s and 5 min delay for transient processing failures; permanent unsupported/corrupt failures await explicit retry or source revision change. Missing/unavailable sources await the next scan. Retry is idempotent for `(mediaId, sourceRevision, variantVersion)`.

## Initial formats

Photos: JPEG/JPG, PNG, WebP, GIF (first frame), BMP and TIFF (first page). Apply orientation when generating representations. Videos: MP4/M4V, MOV, MKV, WebM and AVI, subject to bundled ffprobe/ffmpeg codec support. A supported container does not guarantee browser playback; stream the original or offer an external-player URL, never automatically transcode. HEIC/HEIF, AVIF, camera RAW and other formats are initially skipped; add support explicitly with fixtures and decoder resource measurements.

## Limits

Defaults: discovery workers 1, image workers one fewer than the aggregate (3), external video processes 1, aggregate processing workers 4, ready queue capacity 128. Decoder child processes (image workers, FFmpeg, FFprobe) run at below-normal OS priority, so they use idle cores while browse requests are scheduled first. Keyword reads use the same pooled image workers rather than a process per file. Configuration ranges: workers 1–4, queue 16–1024, never exceed aggregate limit. Producers await capacity; never spawn a task per file. Database writes use batches of at most 200. Metadata/image work has a 30 s deadline; video probing/posters 60 s. Reject decoding above 100 megapixels and tool output above 1 MiB. Kill child processes on deadline or cancellation. Cancellation propagates to all async operations and drains/stops within 10 s (forced child-process termination if needed). Persistent pending work may exceed channel capacity without being loaded in memory. Browse work has priority; pause processing under cache quota pressure or repeated SQLite busy failures.

## Stage 3 operational details

Roots are local `Luma:Indexing:Libraries` configuration with explicit stable IDs. Case sensitivity defaults to false on Windows and true elsewhere; configure it to match the actual source filesystem. Root configuration does not create or write into media directories. Removed roots are disabled and retained. A root ID cannot silently change path/case semantics.

Traversal is depth-first and retains at most 128 directory enumerators plus the configured bounded channel. Exceeding this depth fails traversal safely. An unsupported extension is skipped. Discovery batches contain at most 32 entries and stop after 25 ms of work, with a yield between transactions. `completed` in scan status means traversal/reconciliation succeeded, not that all cache work succeeded. Processing counts and paginated historical failures are separate. A new traversal may adopt pending/ready work from the preceding scan.

Captured EXIF `DateTimeOriginal` uses `OffsetTimeOriginal` when available. Without an offset, Luma consistently interprets that wall time as UTC; malformed dates remain null and fall back to modification time. Image dimensions reflect applied EXIF orientation. Video dimensions reflect display rotation reported by FFprobe.

ImageSharp runs in bounded reusable child processes, recycled after 128 requests; FFprobe/FFmpeg are used for videos. The 30/60-second deadlines cover the whole processing job, including generated-output validation. See [the media pipeline ADR](adr/0002-bounded-media-pipeline.md) and [throughput and presence checks](adr/0005-indexing-feedback.md). Encoder-version changes schedule a fresh traversal. A waiting source or cancelled scan is retried when a later scan discovers the path; no browse request accesses the source.

## Cancelling and shutting down

Cancel is safe: originals are never modified, prepared previews and tags remain, and uncommitted discovery work rolls back. Workers stop claiming the cancelled scan; active decoders are cancelled. Incomplete traversal never marks undiscovered records missing. Start a normal scan to resume: it walks folders again but reuses unchanged ready work. A forced scan deliberately regenerates everything.

On graceful shutdown, active processing returns to the durable queue and incomplete traversal becomes interrupted. On restart, interrupted scans get a fresh traversal and expired claims recover. Initial indexing is opt-in: `ScanOnStartup=false` is the default. Set it to true only when every configured library should begin scanning at startup. Opening an unindexed library from Luma offers an explicit start action; it does not scan unrelated configured libraries. Do not delete the persistent data volume when restarting.

## Deleted originals

An opt-in background worker checks 100 known paths every 10 seconds without enumerating directories. It is disabled by default and can be enabled under Settings → Missing-file checks. While enabled, missing paths under accessible roots are hidden by default and retain their tags/cache. Active scans and disabled roots are skipped; unavailable roots are not treated as deleted. At 177,000 records, a complete pass takes roughly five hours plus I/O time. Configure `Luma:Indexing:SourceVerificationIntervalSeconds` to change the interval. Explicit scans discover additions, replacements and restored paths and reconcile deletions regardless of this setting. Normal browsing remains SQLite/cache-only.

## Stage 8 metadata stage

Initial indexing and rescans expose index only, embedded keywords, and embedded plus adjacent XMP options. Embedded is the default; the library retains the choice for demand/startup scans. Discovery and metadata queue creation are atomic but extraction is asynchronous after discovery. Restart retains per-file checkpoints/counters and resumes after the durable ID checkpoint; only unfinished selected files are retried. Tags, fingerprint and checkpoint commit together. Automatic passes compare indexed source revision and source/XMP size/mtime (including missing sidecars); manual imports bypass the revision skip. Changed sources during extraction do not get a successful revision. XMP changes are checked on the next indexing/import pass, without adding a filesystem watcher. The existing keyword extraction scope is unchanged; this stage imports tags rather than unrelated camera properties.

Cache and metadata workers share ProcessingWorkers as their aggregate decoder limit. Metadata waits behind pending viewport preparation and yields between file transactions. An already running child may finish within its bounded deadline. Browse reads continue through WAL using SQLite/generated cache only. Global tasks combine traversal, cache and metadata stages without treating discovery completion as completed preview generation.
