# Luma

A lightweight, self-hosted photo and video browser for large media collections and low-end hardware.

Gate 7 staging adds complete sort/group/shuffle browsing, photo/video Reels, custom covers, cached random images, metadata import, XMP archives and explicit disliked-path export. Target-hardware release validation remains pending: see [Gate 7 verification](docs/STAGE-7-VERIFICATION.md).

## Quick start with Docker

Docker runs the frontend, API, SQLite, and bundled FFmpeg tools as one service. From the repository root:

```sh
cp .env.example .env
# Edit .env and set LUMA_MEDIA_PATH to your absolute media directory.
docker compose up --build
```

On Windows, copy the file with `Copy-Item .env.example .env`. Set `LUMA_CASE_SENSITIVE=false` for a normal NTFS media directory. Then open http://127.0.0.1:5080. Media is mounted read-only at `/media`; the database and generated cache persist in the `luma-data` volume.

Concrete volume installation, upgrade, cold backup/restore, cache regeneration and recovery: [deployment guide](docs/DEPLOYMENT.md).

## Local development

Requirements: .NET SDK 10.0 (global.json permits installed 10.0 feature bands) and Node.js 24 LTS with npm. Video processing and the backend test suite require FFmpeg and FFprobe on PATH (or configured absolute tool paths). Image processing uses the pinned ImageSharp package. No database service is needed.

Development uses two processes so Vite can provide live frontend updates. In terminal 1, from the repository root, start the API:

```sh
dotnet restore Luma.slnx --locked-mode
dotnet run --project src/Luma.Server
```

In terminal 2, start the frontend:

```sh
cd src/Luma.Web
npm ci
npm run dev
```

Open the URL printed by Vite (normally http://127.0.0.1:5173). Vite proxies `/api` to http://127.0.0.1:5080. Configure a library as described below, start a scan from the sidebar, and browse as indexed items become ready. `GET /api/status` returns readiness and schema version. Development OpenAPI is at http://127.0.0.1:5080/openapi/v1.json.

## Configuration and database

ASP.NET configuration supports JSON, environment variables and command-line arguments. `Luma:DatabasePath` defaults to `.local/luma.db` relative to the server content root (`src/Luma.Server` in development). Environment equivalent: `Luma__DatabasePath`. For example:

```sh
dotnet run --project src/Luma.Server -- --Luma:DatabasePath=/absolute/writable/data/luma.db
```

On Windows use an absolute Windows path. The parent directory is created on startup. Keep the database outside source media; one running Luma instance owns the data directory. Media root and worker configuration is described below.

Startup applies embedded `Data/Migrations/NNNN_Name.sql` files in order within a transaction. Applied checksums are stored in `SchemaMigrations`. Never edit an applied migration: add the next sequential file. Unknown versions and checksum mismatches stop startup. Back up before upgrades; for this foundation, stop the process before copying the data directory (including any SQLite WAL/SHM files). Restore the directory with the process stopped. Generated cache is disposable; keep the database and its application state when regenerating it.

`LUMA_EXPORT_OPENAPI` is an internal generator flag; do not set it when running the application because it skips database initialization.

## Configure and operate indexing

Add a `Luma:Indexing` section to the server configuration, for example:

```json
{
  "Luma": {
    "DatabasePath": "/data/luma.db",
    "Indexing": {
      "CachePath": "/data/cache",
      "Libraries": [
        { "Id": 1, "Name": "Photos", "Path": "/media/photos", "CaseSensitive": true, "ScanOnStartup": false }
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

For the simple Docker setup, use one base media folder and let Luma index all child folders beneath it. The configured `Name` is only the display label shown in the app; use a practical label such as "Media", "Photos" or "Family archive". Advanced deployments may configure multiple libraries with separate IDs and paths, but paths must be distinct; overlapping roots and symlink/reparse roots are rejected. Use absolute Windows paths on Windows and `CaseSensitive: false` for a normal NTFS root. Keep database/cache outside all media roots. Choose stable positive IDs: changing the path or case policy for an existing ID is rejected. Omitting a root disables its work without deleting its records. Originals may be mounted read-only.

Environment variables use double underscores: `Luma__Indexing__Libraries__0__Path`, `Luma__Indexing__Libraries__0__Id`, `Luma__Indexing__CachePath`, etc. `FfmpegPath` and `FfprobePath` default to `ffmpeg` and `ffprobe`. Worker counts range from 1–4; image/video limits may not exceed the aggregate `ProcessingWorkers`. Queue capacity is 16–1024. `CacheQuotaBytes` defaults to 20 GiB (minimum 1 GiB); `ReserveFreeBytes` defaults to 1 GiB (minimum 1 GiB). `VerificationIntervalSeconds` defaults to 300.

With the server running:

```sh
curl http://127.0.0.1:5080/api/indexing
curl -X POST http://127.0.0.1:5080/api/libraries/1/scans -H "Content-Type: application/json" -d '{}'
curl http://127.0.0.1:5080/api/scans/1
curl -X POST http://127.0.0.1:5080/api/scans/1/cancel
```

Use the returned scan ID/Location, rather than assuming it is 1. `GET /api/indexing` also returns each library's latest scan ID. Only one traversal per root may run at once; a conflicting start returns 409. `completed` means discovery and missing-file reconciliation finished; inspect `pending`, `processing`, `ready` and `failed` for processing progress. Cancellation can also stop outstanding processing after traversal completes. Failure history is bounded to 100 entries; follow `nextFailureId` with `?afterFailureId=...` for the next page.

Start with `{ "retryFailures": true }` to explicitly retry permanent failures, or `{ "force": true }` to reprocess same-size/same-mtime edits. Transient failures retry three times after 5 seconds, 30 seconds and 5 minutes. An unavailable source waits for the next scan. Routine scans preserve IDs/preferences at an unchanged path; moves receive new IDs and retain the former record as missing. No source file is rewritten or deleted.

Shutdown interrupts active work; startup releases job claims and retraverses interrupted scans. A failed/incomplete traversal cannot mark unseen files missing. Cache verification runs in the background: deleted or corrupt current cache files are regenerated when originals are available. Quota pressure pauses generation; maintenance removes obsolete files and evicts previews first. Evicted entries are not automatically regenerated in a loop. Indexing prepares thumbnails and embedded keywords; large image previews are prepared when an image is opened, which keeps the cache to a few GB for a quarter-million photos. `dotnet run --project tests/Luma.Tools -c Release -- index-benchmark <work dir> 4 <photo folder>` measures first-index throughput on real media and target hardware. Diagnostics use stable codes and never expose absolute source paths or raw media-tool output.

See [stage 3 verification](docs/STAGE-3-VERIFICATION.md), [indexing](docs/INDEXING.md) and [cache](docs/MEDIA-CACHE.md) for details. The sidebar shows scan state and can start or cancel a scan.

## Verification

From the root:

```sh
dotnet build Luma.slnx -c Release
dotnet test Luma.slnx -c Release --no-build
cd src/Luma.Web
npm run generate:api
npm run lint
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

The browser checks generate an isolated 1,500-item cache fixture, then start a real server and the production frontend preview on ports 5180 and 4173. They check desktop/mobile gallery and tag workflows, cache-only previews, keyboard focus, scroll restoration, and bounded virtualization. Artifacts appear in `src/Luma.Web/test-results/`.

`npm run generate:api` rebuilds the server with [ASP.NET build-time OpenAPI generation](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/openapi/overview?view=aspnetcore-10.0), then generates `src/lib/api/generated.ts`. Commit both that file and `contracts/luma.json` after contract changes. Do not edit generated types. Numeric JSON fields are strict numbers. CI runs locked dependency restore, both builds/test suites and accessibility lint on Linux and Windows, checks generated-contract drift, and runs Chromium smoke tests on Linux.

The toolchain uses the [Vite Node requirements](https://vite.dev/guide/) and [Tailwind Vite integration](https://tailwindcss.com/docs/installation/using-vite). ESLint 9 and TypeScript 5.9 are retained for compatibility with the accessibility plugin and OpenAPI generator; npm may print ESLint's upstream support notice. Lockfiles make installs reproducible.

## Serve the built application from one process

```sh
cd src/Luma.Web
npm ci
npm run build:host
cd ../../.local/publish
dotnet Luma.Server.dll --urls http://127.0.0.1:5080
```

This copies the generated frontend to the host's `wwwroot` and publishes to `.local/publish`. Run from that directory so configuration and static files resolve correctly. Set an absolute `Luma__DatabasePath` for persistent deployment data. The Docker setup above packages the same single-process deployment with FFmpeg and read-only media mounting. Unknown `/api` routes always return JSON errors; frontend routes return the shell. This version is intended for a private/local network and has no authentication.

## Project contracts

- [Stages 4–5 verification and performance evidence](docs/STAGES-4-5-VERIFICATION.md)
- [Delivery plan and stage completion criteria](docs/DELIVERY-PLAN.md)
- [Product requirements](docs/PRODUCT.md)
- [Architecture](ARCHITECTURE.md)
- [Target hardware and performance requirements](docs/PERFORMANCE.md)
- [Contributor instructions](AGENTS.md)

## Gate 7 staging workflows

See the [staging handoff](docs/STAGE-7-HANDOFF.md), [verification results](docs/STAGE-7-VERIFICATION.md), and [Docker deployment/recovery guide](docs/DEPLOYMENT.md).

Filters expose library-scoped keyword/tag search, all/any tag matching, availability, six sorts and folder/date/type grouping. Sort direction is visible on mobile. Reels defaults to videos and GIFs when entered; its filter sheet supports Photos, GIFs and mixed media. Folders can be hidden from their folder actions and shown again from Settings. Luma works over HTTP; installation/shortcut options are described in the deployment guide. Use trusted HTTPS for full LAN PWA support (HTTP localhost also qualifies on the browser’s own device); see [Deployment](docs/DEPLOYMENT.md#https-and-installing-luma-as-an-app). Viewers navigate their active query. Collections opens library folders/albums, paginated tags and favourites.

Media details select/reset folder/library covers and explicitly import embedded/optional-sidecar tags or download XMP. Bulk tag details support metadata exchange for up to 500 selected items. Settings exposes whole-library XMP and disliked-path exports. Jobs report per-item findings, share a 1 GiB export quota and expire downloads after 24 hours. Originals stay read-only; archives include merge instructions and relative-path manifests.

`GET /api/random` returns filtered cached JPEG content for embedding; for example `/api/random?tag=wallpaper&orientation=landscape`. It uses no-store and reports 404 for empty results. A photo without a prepared preview is served as its original (and queued for a preview); 503 means neither is available.

Build the staging image with `docker build -t luma:gate7-staging .`. Actual Pi deployment, real-library and long-session measurements are separate release requirements.

### Installing Luma on your home screen

Luma works over HTTP, but full PWA features require trusted HTTPS on LAN addresses.
HTTP localhost/127.0.0.1 qualifies only on the device running the browser; your server’s
LAN IP does not. Over HTTP you can try the browser’s Add to Home Screen menu, which
may create an online-only shortcut instead of an installed PWA. On iPhone/iPad use
Share → Add to Home Screen. Over trusted HTTPS use Install app or Add to Home Screen.
No installation panel is displayed in Settings. See [local HTTPS setup](docs/DEPLOYMENT.md#https-and-installing-luma-as-an-app)
for Kestrel certificates and reverse-proxy configuration, including client CA trust.
