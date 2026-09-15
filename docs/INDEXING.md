# Indexing contract

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

Defaults: discovery workers 1, metadata/image workers 1, external video processes 1, aggregate processing workers 2, ready queue capacity 128. Configuration ranges: workers 1–4, queue 16–1024, never exceed aggregate limit. Producers await capacity; never spawn a task per file. Database writes use batches of at most 200. Metadata/image work has a 30 s deadline; video probing/posters 60 s. Reject decoding above 100 megapixels and tool output above 1 MiB. Kill child processes on deadline or cancellation. Cancellation propagates to all async operations and drains/stops within 10 s (forced child-process termination if needed). Persistent pending work may exceed channel capacity without being loaded in memory. Browse work has priority; pause processing under cache quota pressure or repeated SQLite busy failures.

## Stage 3 operational details

Roots are local `Luma:Indexing:Libraries` configuration with explicit stable IDs. Case sensitivity defaults to false on Windows and true elsewhere; configure it to match the actual source filesystem. Root configuration does not create or write into media directories. Removed roots are disabled and retained. A root ID cannot silently change path/case semantics.

Traversal is depth-first and retains at most 128 directory enumerators plus the configured bounded channel. Exceeding this depth fails traversal safely. An unsupported extension is skipped. One discovered entry is persisted per short transaction, including its folder ancestry, within the 200-record batch ceiling. `completed` in scan status means traversal/reconciliation succeeded, not that all cache work succeeded. Processing counts and paginated historical failures are separate. A new traversal may adopt pending/ready work from the preceding scan.

Captured EXIF `DateTimeOriginal` uses `OffsetTimeOriginal` when available. Without an offset, Luma consistently interprets that wall time as UTC; malformed dates remain null and fall back to modification time. Image dimensions reflect applied EXIF orientation. Video dimensions reflect display rotation reported by FFprobe.

ImageSharp runs in a bounded child invocation of the application; FFprobe/FFmpeg are used for videos. The 30/60-second deadlines cover the whole processing job, including generated-output validation. See [the media pipeline ADR](adr/0002-bounded-media-pipeline.md). Encoder-version changes schedule a fresh traversal. A waiting source or cancelled scan is retried when a later scan discovers the path; no browse request accesses the source.
