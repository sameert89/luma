
# Luma Architecture

## Purpose

Luma is a lightweight, self-hosted photo and video browser for large personal media libraries.

It is designed to provide:

- fast browsing of hundreds of thousands or potentially millions of media records
- excellent desktop and mobile usability
- first-class photo and video support
- fast tag search and editing
- gallery and reels-style browsing
- low resource usage
- simple self-hosting
- a pretty and user friendly UI

Luma is not intended to become a full digital asset management platform.

## Architectural philosophy

Luma should be architecture-wise deliberately boring.

The preferred solution is usually the simplest architecture that satisfies the performance requirements.

The application should remain understandable by one developer.

Complex distributed infrastructure is considered a cost, not a feature.

## Deployment model

The intended deployment model is a single Luma instance.

Conceptually:

```text
Browser
   |
   v
Luma
   |
   +---- SQLite database
   |
   +---- generated cache
   |
   +---- source media filesystem
```

The application will be as a Docker container.

A typical deployment should resemble:

```text
/media    source media, preferably read-only
/data     database and generated application data
```

## Core invariant

The most important architectural rule is:

> Already-indexed browsing must not depend on accessing original media files.

After indexing, Luma should be able to answer gallery and search requests using only:

- SQLite
- generated cache files

Original media may be accessed for:

- initial indexing
- incremental re-indexing
- explicit original-file viewing or downloading
- video streaming
- metadata import/export
- explicit administrative operations

## Major components

### Web frontend

Responsible for:

- gallery browsing
- media viewing
- reels mode
- searching
- filtering
- tag editing
- responsive desktop/mobile UX

Technology:

React
TypeScript
Vite

Tailwind CSS

Radix UI primitives
    Dialog
    Popover
    Dropdown Menu
    Tooltip
    Select
    Tabs
    etc.

TanStack Query
TanStack Virtual

eslint-plugin-jsx-a11y

### ASP.NET Core server

Responsible for:

- HTTP API
- media query execution
- tag operations
- streaming media
- index coordination
- cache lookup
- thumbnail generation coordination
- application configuration

Technology:

- .NET 10
- ASP.NET Core
- Dapper

### SQLite database

Stores application state including:

- indexed media
- extracted metadata
- tags
- media/tag relationships
- index state
- cache state where useful

SQLite is the authoritative application database.

### Indexer

Responsible for discovering media files and extracting metadata.

The indexer may inspect source files.

Indexing is explicitly separated from request-time browsing.

### Media cache

Stores generated representations such as:

- thumbnails
- preview images
- video poster frames

Cache entries are disposable and may be regenerated.

Original media is not disposable.

## Media identity

Every indexed media item receives a stable integer application ID.

Filesystem paths are attributes, not primary identifiers.

Example conceptual model:

```text
MediaItem
---------
Id
Path
FileName
MediaType
SizeBytes
ModifiedAt
CapturedAt
Width
Height
DurationMs
MimeType
IndexedAt
```

URLs should use media IDs rather than filesystem paths.

Preferred:

```text
/api/media/184921
```

Avoid exposing paths in public API contracts.

## Query model

Gallery, reels and future slideshow-style interfaces should operate on the same logical media query.

Conceptually:

```text
MediaQuery
----------
MediaType
Tags
DateFrom
DateTo
Sort
Orientation
```

Presentation modes are views over a query result.

Gallery and Reels reuse the same query contract and applicable filter/sort semantics. Their selected query values are mode-specific UI state; switching modes does not require synchronization or preservation of those values. A viewer navigates within the active query of the mode that opened it.

They should not implement separate search/filter systems.

## Pagination

Large media collections use cursor/keyset pagination.

Offset-based pagination must not be used for deep traversal of large collections.

Preferred concept:

```sql
WHERE captured_at < @cursorCapturedAt
   OR (
       captured_at = @cursorCapturedAt
       AND id < @cursorId
   )
ORDER BY captured_at DESC, id DESC
LIMIT @limit;
```

The cursor exposed by the HTTP API should be opaque to clients.

## Tag authority

Luma stores application tags in SQLite.

The SQLite representation is authoritative during normal application use.

The set of media which Luma renders, may already have EXIF/XMP data, the user should have an option to import/export tags if they wish, export would be xmp only and given the user to write it externally and provide merge instructions if they wish to use it with other software.

## Original media policy

Source media should be mountable read-only.

Luma must never require write access to originals for normal browsing or tag editing.

This reduces:

- corruption risk
- accidental modifications
- filesystem permission complexity
- metadata-format inconsistencies

## Concurrency

Background work must be bounded.

Examples:

- indexing workers
- metadata extraction
- thumbnail creation
- video poster extraction

Do not create one task per media file.

Worker concurrency must be configurable.

Low-end hardware should be considered the default deployment environment.

## Failure handling

Failure to process one media file must not terminate an entire library scan.

Errors should be associated with individual media records where practical.

The application should be able to retry failed processing.

Generated-cache corruption should be recoverable by deleting or regenerating the affected cache entry.

## Dependency philosophy

Dependencies are allowed when they solve difficult problems well.

Dependencies should not be added merely to save a small amount of application code.

Infrastructure dependencies receive especially high scrutiny.

Luma should ideally require only:

- the Luma application
- SQLite
- media-processing binaries/libraries packaged with the deployment

## Non-goals

Unless deliberately introduced later, Luma is not initially intended to provide:

- cloud synchronization
- facial recognition
- AI image classification
- multi-node clustering
- public social sharing
- collaborative asset management
- advanced media editing
- replacement for the source filesystem
- automatic organization of the user's media files

These features must not influence the initial architecture.


---
