# Stage 9 — Help and control discoverability handoff

Status: implemented locally on 2026-09-19; see [verification](STAGE-9-VERIFICATION.md). No release version has been assigned.

## Objective

Make Luma's existing controls discoverable without crowding browsing toolbars or reducing the media viewport. Users should be able to match a button's actual icon to its name, location and behavior, including controls whose meaning is unfamiliar.

## Agreed entry point

- Add a visible **Help** button with the existing Lucide circled-question-mark icon (`CircleHelp`) on the right of **Your libraries** on the libraries home page.
- Keep the text label visible on mobile as well as desktop. Use a shared button component and retain keyboard focus styling.
- Open a dedicated in-app Help view. Do not add another bottom-navigation destination or rely on an unspecified three-dot menu as its primary entry point.
- Add a labeled link from Settings to the same Help view, replacing the existing limited Help and shortcuts cards with this entry point. Keep the Settings section typography and width consistent with the other sections.
- Provide a clearly labeled Back action. Opening and closing Help must preserve the previous destination, explicit filters, folder scope and any selected/open media. Returning from Help should restore the browsing position where practical.
- Make Help refreshable/addressable using the existing UI URL state conventions. Refreshing Help must not erase the stored return context or unexpectedly move the user into a different folder.

## Help contents

Organize by where controls appear, rather than by icon shape. Include a compact section index with descriptive links. The guide is finite static content; do not fetch library media or task data just to show examples.

Each control entry must contain:

1. The **actual icon** used by that control, rendered with the same Lucide component. For controls with no icon, show their actual text label instead of inventing an icon.
2. Its short, recognizable **name**, matching the live accessible name or menu label where possible.
3. **Where it appears**, including any condition needed to see it, such as opening a file, selecting media or opening a folder menu.
4. One plain-language sentence explaining **what it does**; add an important limitation or state description only when useful.

Example: **Filters** — Library/gallery actions menu — Limit results by folder, tags, search or media type. Show how to reveal the active-filter row and how clearing filters removes visible scope.

### Libraries, folders and gallery

Cover library navigation and breadcrumb navigation; initial indexing modes; the existing indexing/task indicator; folder actions; filters; Show/Hide filters; Clear filters; sorting and direction; shuffle/reshuffle; tag grouping; slideshow; refresh; selecting media and bulk tagging; and folder hiding/custom covers where available.

Explain that folder names follow the visible sort direction, while media date/type/size/shuffle choices do not sort folders by those properties. Explain that hiding the active-filter row does not clear filters. Distinguish refreshing results from rescanning a library.

### Search, tags and Collections

Cover search scope, applicable filter controls, active tags and their removal, tag selection/editing, favourite/dislike actions and available collection destinations. Document actual current behavior, not intended future functionality. Explain any selected state that changes a control's meaning.

### Normal photo and video viewer

Cover previous/next, close, details, tags, manual per-file metadata import, View in Reels, slideshow-related controls, fullscreen/external-player actions where present, and available video controls.

Explain play/pause, seeking, mute/unmute, granular volume, Resume from time and Start from beginning. Explain thumbnail progress indicators and unwatched/in-progress/completed states. State that progress is shared across clients of the same Luma instance rather than per-user cloud synchronization.

### Reels

Cover navigation, filters, details/tags, metadata actions and playback controls that actually appear. Explain that View in Reels starts at the selected item and carries explicit browsing filters. Reels has a volume slider but **does not have the right-side volume swipe gesture**; vertical gestures retain Reels navigation.

### Background tasks

Explain where the queue is opened: the existing indexing indicator's panel, not a separate Tasks button. Cover queued, running, completed, cancelled and failed states and the counters shown. Explain Cancel/Cancel scan, Queue again and Clear finished.

Clear finished dismisses terminal entries from the visible queue and leaves active work visible; it does not delete media, scan history or metadata checkpoints. Cancelled metadata imports resume unfinished checkpoints when explicitly queued again. Avoid implying that cancelling an operation reverses changes already committed.

### Settings

Cover Theme & appearance, Random media URL, Metadata exchange and Hidden folders. Explain that Random URLs use the current explicit browsing filters and the existing cached photo/GIF-preview endpoint; do not promise random video content. Explain export downloads and manual metadata repair/import entry points in folders and individual files.

Installation guidance remains in README/deployment documentation. **Do not reintroduce the Install Luma panel**, an installation promotion or an HTTP-PWA promise in Settings or Help.

### Gestures and keyboard shortcuts

Include a separate concise reference for non-button interactions:

- Photo pinch-to-zoom and panning while zoomed.
- Double-tap zoom into the tapped region and double-tap return to fit.
- Normal video player: right-side vertical swipe up/down adjusts volume with temporary feedback.
- Reels navigation gestures, without a volume swipe.
- Supported viewer/Reels keyboard shortcuts, verified against the current event handlers.

Do not invent shortcuts or gesture support. Mention device/browser limitations only where needed to explain actual behavior, without turning the guide into a technical deployment manual.

## Implementation guidance

- Read AGENTS.md, ARCHITECTURE.md and relevant subsystem contracts before changes. Preserve SQLite/cache-only browsing and bounded media rendering.
- Put finite guide content and components in `src/Luma.Web/src/features/help/`. Keep routing/state integration small; use the existing app navigation and URL conventions rather than introducing a routing library.
- Audit live buttons and menus before writing content. Reuse actual icon imports, existing shared controls, typography tokens and spacing. Do not create a generic command registry solely for this guide.
- Treat guide entries as documentation, not duplicate live action buttons. Decorative icons have no separate accessible name; readable entry text supplies the meaning.
- Use semantic headings, links and buttons. Ensure section links, Back and the entry points work with keyboard and touch. Avoid custom dialogs or interaction primitives.
- Let the dedicated Help view own its scroll area. It must not leave the gallery/body scroll locked after navigation.
- Keep the guide readable on narrow screens with compact rows and clear locations. Do not add a permanent gallery toolbar or consume media viewport space beyond the agreed home-page button.
- Tooltips for other controls, onboarding tours, analytics, searchable documentation and context-sensitive viewer Help are outside this stage unless separately requested.

## Starting points in the current source

| File or feature | Review purpose |
| --- | --- |
| `src/Luma.Web/src/app/App.tsx` | Libraries heading, Settings help cards, navigation, filter/media URL state |
| `src/Luma.Web/src/components/ui/Controls.tsx` | Shared labeled/icon buttons |
| `src/Luma.Web/src/components/ui/SettingsSection.tsx` | Consistent Settings sections |
| `src/Luma.Web/src/features/browse/GalleryActions.tsx`, `FolderActions.tsx`, `ActiveFilters.tsx`, `FilterForm.tsx` | Actual gallery controls and scope behavior |
| `src/Luma.Web/src/features/browse/ScanControls.tsx`, `RescanButton.tsx` | Initial indexing and queue entry point |
| `src/Luma.Web/src/features/status/TaskQueue.tsx` | Queue states, counters and actions |
| `src/Luma.Web/src/features/browse/Viewer.tsx`, `Reels.tsx`, `MediaStage.tsx`, `VideoControls.tsx` | Viewer/Reels buttons, gestures and shortcuts |
| `src/Luma.Web/src/features/tags/TagEditor.tsx`, `MetadataExchange.tsx` | Tagging and metadata controls |
| `docs/STAGE-8.md`, `docs/STAGE-8-VERIFICATION.md` | Delivered functionality and known acceptance limits |

These are starting points, not a substitute for checking every currently rendered control. The Stage 8 changes are local workspace changes; do not discard them or assume a deployed container already contains them. Older deployments may still show the removed installation panel or lack Clear finished.

## Acceptance and verification

- Help is visibly labeled beside Your libraries and reachable through Settings without adding a bottom-bar item.
- Every current icon-only control is documented in the appropriate section with its real icon, name, location and behavior; text-only actions and important gestures are also covered.
- Descriptions accurately distinguish normal-player volume swipes from Reels navigation, filters from hidden UI, queue dismissal from deletion, refresh from rescan, and folder sorting from media sorting.
- Opening Help, going Back and refreshing preserve navigation/filter/media context. Help does not trigger library scanning, original-file reads or unnecessary media requests.
- Keyboard navigation and section links work. Help scrolls independently and returning to browsing does not leave scroll locks.
- Add focused frontend regression tests for both entry points, content coverage of the important distinctions, return-context restoration and URL refresh. Test meaningful behavior, not snapshots of every sentence or CSS class.
- Run backend build/tests and frontend build/tests/lint, recording exact commands, failures and limitations in `docs/STAGE-9-VERIFICATION.md`. Do not claim real-device checks that were not performed.
- **Do not run E2E/Playwright tests**: the user's exclusion remains in force. Do not invoke a script that runs E2E indirectly.
- Use PowerShell without loading the user's profile. Initialize only fnm for Node (`fnm env --shell powershell | Out-String | Invoke-Expression`, then `fnm use 24`).

Baseline from the latest Stage 8 follow-up: both builds and frontend lint passed; backend 88 passed with one Windows symlink skip; frontend 67 passed. This is historical baseline evidence, not verification of Stage 9 implementation.

## Handoff boundary

This delivery adds the Stage 9 specification and delivery-plan link only. The next implementation should complete the Help view, entry points and regression coverage described above, then update its status and link verification evidence. Stage 8 device scroll/gesture acceptance and target-hardware performance measurements remain open and are not automatically completed by adding Help.
