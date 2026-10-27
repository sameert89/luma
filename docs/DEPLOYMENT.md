# Staging installation and recovery

Run one Luma container against one persistent data volume. The deployment target is
Raspberry Pi 5 (4 GB), Debian 13 ARM64, USB 3 Btrfs RAID1 storage and gigabit LAN.
Local Windows or emulated ARM64 checks do not certify this target.

## Install

On Debian, install Docker Engine and the Compose plugin using Docker's supported
installation instructions. Put this checkout on writable storage, copy
`.env.example` to `.env`, and set `LUMA_MEDIA_PATH` to the mounted media directory
(for example `/mnt/media/photos`). Ensure the Btrfs filesystem is mounted before
starting Luma. Keep `LUMA_CASE_SENSITIVE=true` for Linux filesystems and
`LUMA_SCAN_ON_STARTUP=false` for explicit initial indexing.

```sh
docker compose config
docker compose build --pull
docker compose up -d
curl --fail http://127.0.0.1:5080/api/status
docker compose logs --tail=100 luma
```

Open port 5080 on the private LAN. `/media` is read-only; `/data` holds SQLite,
generated cache and downloadable exports. Use a stable mount path and stable
library IDs. The container includes FFmpeg/FFprobe. Start initial indexing from
the library card. Defaults use one discovery worker and two processing workers
(one image and one video). Monitor scan failures, cache pressure, free disk space,
temperature and browse latency; reduce worker limits if the target budgets fail.

For an ARM64 staging artifact on a machine with Buildx:

```sh
docker buildx build --platform linux/arm64 --load -t luma:staging-arm64 .
```

Build and run natively on the Pi for actual acceptance. Preserve the image digest,
Git revision, configuration and measurement results. Never infer codec support
on real Android/iOS clients from Chromium device emulation.

## HTTPS and installing Luma as an app

Luma runs over plain HTTP, including LAN addresses, without mandatory HTTPS redirection.
Full PWA installation capabilities, service workers and offline startup require a secure
context: trusted HTTPS, or HTTP `localhost`/`127.0.0.1` on the browser's own device.
A private LAN IP such as `http://192.168.1.20:5080` and an HTTP `.local` hostname do
not qualify. Adding a manifest, changing `display`, or adding a home-screen icon cannot
lift the service-worker restriction. Some browsers allow manually saving HTTP sites as
home-screen shortcuts; their window mode depends on the browser and they remain online-only.
Use the browser's Install app/Add to Home Screen controls; there is no installation
panel in Settings. On iPhone/iPad use Share → Add to Home Screen.

An installed app takes its status bar and splash colours from the web manifest it was
installed with, not from the page, so the build writes one manifest per theme
(`/manifest-<theme>.webmanifest`, identical apart from `theme_color`/`background_color`
and sharing the same `id`) and the page points at the one for the chosen theme. Browser
chrome follows the `theme-color` meta immediately; an installed app follows on a later
launch, whenever the browser refreshes its copy of the manifest. iOS accepts only
`default`, `black` and `black-translucent` for its status bar, so it stays black there.
The server may remain HTTP behind a trusted HTTPS reverse proxy; the browser-facing URL
is what determines PWA capability. HTTPS also enables HTTP/2, which multiplexes video range requests
and thumbnails over one connection instead of queueing behind HTTP/1.1's six-connection
limit, noticeably reducing seek and reel-switch stalls.

Either terminate TLS in Luma itself or put it behind a reverse proxy.

**TLS in Luma (Kestrel).** Mount a certificate and key (PEM) and add an HTTPS URL. With
Compose, add to the `luma` service:

```yaml
ports:
  - "5443:5443"
environment:
  ASPNETCORE_URLS: "https://+:5443;http://+:5080"
  ASPNETCORE_Kestrel__Certificates__Default__Path: /certs/luma.crt
  ASPNETCORE_Kestrel__Certificates__Default__KeyPath: /certs/luma.key
  # Optional: send plain-HTTP visitors to HTTPS.
  Luma__Https__RedirectHttp: "true"
volumes:
  - /path/to/certs:/certs:ro
```

The certificate must be trusted by every device that opens Luma (for example from a
private CA such as `mkcert`, or a public certificate for a DNS name you control); phones
will not install an app from a site with a certificate warning. A `.pfx` file works too:
set `Path` to it and `ASPNETCORE_Kestrel__Certificates__Default__Password` instead of
`KeyPath`.

**Reverse proxy (Caddy, nginx, Traefik).** Keep Luma on HTTP port 5080 and let the proxy
terminate TLS. Set `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true` so Luma honours
`X-Forwarded-Proto`/`X-Forwarded-For`, and leave `Luma__Https__RedirectHttp` unset (the
proxy owns redirects). The proxy must pass `Range`, `If-Range` and `If-None-Match`
request headers through unchanged and must not buffer `/api/media/*/original`
responses (for nginx: `proxy_buffering off;` on that location). For example, Caddy:

```text
luma.example.lan {
  tls internal
  reverse_proxy 127.0.0.1:5080
}
```

For that private `.lan` example, configure local DNS to point the hostname at your
server and install Caddy's local CA root certificate into each client device's trusted
certificate store. `tls internal` does not produce a publicly trusted certificate; merely
clicking through a certificate warning is not sufficient. A public DNS name with a
publicly trusted certificate is another option and does not require exposing Luma publicly.

Once served over HTTPS, use the browser's **Install app** / **Add to Home Screen**. The
installed app opens standalone, uses the Luma icon and follows the chosen theme colour.
Its service worker only caches the app shell for offline start; media and API requests
always go to the server. Video keeps playing with the screen off or in another app where
the platform allows it, and exposes lock-screen/headset controls through Media Session;
picture-in-picture is offered where the browser supports it.

## Optional file management and uploads

The default media mount remains read-only. File management is a single-user
preference, disabled by default. Turn on **Settings → General → File management →
Enable file management**. There is no administrator token or per-tab unlock.
The saved server choice overrides `Luma__Files__Enabled` on later boots. Old
`Luma__Files__AccessToken` values are ignored and can be removed.

Each editable library also needs Writable enabled and a writable media mount.
For example, create `compose.files.yaml` alongside `docker-compose.yaml`:

```yaml
services:
  luma:
    environment:
      Luma__Files__Enabled: "true"
      Luma__Indexing__Libraries__0__Writable: "true"
      Luma__Uploads__Concurrency: "2"
      Luma__Uploads__MaxFileBytes: "107374182400"
      Luma__Uploads__StagingQuotaBytes: "214748364800"
    volumes:
      - "${LUMA_MEDIA_PATH:?Set LUMA_MEDIA_PATH}:/media:rw"
```

```sh
docker compose -f docker-compose.yaml -f compose.files.yaml config
docker compose -f docker-compose.yaml -f compose.files.yaml up -d
```

Startup and explicit mount checks disable file changes on read-only or failed
roots. A brief floating notice explains that browsing/playback still work. Full
mount details remain in File management; after correcting permissions, select
**Check media mounts**. Indexed capability reads never access originals.

The example allows 100 GiB files and 200 GiB of active upload reservations. The
default for each limit is 1 TiB. Reservations do not reserve physical disk space;
monitor actual media-volume space. Uploads allow at most 128 active sessions and
1–4 concurrent chunk transfers. Native folder picking preserves relative paths.
After closing or refreshing Luma, use **Choose file to resume** beside an upload in
Background jobs or the upload window. Choose the unchanged original file; Luma
checks its name, size and modification date and resumes the server’s saved byte
position. Reselecting a batch in its original destination also resumes matching
entries. Older duplicate queue entries are checked against the server before
choosing a session; missing aliases are retired without creating more uploads.
Temporary database, capacity and path contention waits automatically with bounded
backoff. Pause and Cancel interrupt these waits; write-access and recovery errors
still require attention.

Preserve same-origin browser headers behind a proxy. Cross-site requests remain
rejected. Allow PATCH bodies of at least 8 MiB (for nginx, `client_max_body_size
9m;`) and pass Range/If-Range headers unchanged. Do not automatically retry write
requests. The upload protocol is `/api/files/uploads`, not tus.

Gallery's Manage files and Recycle bin controls expose same-library moves,
directory creation, recycling, explicit permanent deletion, restore and purge.
Destinations are never overwritten. Cross-library moves are not supported.
Recycle retention and automatic cleanup are not implemented yet: use explicit
purge and monitor space. A recycle bin is not a backup.

### Interrupted file operations and backup consistency

Background jobs shows unresolved file operations as needing attention. Open their
recovery dialog to review source, staging and destination evidence before choosing
a supported action. Retries continue from durable checkpoints; alternate restore
destinations must be unused. A missing mount, changed source or collision can keep
the library reserved. Restore the original mount or inspect the files before
retrying. Do not remove journal rows or internal directories to clear a reservation.

The media volume contains `.luma-trash`, `.luma-operations` and `.luma-uploads`.
They hold recoverable content, operation staging and upload bytes, respectively;
they are not generated cache. Back them up along with originals and SQLite from
the same stopped-service checkpoint. Pause uploads and let operations finish when
possible, then stop Luma before copying either volume. Restoring SQLite without
matching media-volume state can leave operations needing explicit recovery.
Never restore just a pre-deletion database over media that has since been purged.

## Upgrade and consistent cold backup

Make a backup before upgrading. Stop Luma before copying SQLite; a live copy of
`luma.db` alone is not consistent in WAL mode. Include any WAL/SHM files, application
state and exports; cache can be omitted because it is disposable. The cursor
signing key, tags, preferences and chosen covers are in SQLite.

From the checkout on a Linux Docker host:

```sh
mkdir -p backups
container_id=$(docker compose ps -aq luma)
data_volume=$(docker inspect "$container_id" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')
test -n "$data_volume"
docker compose stop luma
docker run --rm -v "$data_volume:/data:ro" -v "$PWD/backups:/backup" \
  alpine tar -C /data --exclude='./cache' -czf /backup/luma-data.tgz .
```

Save the revision/image digest, Compose file, `.env` and library configuration
alongside the archive. These include private source paths. Verify the archive
with `tar -tzf backups/luma-data.tgz`. Keep the stopped service stopped while
changing versions, then:

```sh
docker compose build --pull
docker compose up -d
curl --fail http://127.0.0.1:5080/api/status
docker compose logs --tail=100 luma
```

Startup applies checksum-checked migrations transactionally. A failure prevents
startup; inspect logs and retain the backup. Do not edit migration history or
manually patch the schema. Do not run an older binary against a newer database.
Rollback means restoring the pre-upgrade database and its matching image.

## Restore into a fresh volume

Stop the service. Keep the previous volume as a rollback copy. Restore to a new,
empty volume instead of unpacking over an existing database:

```sh
docker compose stop luma
docker volume create luma-restored
docker run --rm -v luma-restored:/data -v "$PWD/backups:/backup:ro" \
  alpine tar -xzf /backup/luma-data.tgz -C /data
```

Create `compose.restore.yaml`:

```yaml
volumes:
  luma-data:
    external: true
    name: luma-restored
```

Run `docker compose -f compose.yaml -f compose.restore.yaml up -d` using the
matching image and original library configuration. Verify readiness, tags,
preferences, chosen covers and cached browsing. Keep using that override until
you intentionally change the volume configuration. An export job interrupted
by backup/restart is reported as failed with `interrupted`; submit it again.

## Cache loss and failures

The cache directory may be removed with Luma stopped; preserve SQLite. Start
Luma and run an explicit force scan to regenerate the whole selected library:

```sh
curl -X POST http://127.0.0.1:5080/api/libraries/1/scans \
  -H 'Content-Type: application/json' -d '{"force":true}'
```

Use the actual library ID and inspect the returned scan Location. Background
cache verification and visible-item demand also recover individual missing or
corrupt representations. Recovery needs originals to be available and adequate
cache quota/free space. A cache miss returns a placeholder/503 and queues work;
it never decodes the original inside a browse request.

An unavailable media mount leaves indexed gallery/search/detail and intact cached
previews usable. Original downloads, video streaming and explicit metadata imports
report source failures. Restore the same mount, then rescan. An incomplete or failed
scan must not mark unseen records missing. Inspect per-scan failures and retry
permanent processing errors with `{"retryFailures":true}` after correcting the cause.

Metadata exports use a separate 1 GiB quota and expire after 24 hours. Failed quota
jobs are visible; download needed exports before expiry, then retry after retention
cleanup frees space. Imports merge application tags and never write originals.
XMP archives include external merge instructions; disliked-path exports include
missing records and are for user review. Metadata imports and exports do not
delete originals; explicitly enabled file management can recycle or delete them.

Target acceptance must exercise restart, an upgrade from the previous schema,
backup/restore, cache loss and unavailable sources on the Pi with the real mounts.
See [Gate 7 verification](STAGE-7-VERIFICATION.md) for evidence and pending checks.

## Slow request logging

Requests slower than `Luma:SlowRequestMs` (default 500) are logged once each at
`Warning`, naming the route pattern, the status and the elapsed time. Everything
faster is silent, so this is safe to leave on.

```sh
Luma__SlowRequestMs=250   # tighten while investigating
Luma__SlowRequestMs=0     # turn it off
```

The route pattern is logged rather than the path, so one slow endpoint produces
one line per request rather than one per media id, and no file name from the
library reaches the log.

Each line also says what the request arrived to:

```
GET /api/folders took 64073 ms (status 499, over the 500 ms threshold;
  on arrival 31 requests were in flight, 27 for this path;
  thread pool 0 of 32767 workers free, 118 queued).
```

Read those counts first. A request that was slow on its own is an expensive
query, and the fix is in the query. A request that arrived to find twenty copies
of itself already running is a request storm, and the fix is in whatever is
asking: the copies compete for the same cores and the same disk, each making the
next slower, and the duration says more about the pile than about the work. A
thread pool with no free workers and a long queue means requests are waiting for
a thread rather than for the database, which points at blocking work on the
thread pool rather than at any one endpoint.

ASP.NET Core can report the same timing for every request via
`Logging:LogLevel:Microsoft.AspNetCore.Hosting.Diagnostics=Information`, but a
gallery requests hundreds of thumbnails per screen, so that writes far more to the
log than the requests being investigated cost. Prefer the threshold.

## Captions in 2.0

Captions work with a read-only media mount. CC is off by default and no subtitle
inspection or extraction runs until the viewer enables it. For `movie.mkv` or
`movie.mp4`, use `movie.srt` in the same folder (`.SRT` is also recognized), or an
embedded SubRip/SRT stream. A container's other text/image subtitle codecs are
not automatically converted to SRT. ASS/SSA, image subtitles, author fonts,
colors, markup, positioning and effects are unsupported; the player renders
plain captions. There is no OCR, speech recognition or external subtitle search.

FFprobe discovers supported streams and FFmpeg copies only the chosen embedded
SRT stream; the video itself is not transcoded. Both binaries must be installed
(the container already includes them). SRT input accepts UTF-8 and BOM-marked
UTF-16 up to 4 MiB. Native browser text tracks display converted WebVTT above the
playback bar. Caption settings selects between available tracks. Changing videos
starts with captions off. An error preparing subtitles does not stop playback.

Everything generated lives in `Luma:Indexing:CachePath/captions`: temporary
extraction files, retained raw SRT, converted VTT and manifests. The dedicated
cache is limited to 128 MiB and 512 entries, and uses least-recently-used eviction;
missing captions are rebuilt only after explicit CC use. A missing VTT can be
rebuilt from retained SRT without re-extraction. This cache is disposable and may
be omitted from backups. No generated subtitle is written beside source media.

## Application defaults and comic locations

A library is a configured media root. Give every root a unique stable ID, mount
its directory, and configure consecutive `Luma__Indexing__Libraries__0`, `__1`,
`__2`, etc. entries with `Id`, `Name` and container `Path`. See the multiple-root
example in [README](../README.md#luma-20-file-management-and-multiple-libraries).

Panels' first visit asks for comic locations within those libraries. An empty
relative path selects a whole root. Saving locations queues a recursive scan for
supported archives; image folders are included only when explicitly selected.
Later visits open the saved bookshelf. Use **Comic locations** to change or
rescan sources. This needs read access to originals and write access to Luma's
data/cache directory; it does not require a writable media mount or file management to be enabled. Removing a source hides its books while preserving metadata and reading
progress for re-adding it.

```yaml
environment:
  Luma__Ui__FlickEnabled: "true"
  Luma__Ui__PanelsEnabled: "true"
  Luma__Ui__Preferences__luma-theme: "forest"
  Luma__Ui__Preferences__luma-reels-sort: '{"sort":"modified","order":"desc"}'
  Luma__Ui__Preferences__luma-reels-state: '{"muted":true,"autoScroll":false}'
  Luma__Ui__Preferences__luma-panels-reader-defaults: '{"mode":"single","fit":"screen","direction":"ltr"}'
  Luma__Panels__Sources__0__LibraryId: "2"
  Luma__Panels__Sources__0__RelativePath: "Manga"
  Luma__Panels__Sources__0__ImageFolders: "false"
  Luma__Panels__Sources__0__ExcludeFromGallery: "true"
```

**In-app choices take precedence.** Global Flick/Panels switches are in Settings
→ General → Applications independently of file management; they are stored in SQLite
and override environment flags on subsequent boots. Disabling Panels pauses new
comic jobs. Source environment entries seed a fresh installation only; saved
Comic locations override them thereafter. Other UI choices are per-browser and
use the environment value only when no local choice exists. These defaults do
not overwrite existing users' preferences. Restart after editing environment
configuration.

Supported `Luma__Ui__Preferences__` keys and values:

| Key                                            | Value                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `luma-theme`                                   | Theme ID, for example `forest`                                                                               |
| `luma-appearance-v2`                           | JSON appearance object: `background`, `blur`, `opacity`, `darkness`, `motion`, `splashes`                    |
| `luma-album-covers`                            | `smart` or `cropped`                                                                                         |
| `luma-reels-sort`                              | JSON `sort` and `order`                                                                                      |
| `luma-slideshow-seconds`                       | Slideshow interval in seconds                                                                                |
| `luma-video-autoplay`                          | `true` or `false`                                                                                            |
| `luma-viewer-fill`, `luma-reels-fill`          | `true` or `false`                                                                                            |
| `luma-show-filters`, `luma-reels-show-filters` | `true` or `false`                                                                                            |
| `luma-reels-state`                             | JSON `muted` and `autoScroll`                                                                                |
| `luma-panels-reader-defaults`                  | JSON `mode` (`single`/`continuous`), `fit` (`screen`/`width`/`height`/`original`), `direction` (`ltr`/`rtl`) |

Use the JSON shape stored under the matching browser storage key to reproduce
complex appearance/cover settings. Uploaded background image bytes remain local
to that browser; environment configuration selects built-in backgrounds. Saved
per-book reader preferences override reader defaults. Secrets are never exposed
through UI defaults.

When an HTTPS reverse proxy changes the internal origin, modern browsers send
`Sec-Fetch-Site: same-origin`, which captions and file operations accept. For
clients without Fetch Metadata, set `Luma__PublicOrigin` to the exact trusted
browser-facing origin, for example `https://luma.example.com`. Cross-site
requests remain rejected.

## Standalone help deployment

Run `npm ci` and `npm run build:help` in `src/Luma.Web`. Upload the generated
`help-dist/` directory to a static host. It contains the same guide as the app,
with relative assets, no API connection and no server/data dependencies.
The **Publish user guide** GitHub Actions workflow builds and deploys it to Pages
on manual dispatch. After merging, select **GitHub Actions** as the repository's
Pages source and run that workflow. Rebuild/redeploy whenever the guide changes.
CI builds the guide on every change so both copies stay buildable.

### Comic visibility and beta.3 rollback

Comic locations always open in a dialog. Each source defaults to **Exclude from
Gallery**, including sources created before beta.3. Exclusion skips Gallery scans
and hides existing media and exclusive tags from Gallery results and XMP export.
It preserves stable media IDs, tags and reading progress; it does not move files.
Uncheck to include images in Gallery again, then rescan to discover new images.
Existing manual hidden-folder choices are independent. For overlapping comic
sources, any containing source with exclusion enabled hides that subtree. Two
locations in the same library queue separately and use the same comic path IDs.
Server-configured library roots must remain non-overlapping.

Beta.3 adds migration 33 (comic tags and source visibility). Stop Luma and back up
SQLite before upgrading. Returning to beta.2 or older requires restoring the
matching database backup; the migration guard rejects newer schemas. Keep a
matching original-media backup when rolling back file operations as well.


### Schema 34 and replacement upgrades

Beta.10 adds schema 34 for durable replacement dependencies. Stop Luma and back up SQLite together with the matching originals, trash and staging before upgrading. An older binary refuses schema 34; rollback requires restoring its matching pre-upgrade database and media-volume backup.

Upload, Move and Copy present Replace/Skip decisions for real destination conflicts. Replace preserves the previous item in the recycle bin; it does not merge an existing destination folder's contents. A batch choice applies only to that batch. Independent uploads no longer reserve the entire library, while overlapping paths and unresolved operation evidence remain protected.

## Building on a Raspberry Pi or a small VPS

The Docker build now finishes .NET publishing before compiling the frontend.
Previously BuildKit could run both compilers at once. NuGet restore is cached
separately from backend source, so editing a C# file no longer restores every
package. npm dependencies also keep their own layer. .NET publishing uses one
MSBuild node, two reported processors and no persistent compiler server. The
frontend uses a 768 MiB V8 old-space limit and two native worker threads.

These are build-only settings; they do not limit the running Luma server.
`NODE_BUILD_HEAP_MB` can be overridden with a Docker build argument if a larger
frontend needs more heap. It limits one part of each Node process, **not total
build memory**. Native allocations, NuGet, npm, Docker and filesystem cache also
need room. Package installation and runtime image preparation may still overlap;
the two application compilation steps cannot. Changes to server publish output
also invalidate the frontend build step because of that ordering dependency.

For a host-wide safeguard, use a dedicated BuildKit container with a memory limit.
For example, on a host with enough free memory to reserve 2 GiB for builds:

```sh
# Run from the repository root; create this builder once.
docker buildx create --name luma-small --driver docker-container \
  --driver-opt memory=2g,memory-swap=2g \
  --buildkitd-config docker/buildkitd.toml

docker buildx build --builder luma-small --load -t luma:local .
```

The equal memory and memory-swap limits disable swap for this builder. A build
that exceeds the budget can fail without exhausting all host RAM. Choose a budget
that leaves room for the OS and running services. The supplied BuildKit config
runs one build step at a time. This builder only applies when explicitly selected;
creating it does not change Coolify's builder. Coolify must use this builder or
have equivalent limits configured for its build service. Runtime container limits
alone do not constrain image builds.

### Investigating a freeze

Concurrent compilers and uncapped builds are credible sources of memory pressure,
but the Dockerfile cannot prove an OOM caused a particular freeze. No Pi crash log
or memory trace was available for this change. A clean build consumes much more
CPU, RAM and disk I/O than a cached retry, which can explain why retries behave
differently without establishing the cause.

Before another build, capture evidence from a second terminal:

```sh
free -h
swapon --show
vmstat 2
# In another terminal, watch current-boot kernel messages (no persistent journal needed).
sudo dmesg -wT
# While using the dedicated builder:
docker stats
# On Raspberry Pi OS, if vcgencmd is installed:
vcgencmd get_throttled
vcgencmd measure_temp
```

Look for OOM-killer messages, sustained swap activity, high I/O wait, undervoltage
or thermal throttling. Save the terminal output remotely if the host may need a
hard reset. Compare a first uncached build and a warm rebuild using
`--progress=plain`; keep the same memory budget for both. Do not prune all caches
on the live server just to reproduce a cold build. If the host cannot spare the
build budget, build the ARM64 image on another machine and deploy that image.

References: [BuildKit parallelism](https://docs.docker.com/build/buildkit/configure/),
[builder container limits](https://docs.docker.com/build/builders/drivers/docker-container/),
[.NET publish options](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-publish).

### PDF comics in Panels

PDFs can be discovered from the same Panels locations as CBZ/CBR comics. Run
comic discovery after adding them. The existing reader handles navigation, zoom,
reading direction and progress. Password-protected PDFs are not supported.

Docker includes Poppler (`pdfinfo` and `pdftoppm`) for page counts and cached
covers. Native installations must install `poppler-utils` on Debian/Ubuntu or
Poppler on Windows and put its binaries on PATH. Custom binary locations can be
set with `Luma:Indexing:PdfinfoPath` and `Luma:Indexing:PdftoppmPath`.
Inspection and cover rendering have 30-second deadlines; covers use the shared
processing slots and a 1,024-pixel longest edge. Pages are not extracted on the
server. The reader loads PDF.js only when opening a PDF and fetches the document
from Luma with range requests; fonts, CMaps and decoders are hosted locally.
Rendered canvases are limited to four million pixels and a 2,400-pixel longest
edge, with only mounted reader pages retained. Very complex documents can still
consume additional browser memory and take longer to render.
