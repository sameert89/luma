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
missing records and are for user review. Luma does not delete media.

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

ASP.NET Core can report the same timing for every request via
`Logging:LogLevel:Microsoft.AspNetCore.Hosting.Diagnostics=Information`, but a
gallery requests hundreds of thumbnails per screen, so that writes far more to the
log than the requests being investigated cost. Prefer the threshold.
