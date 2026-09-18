# ADR 0009 — Durable metadata stages and shared playback progress

Status: accepted for the user-requested Stage 8 v1.0.2 scope, 2026-09-19.

Metadata import becomes an optional durable stage of indexing, using the existing SQLite job worker. Enqueue is atomic with scan creation; extraction waits for discovery and never runs inside discovery transactions. Library mode persists. Successful file results atomically merge tags and persist their source/XMP fingerprint, ID checkpoint and file counters. Running imports recover to queued and resume unfinished work. Manual folder/file imports force extraction for repair. Source/XMP revision changes alone trigger automatic re-extraction. No watcher, infrastructure service, source writes or original transcoding is added.

Cache decoding and metadata extraction share the configured aggregate semaphore. Pending foreground preview jobs precede metadata claims. Bounded children already running finish or reach their deadline; background transactions remain short. WAL preserves interactive read concurrency.

Gallery and Reels now carry explicit shared query values and show scope filters. This user-requested Stage 8 contract supersedes prior independent-mode UI state. Tag grouping presents independently paginated tag collections, avoiding duplicated media IDs inside normal media cursors. A collectionTag predicate intersects the current query without changing any/all tag semantics.

Playback progress is stored by media ID in SQLite and is shared across devices on the instance. Existing Luma has no user identities, so this is library-wide history. Position and actual-playback increments determine unwatched/in-progress/completed; seeking alone cannot complete media. Periodic saves are bounded to one active request and one coalesced final flush. Completion remains sticky during replays.

Dialogs continue using approved Radix primitives. Closed content/overlays unmount immediately to release interaction and scroll locks without relying on exit animation completion. Gallery flex sizing explicitly constrains its scroll viewport. Media IDs and presentation mode in the UI URL restore open items after refresh while API filters remain separate.
