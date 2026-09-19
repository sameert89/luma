# Folder-demand indexing API

`POST /api/folders/{id}/index` has no request body. For a never-indexed folder it uses SQLite to decide whether work is necessary. For an indexed folder whose library enables refresh-on-open, it additionally reads that directory's modification timestamp and queues a shallow scan only when it changed. It never enumerates the directory in the request.

- 202 with `ScanAccepted`: direct-folder discovery was queued; poll `/api/scans/{id}`.
- 204: direct discovery is current and pending media already have runnable processing work, or all direct media are prepared/failed.
- 409 with the common error contract: another discovery scan owns the library; keep retrying. When it is a full-library scan, the request also hands bounded advisory folder priority to that scan, so direct media can appear before unrelated traversal finishes.
- 404 with the common error contract: the folder does not exist or its library is disabled.

Discovery includes direct media and immediate child-folder entries. It never recursively indexes a subtree. Completed folder discovery is idempotent; opening a partially indexed or cancelled folder may resume its direct processing. Browse/search GETs remain SQLite/cache-only; this explicit indexing POST performs at most one source-directory timestamp read. See the [folder-demand decision](adr/0007-folder-demand-indexing.md) and [automatic refresh decision](adr/0011-automatic-library-refresh.md).
