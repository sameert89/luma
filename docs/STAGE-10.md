# Stage 10 — Background jobs, folder rescans and search completion

Status: implemented locally on 2026-09-19. No release version has been assigned.

## Feedback addressed

1. Cancelling a task failed with "An error occurred while processing your request."
2. **Indexing status** was confusing: a tiny **Scan controls** disclosure per library opened a
   button, which opened another sheet asking what to index.
3. A library was not treated like a folder: its card had no ⋯ menu.
4. Tag entry relied on a `<datalist>`. On Android it surfaced as a small arrow mixed into the
   keyboard's own suggestions instead of a usable search.
5. Main search had no autocomplete, and nothing said whether a completion was a file or a tag.

## Decisions

### Task list failure

`GET /api/tasks` mapped rows to the `BackgroundTask` record by constructor. SQLite reports no type
for computed columns (`'scan-'||Id`, `CASE … State`, `0 Pending`, `COALESCE(…) Scope`) when there is
no first row to infer from, so an empty or just-cleared queue failed Dapper's constructor match
with a 500. Rows now map by property (as `SourcePresenceWorker` already does) and are projected to
the contract record. The HTTP contract is unchanged.

### Background jobs

- **Indexing status** is renamed **Background jobs**, both on Your libraries and in an open
  library's header (the spinning icon). The panel lists jobs only: cancel, queue again, clear.
- Per-library **Scan controls** and the rescan form are removed from the panel.
- **Refresh collection** now only reloads what is shown; it never starts a scan.

### Rescan from the folder menu

- Every folder menu has **Rescan folder**; a library's root folder shows **Rescan library**.
  The metadata choice (index only / embedded / embedded + XMP) is made there, then **Start rescan**.
- `POST /api/folders/{id}/scans` (`StartScanRequest`) queues the rescan. On a root folder it is a
  library scan. On any other folder it is a *recursive* folder scan (migration 0017 adds
  `Scans.Recursive`). It traverses the folder's subtree, marks missing only media inside that
  subtree, and stamps indexed folders within it. Media outside the folder is never reconciled by a
  folder rescan.
- Folder-demand indexing (`POST /api/folders/{id}/index`, opening a never-indexed folder) remains
  direct-only.
- Only one scan per library may be queued or running; a second request returns 409 with a message
  saying so.

### A library is a folder

Library cards carry the same **Folder actions** menu as folder cards (built from the library's root
folder). It includes Rescan library, Folder information, Import folder metadata and Reset album
cover. Hide folder stays unavailable for a root.

### Tag entry

The tag field is a plain search field with browser and keyboard autocomplete, autocorrect and
autocapitalisation off. Matching tags list below it as full-width rows (44 px targets):

- A tag already on the item shows **Added** and is disabled.
- **Create "…"** appears when no tag matches exactly.
- Up/Down move between the field and the rows; Escape returns to the field.

This is an inline list, not a popover, so it needs no floating primitive.

### Search completion

`GET /api/search/suggestions?q=&limit=` (limit 1–20, default 8) returns `{kind,label,id,detail}`,
tags first. It never enumerates directories or stats files.

- **Tags:** up to 4, by prefix on the unique `NormalizedKey`, and only tags that still label
  media.
- **Files:** names starting with the text (range seek on `IX_Media_Name`), then, from three
  characters, names containing it. The trigram FTS index supplies at most 200 candidates, so a
  common fragment cannot scan the library.
- Missing media and hidden folders are excluded. `detail` is the file's folder, which tells apart
  identical names.

The search field is an ARIA combobox (`aria-activedescendant`, focus stays in the field). Each
option shows an icon, the label, the folder for files, and a **Tag** or **File** badge.

- Choosing a tag shows everything with exactly that tag.
- Choosing a file opens it in the viewer, over results for its name.
- Enter without a highlighted option searches the typed text as before.
- Suggestions are library-wide; a typed search still honours the current scope.

### Folder metadata: natural names, dates and folder suggestions

Folders used to hold only a path, so they could only be sorted by name. That sort compared paths
with ASCII-only `NOCASE`: "Day 10" came before "Day 2", and accented names landed after Z.
Migration 0018 gives folders three indexed fields, maintained by triggers like the Media keys:

- `SortKey`: natural name order. Case and accents are ignored and digit runs compare by value.
  Name sorting uses it on `IX_Folders_Parent_Sort`.
- `ModifiedTicks`: the directory's own modified time, as file explorers show it. Scans already
  list each directory's time while traversing, so recording it costs no extra file access. Until a
  folder is rescanned, the migration fills in the newest file directly inside it. Folders then
  follow the date sorts (modified, captured). Other media sorts (name, type, size, shuffle) order
  folders by name, and every sort keeps the selected direction.
- `NameKey`, plus the `FolderSearch` trigram index: search suggestions include folders, marked
  **Folder** with their library and parent path. Choosing one opens it.

Recursive folder aggregates (item counts, total size, newest photo inside) are not stored. Keeping
them current on every indexed file would cost far more than these per-folder fields.

Measured on a synthetic library of 50,000 sibling folders and 500,000 files:

| What | Time |
| --- | --- |
| Migration 0018 backfill, index builds and full-text rebuild | 468 ms |
| Folder suggestions (including warm-up) | 48–70 ms |
| Two 48-folder pages, sorted by name | 72 ms |
| Two 48-folder pages, sorted by date | 3 ms |

A copy of the browser fixture database migrated from schema 16 to 18 in 102 ms, with every key and
time filled and integrity checks passing.
