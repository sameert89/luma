# Gallery covers

Library/direct-folder summaries contain nullable `coverUrl`. Gate 7 adds persisted user-selected covers and reset through `PUT /api/folders/{id}/cover`, including library roots. See [API](API.md) and [verification](STAGE-7-VERIFICATION.md).

A custom cover must be a present descendant in the same library. SQLite lookup validates current folder membership, revision, encoder and ready thumbnail. A stale/missing selection falls back to automatic while retaining the preference for recovery. Temporarily unavailable sources retain eligible cached covers.

Automatic covers select the newest modified-date/cache-ready descendant with an ID tie-breaker. Library lookup seeks its cover index. Folder lookup checks ancestry and may sort narrowed SQL candidates; large-tree performance is a release check. No original access or processing occurs.

Summaries also carry `coverOverride` (the person chose the cover; it is kept, if stale, for recovery) and `coverImages`: the chosen image alone while it is eligible, otherwise up to five automatic candidates, newest first, with thumbnail `url`, `width` and `height`. `coverUrl` is the first of them. Selection is server-side; rendering is a per-device client setting (Settings → Album covers):

- **Smart** (default): 3+ automatic candidates form a 3–5 tile mosaic sized to the card (three on cards narrower than 240 px), led by the image that suits the large tile best. A single image, including every manual cover, is drawn by aspect mismatch `max(image/card, card/image)`: under 1.35 `object-fit: cover`; under 2.25 a mild crop (at most 1.4× the contain size) over a blurred backdrop; otherwise enlarged 1.25× over a blurred, darkened backdrop. Images are never stretched, never shown as a small contained stamp, and never zoomed beyond these limits.
- **Cropped**: one image fills the card with `object-fit: cover`.

Precedence: manual override (which image) > rendering mode (how) > automatic selection. Reset album cover in folder actions (`PUT … {"mediaId":null}`) clears only the override and appears only when one exists; media files are never touched. Covers store no crop/position data.

Unindexed/unprepared folders have no cover and show a placeholder. Selection/reset is available in media details. Tests verify persistence, unavailable sources, reset, invalid selections and stale fallback. Historical Stage 4 records describe the previous first-eligible automatic ordering; Gate 7 replaces it with modified-date order.
