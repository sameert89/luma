# 0002 — Bounded media tools and durable indexing

Status: accepted for stage 3.

Updated by [ADR 0005](0005-indexing-feedback.md): decoder processes now serve up to 128 jobs before recycling, preserving killable deadlines while amortizing startup cost.

Keep orchestration in the existing ASP.NET Core process. SQLite owns pending work, claims, scan progress, failures, identity and cache accounting. A bounded discovery channel applies backpressure; processing workers claim one durable job at a time rather than loading the pending queue. Short transactions keep writer ownership brief. Indexes cover root/path identity, reconciliation, failure pages, pending jobs by media type and expired leases.

Use FFprobe and FFmpeg for video metadata and a single poster frame. Use ImageSharp 3.1.12 for the initial image formats, EXIF orientation, first-frame/page selection, predecode dimension checks and the exact JPEG/WebP quality settings. These are substantive decoder/encoder responsibilities; implementing them with custom format parsers would be harder to maintain. No browser request invokes either processor.

Run image work as an internal `--process-image` invocation of the existing application binary. This small command does not start the HTTP host, initialize SQLite or start services. Process isolation permits termination during synchronous decoder/resize work and releases decoder memory after each job. It is not a separate deployed service. Each job runs its child processes sequentially and remains subject to the aggregate and media-type limits. Pass arguments through `ProcessStartInfo.ArgumentList`, disable shell execution, bound captured output to one MiB total, and kill the process tree on cancellation/deadline.

ImageSharp uses one processing thread, a 16 MiB retained pool and a 400 MiB per-allocation limit, with decoder-assisted downsampling. These are guards, not a measured RSS guarantee; the 100-megapixel check precedes full image decoding. The parent enforces the complete job deadline. Defaults are one image worker, one video worker and two aggregate jobs. A job reserves 48 MiB for its two bounded outputs and optional extracted frame before generation; quota and disk reserve are checked before reservation.

ImageSharp 3.1.12 is pinned with no build-time key requirement; its upstream split license is included in the package. Version 4 requires a build-time license and is not used. Do not suppress license validation when upgrading. Tool packaging for the Raspberry Pi container remains stage 7 work.

References: [ImageSharp 3.1.12 package](https://www.nuget.org/packages/SixLabors.ImageSharp/3.1.12), [image identification/loading](https://docs.sixlabors.com/articles/imagesharp/loadingandsaving.html), [FFprobe](https://ffmpeg.org/ffprobe.html), [FFmpeg](https://ffmpeg.org/ffmpeg.html). The current ImageSharp documentation also describes 4.x features; the implementation uses only APIs available in the pinned 3.1.12 package.
