# Luma

Luma is a lightweight, self-hosted photo and video browser built for large media libraries and modest hardware. It keeps originals read-only, stores its index and tags in SQLite, and serves generated thumbnails and previews from a disposable cache.

## Features

- Fast folder and gallery browsing backed by SQLite and generated cache files
- Photo and video viewing, slideshows, and a vertical Reels mode
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

Luma does not start an expensive full scan unless you request one (or explicitly enable startup scanning). Open the configured library and choose the indexing metadata mode to begin.

See the [deployment guide](docs/DEPLOYMENT.md) for upgrades, HTTPS/PWA setup, backups, restoration, cache recovery, health checks, and direct Docker operation.

## Configuration

The Compose defaults are suitable for a single media root. The most commonly changed values are:

| Variable | Purpose | Default |
| --- | --- | --- |
| `LUMA_MEDIA_PATH` | Absolute host path mounted read-only as the media library | Required |
| `LUMA_CASE_SENSITIVE` | Whether media paths use case-sensitive identity | `true` |
| `LUMA_SCAN_ON_STARTUP` | Start a full scan when the service starts | `false` |

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
