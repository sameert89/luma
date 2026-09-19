# Automatic library refresh

Status: accepted, 2026-09-20. New and changed media should become visible without requiring routine manual full-library rescans, while normal browsing remains SQLite/cache-only and change detection stays inexpensive on low-end hardware.

Automatic discovery is configured independently for each library. Filesystem watching is the default; periodic full scans and manual-only discovery are alternatives, never concurrent automatic strategies. Refresh-on-open is a separate switch and remains useful with every strategy.

`FileSystemWatcher` is only a hint source. Events are coalesced by affected folder, debounced, and held until the last changed file or directory has stable size/mtime samples. The resulting dirty-folder hints are persisted in SQLite. An event for a newly created or moved directory first shallow-scans its known parent, then recursively scans only the new subtree after its folder record exists. Rename records both parents. Watcher errors are logged and manual Rescan library remains the authoritative recovery action.

The optional periodic strategy queues one ordinary full-library scan after its configured interval. It exists for Docker/network filesystems that do not reliably forward notifications. Selecting it waits one full interval before the first automatic scan rather than unexpectedly starting work while the setting is saved.

Opening a folder still calls the explicit indexing POST. For an indexed folder with refresh-on-open enabled, that endpoint performs one directory timestamp read; it queues a shallow scan only when the timestamp differs. Gallery/search GETs never stat or enumerate source media.

All discovery uses the existing one-active-scan-per-library rule, bounded traversal batches, SQLite transactions and processing concurrency. Open-folder work has priority 2, watcher work priority 1 and periodic/manual scans priority 0. Discovery only creates or updates index rows and durable jobs; tag extraction, technical metadata, thumbnails and video posters remain separate bounded workers. Automatic tag-import mode is independent of discovery mode. Full image previews remain on demand.

