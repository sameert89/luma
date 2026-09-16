# Folder-demand indexing API

`POST /api/folders/{id}/index` has no request body. It uses SQLite only to decide whether background work is necessary.

- 202 with `ScanAccepted`: direct-folder discovery was queued; poll `/api/scans/{id}`.
- 204: direct discovery is complete and pending media already have runnable processing work, or all direct media are prepared/failed.
- 409 with the common error contract: another discovery scan owns the library; retry after it finishes.
- 404 with the common error contract: the folder does not exist or its library is disabled.

Discovery includes direct media and immediate child-folder entries. It never recursively indexes a subtree. Completed folder discovery is idempotent; opening a partially indexed or cancelled folder may resume its direct processing. No originals are accessed in this HTTP handler. See [the decision](adr/0007-folder-demand-indexing.md).
