# Gallery covers

Library/direct-folder summaries contain nullable `coverUrl`. Gate 7 adds persisted user-selected covers and reset through `PUT /api/folders/{id}/cover`, including library roots. See [API](API.md) and [verification](STAGE-7-VERIFICATION.md).

A custom cover must be a present descendant in the same library. SQLite lookup validates current folder membership, revision, encoder and ready thumbnail. A stale/missing selection falls back to automatic while retaining the preference for recovery. Temporarily unavailable sources retain eligible cached covers.

Automatic covers select the newest modified-date/cache-ready descendant with an ID tie-breaker. Library lookup seeks its cover index. Folder lookup checks ancestry and may sort narrowed SQL candidates; large-tree performance is a release check. No original access or processing occurs.

Unindexed/unprepared folders have no cover and show a placeholder. Selection/reset is available in media details. Tests verify persistence, unavailable sources, reset, invalid selections and stale fallback. Historical Stage 4 records describe the previous first-eligible automatic ordering; Gate 7 replaces it with modified-date order.
