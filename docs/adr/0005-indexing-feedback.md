# ADR 0005: Bounded indexing throughput and source presence checks

Status: accepted, stage 4 user feedback follow-up.

## Context

Real-library testing exposed SQLite writer contention and slow preparation. Each unavailable preview wrote to SQLite, every successful processing job slept for 500 ms, and every image started a fresh .NET decoder process.

## Decision

- A configured library does not start its first discovery scan by default. `ScanOnStartup` remains an administrator-controlled opt-in, defaulting to `false`; the libraries home screen offers an explicit per-library start. Opening a library with an existing indexed root does not start a scan.
- Cache HTTP handlers only enqueue a disposable hint into a bounded 256-entry channel. A background consumer checks existing job state before writing; pending/running jobs need no write. Durable discovery jobs remain the source of truth. A full channel drops hints; later visible requests can retry.
- Discovery commits at most 32 entries per transaction, stopping a batch after 25 ms of work, and yields between batches. Folder IDs are cached only within each batch.
- Processing sleeps only when idle. Image decoding reuses at most the configured aggregate number of child processes, each serving one job at a time and recycled after 128 images. Cancellation and deadlines still kill the child. No external service is introduced.
- A separate background worker visits at most 100 indexed records every 10 seconds using the primary-key cursor. It checks known paths without directory enumeration. Deleted paths become missing only when the root remains accessible. Active scans, disabled roots and non-present records are skipped. Access errors do not imply deletion. Browsing never checks originals.

## Consequences

Configuration can declare many libraries without immediately reading them all. A user sees which library is not indexed and starts only the library they intend to use. Explicit scanning remains available for refreshes.

Presence reconciliation is eventual: 177,000 records take about five hours for a full pass at the default rate, plus filesystem time. `SourceVerificationIntervalSeconds` controls the pause. Explicit scans provide faster complete reconciliation and discover new/restored/replaced files. No recursive filesystem watchers or directory-wide periodic rescans are needed. Tags, records and cache survive deletion; default queries hide missing records. An empty but still-mounted root cannot be distinguished from intentional removal of its contents.

Decoder startup overhead is amortized without weakening process isolation. Large or complex originals still consume real decoding time; desktop synthetic measurements do not establish Raspberry Pi throughput.
