# Automatic album covers

Stage 4 summary endpoints now include nullable `coverUrl` on library and direct-folder summaries. The generated OpenAPI schema is the contract.

Covers select an indexed, processed, present descendant whose current source revision and encoder have a ready generated thumbnail. Lookup uses partial processed-media and ancestry indexes and stops at the first eligible thumbnail. It does not sort a whole subtree, access originals, or issue an API query per displayed card.

An unindexed/unprepared library, a stale revision, or missing media yields no cover. Temporarily unavailable roots do not discard ready cached covers. The UI shows preparation state when no thumbnail is available.

This defines automatic cover behavior for the implementation rather than the modified-date ordering proposed for future covers in API.md. User-selected covers remain stage 7.
