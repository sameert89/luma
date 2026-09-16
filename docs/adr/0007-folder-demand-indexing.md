# Folder-demand indexing

Status: accepted, 2026-09-17. The user accepted the stages 4–5 UI gate and requested that opening an incompletely indexed folder prepare its media while the library is idle.

Folder navigation submits a separate POST; browse/search GET handlers remain SQLite/cache-only. The POST checks database state and queues a durable folder-scoped scan. Only the background discovery worker enumerates originals. Existing discovery channels, batching, processing limits, cancellation and leases apply. One active scan per library remains enforced.

Folder scans enumerate direct files and immediate child-folder entries, not descendants. Successful reconciliation applies only to direct media in that folder. Cancellation, inaccessible directories and interruption never reconcile missing entries. Restart/retry preserves the folder scope. Completed direct discovery is recorded on the folder, so ordinary revisits do not enumerate originals again. A completed folder can be queued again when pending media have no runnable processing owner, including cancelled scans.

When another scan owns the library, the POST returns the common 409 error. The mounted folder view retries at three-second intervals; leaving the view cancels its observer. Successful discovery refreshes bounded media/folder summaries while previews are prepared. Cache-loss retries also remain limited to mounted images and use capped attempts/backoff.

New filesystem paths cannot be listed before discovery has recorded them. Full rescans remain explicit and detect later additions/changes to already-completed folders. This does not introduce a filesystem browser into normal request handlers.
