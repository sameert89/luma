# ADR 0010: Opt-in source verification

Background source verification is disabled by default and controlled by a persisted server-wide setting exposed in the Settings UI. When disabled, the worker performs no media queries or source-path checks; it only observes the in-memory preference between bounded timer intervals. Explicit scans continue to reconcile missing media.

When enabled, the existing worker behavior remains: visit at most 100 indexed records per configured interval, check exact known paths without enumerating directories, skip active scans and disabled roots, and never treat an unavailable root as deletion. The preference is stored in `ApplicationState`, avoiding a dedicated schema or infrastructure component.

This keeps idle database and disk activity opt-in on low-end self-hosted hardware while preserving automatic deletion detection for people who want it.
