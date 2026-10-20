# Luma

Luma is a lightweight, self-hosted photo and video browser built for large media libraries and modest hardware. It keeps originals read-only by default, supports explicitly enabled file management, stores its index and tags in SQLite, and serves generated thumbnails and previews from a disposable cache.

## Features

- Fast folder and gallery browsing backed by SQLite and generated cache files
- Photo and video viewing, slideshows, and the vertical Flick feed
- Panels comic bookshelves with saved recursive sources and reading progress
- Opt-in plain SRT captions from matching sidecars or embedded SubRip tracks
- Optional uploads, folders, same-library cut/copy/paste and queued recycling when file management is enabled
- Keyword, path, date, media-type, size, orientation, preference, and tag filters
- Cursor-paginated results, virtualized galleries, stable sorting, grouping, and shuffle
- Tags, favourites, dislikes, custom album covers, hidden folders, and bulk editing
- Embedded metadata and optional XMP import, plus XMP and disliked-path exports
- Bounded background indexing and media processing with visible progress and cancellation
- Responsive React UI, installable PWA support, themes, keyboard controls, and accessible dialogs
- A single ASP.NET Core service with SQLite—no external database, cache, or message broker

Luma is intended for trusted private networks. It does not currently provide authentication, so do not expose it directly to the public internet.

## Run with Docker Compose

Requirements: Docker with Compose and an absolute path to your media directory.

```sh
cp .env.example .env
# Set LUMA_MEDIA_PATH in .env to an absolute media directory.
docker compose up --build -d
```

On Windows PowerShell, create the environment file with:

```powershell
Copy-Item .env.example .env
```

For a normal Windows NTFS library, set `LUMA_CASE_SENSITIVE=false`. Open <http://127.0.0.1:5080> after the container starts. Compose mounts originals read-only at `/media` and stores the database and generated cache in the `luma-data` volume.

Luma does not start an expensive full scan unless you request one (or explicitly enable startup scanning). Open the configured library, choose which tags to import, and either index folders as you open them (no background scan) or index everything now.

See the [deployment guide](docs/DEPLOYMENT.md) for upgrades, HTTPS/PWA setup, backups, restoration, cache recovery, health checks, and direct Docker operation.

## Configuration

The Compose defaults are suitable for a single media root. The most commonly changed values are:

| Variable               | Purpose                                                   | Default  |
| ---------------------- | --------------------------------------------------------- | -------- |
| `LUMA_MEDIA_PATH`      | Absolute host path mounted read-only as the media library | Required |
| `LUMA_CASE_SENSITIVE`  | Whether media paths use case-sensitive identity           | `true`   |
| `LUMA_SCAN_ON_STARTUP` | Start a full scan when the service starts                 | `false`  |

The Compose environment also accepts `LUMA_FILES_ENABLED=false`,
`LUMA_FLICK_ENABLED=true` and `LUMA_PANELS_ENABLED=true` as initial toggle defaults.
Saved in-app choices take precedence on subsequent boots.

ASP.NET Core configuration also accepts JSON, environment variables, and command-line arguments. Nested environment keys use double underscores, such as `Luma__DatabasePath` and `Luma__Indexing__CachePath`.

An equivalent server configuration looks like this:

```json
{
  "Luma": {
    "DatabasePath": "/data/luma.db",
    "Indexing": {
      "CachePath": "/data/cache",
      "Libraries": [
        {
          "Id": 1,
          "Name": "Media",
          "Path": "/media",
          "CaseSensitive": true,
          "ScanOnStartup": false
        }
      ],
      "DiscoveryWorkers": 1,
      "ImageWorkers": 1,
      "VideoWorkers": 1,
      "ProcessingWorkers": 2,
      "QueueCapacity": 128
    }
  }
}
```

Library IDs must remain stable positive integers. Library roots must be distinct and non-overlapping. Keep the database and cache outside every media root. Worker concurrency is intentionally bounded; increase it cautiously on faster hosts. Full configuration and operational behavior are documented in [indexing](docs/INDEXING.md), [media cache](docs/MEDIA-CACHE.md), and [deployment](docs/DEPLOYMENT.md).

## File management

Enable file management in Settings and configure writable libraries as described in the [guide](docs/DEPLOYMENT.md). Inside a library, click the file-management icon beside Select to reveal the toolbar. Select media or folders, choose Cut or Copy, browse to a destination folder, and Paste. Paste operates within the same library and never overwrites an existing item. Ctrl/Cmd+X, C and V work while the toolbar is open, outside text fields and dialogs.

Delete queues recycling by default; permanent deletion requires an explicit choice. New folder only asks for a name. Follow all operations in Background jobs while continuing to browse. Luma updates its index for controlled moves/deletes without scheduling a full folder scan; copy/upload publication indexes only the new path.

Upload opens file/folder pickers and a drop zone, including nested folder drops. Uploads continue after the dialog closes. Recycle bin and Help are at the top of Settings, and About is at the end. Read-only libraries disable file actions.

## Data and backup model

- Originals are read-only and are never rewritten by normal browsing, tagging, or export workflows.
- SQLite is authoritative for indexed records, preferences, and Luma-managed tags.
- Generated thumbnails and previews are disposable and can be regenerated.
- Stop Luma before copying its data directory for a cold backup; include SQLite WAL/SHM files if present.
- Preserve the database when clearing or regenerating the cache.

Database migrations run transactionally at startup. Do not edit an applied migration; add a new migration instead. An unknown migration or checksum mismatch stops startup rather than risking silent schema drift.

## Local development

Requirements:

- .NET SDK 10
- Node.js 24 with npm
- FFmpeg and FFprobe on `PATH` (or configured absolute paths)

Start the API from the repository root:

```sh
dotnet restore Luma.slnx --locked-mode
dotnet run --project src/Luma.Server
```

In a second terminal, start the frontend:

```sh
cd src/Luma.Web
npm ci
npm run dev
```

Open the Vite URL, normally <http://127.0.0.1:5173>. Vite proxies `/api` to the server at `http://127.0.0.1:5080`. In development, the generated OpenAPI document is available at <http://127.0.0.1:5080/openapi/v1.json>.

## Build and test

```sh
dotnet build Luma.slnx -c Release
dotnet test Luma.slnx -c Release --no-build

cd src/Luma.Web
npm run generate:api
npm run lint
npm run build
npm test
```

Browser tests are separate because they create an isolated media fixture and start real backend and frontend processes:

```sh
cd src/Luma.Web
npx playwright install chromium
npm run test:e2e
```

After an API contract change, run `npm run generate:api` and commit both `contracts/luma.json` and `src/Luma.Web/src/lib/api/generated.ts`. Do not edit generated API types manually.

To publish the frontend and server as one process:

```sh
cd src/Luma.Web
npm ci
npm run build:host
cd ../../.local/publish
dotnet Luma.Server.dll --urls http://127.0.0.1:5080
```

## Architecture and contributing

Read [AGENTS.md](AGENTS.md) and [ARCHITECTURE.md](ARCHITECTURE.md) before making changes. The core invariant is that already-indexed browse and search requests use SQLite and generated cache files; they never enumerate or inspect original media.

Useful contracts:

- [Product](docs/PRODUCT.md)
- [API](docs/API.md)
- [Indexing](docs/INDEXING.md)
- [Tagging](docs/TAGGING.md)
- [Media cache](docs/MEDIA-CACHE.md)
- [Performance](docs/PERFORMANCE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Architecture decisions](docs/adr)

Please keep changes focused, preserve public API behavior, add regression coverage for behavior changes, and avoid unbounded media-processing concurrency.

## Release gates

The implementation and local verification are documented in the gate records. Target-device, real-library, and long-session acceptance items that remain open are explicitly tracked there rather than implied as complete.

- [Gate 7](docs/GATE-7.md)
- [Gate 7 handoff](docs/STAGE-7-HANDOFF.md)
- [Gate 7 verification](docs/STAGE-7-VERIFICATION.md)
- [Gate 7 feedback verification](docs/GATE-7-FEEDBACK.md)
- [Gate 7 feedback verification, round 2](docs/GATE-7-FEEDBACK-2.md)
- [Stage 9 help-system requirements](docs/STAGE-9.md)
- [Stage 9 verification](docs/STAGE-9-VERIFICATION.md)

## Project

Source: <https://github.com/sameert89/luma>

Created by Sameer Trivedi.

## Luma 2.0 file management and multiple libraries

Browsing, playback, captions and tags work with read-only originals. Enable
**Settings → General → File management → Enable file management** to allow file
changes. No password or administrator token is required. The switch is saved for
the server and overrides the environment default on later boots.

```yaml
environment:
  Luma__Files__Enabled: "true"
  Luma__PublicOrigin: "https://luma.example.com"
  Luma__Indexing__Libraries__0__Writable: "true"
volumes:
  - /your/photos:/media:rw
```

`Luma__Files__Enabled` defaults to `false`. Each library must also have Writable
set to true and a writable mount. Failed mount checks disable changes for that
library. Fix permissions/mounts and use **Check media mounts** to restore access.
Flick and Panels default to enabled and their settings are independent of file
management. Old `Luma__Files__AccessToken` values are ignored and can be removed.

A library is a server-configured mounted root, not an album. To add another root,
mount it into the container and add the next numbered library configuration:

```yaml
environment:
  Luma__Indexing__Libraries__1__Id: "2"
  Luma__Indexing__Libraries__1__Name: "Comics"
  Luma__Indexing__Libraries__1__Path: "/comics"
  Luma__Indexing__Libraries__1__Writable: "false"
volumes:
  - /your/comics:/comics:ro
```

Keep library IDs stable and unique; use consecutive environment array indexes
starting at 0. Paths are container paths. Restart after changing mounts or roots.
Panels sources select folders within these configured libraries. Use **Panels →
Comic locations** to open the location dialog and browse folders. **Exclude from
Gallery** is checked by default: it skips Gallery discovery for that location and
its descendants, hides already-indexed comic images and comic-only tags, and
omits them from XMP exports. Existing IDs, tags and reading progress are preserved.
Uncheck to include the images in Gallery again; rescan for files added while
excluded. Manually hidden folders remain independent. Overlapping comic locations
share stable library/path identities; any containing exclusion takes precedence.

Panels browses locations and subfolders in order, supports title/series search and
comic tags in **Details**, and shows live discovery progress plus **Background
jobs** in its header. Gallery uses the same header placement. Panels starts with
a horizontal Continue reading row (up to five unfinished books), shows saved
page indicators, and uses Gallery’s rectangular smart covers for folders. The
reader's settings icon and compact page counter open
separate popups for display preferences and page jumping. Pinch zoom retains its
scale; continuous pages flow without added gaps. Progress is saved on page
changes and flushed before exiting, then fetched before the next reader opens.
Phone search expands within its original header row and suggestions use the
header width. Beta.5 adds no database migration.

**Beta.3 upgrades SQLite to schema 33.** Back up the database before upgrading.
To return to beta.2 or an earlier release, restore its matching pre-upgrade
SQLite backup; older binaries cannot open schema 33.

## Standalone user guide

The same guide shown in **Settings → Help** can be hosted independently, with no
Luma server or media access. Run `npm ci && npm run build:help` in `src/Luma.Web`
and serve `help-dist/` from any static web host. Relative assets support a GitHub
Pages project URL such as `https://sameert89.github.io/luma/`.

For GitHub Pages, merge the workflow into the default branch, choose **Settings →
Pages → Build and deployment → GitHub Actions**, then run **Actions → Publish user
guide → Run workflow**. The workflow publishes only the guide. Re-run it after
help changes. See [deployment configuration](docs/DEPLOYMENT.md#application-defaults-and-comic-locations)
for environment defaults, precedence and comic locations.
