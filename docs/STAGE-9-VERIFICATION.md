# Stage 9 verification

Local Windows verification on 2026-09-19 with .NET 10 and Node 22.17.0 (Git Bash; the fnm/Node 24 PowerShell setup from the handoff was not used for this run).

| Command | Result |
| --- | --- |
| `dotnet build Luma.slnx` (repository root) | Passed, 0 warnings, 0 errors |
| `dotnet test tests/Luma.Server.Tests` (repository root) | 88 passed, 1 Windows symlink test skipped, 0 failed |
| `npx tsc -b` (src/Luma.Web) | Passed |
| `npm run build` (src/Luma.Web) | Passed |
| `npm run lint` (src/Luma.Web) | Passed |
| `npm test` (src/Luma.Web) | 73 passed across 16 files (78 after the follow-up below) |

E2E/Playwright tests were not run, as the user explicitly requested. Media unit tests still print jsdom's existing unimplemented `pause()`/`load()` notices; these are not failures. The backend was built in Debug, not Release as in Stage 8. No backend code changed in this stage.

## What was delivered

- `src/Luma.Web/src/features/help/guide.ts` holds the finite guide content. Every entry uses the same Lucide component as its live control (two icons for toggles that swap icons), or the control's actual text when it has no icon, together with its name, location and behaviour. Sections: libraries/folders/gallery, search/tags/Collections, photo and video viewer, Reels, background tasks, Settings, and gestures and keyboard shortcuts. The gestures and shortcuts were checked against the current `MediaStage`, `Viewer` and `Reels` handlers.
- `src/Luma.Web/src/features/help/Help.tsx` renders Help in its own scroll area with a sticky, labeled Back button, a section index (links scroll within Help and move focus to the section heading without adding hash history entries), decorative icons and semantic headings.
- `App.tsx` adds a `help` section that is not in the bottom bar. The entry points are a labeled **Help** button (`CircleHelp`) to the right of **Your libraries**, and an **Open the Help guide** link in a new Settings section that replaces the old Help and shortcuts cards. The URL is `?<filters>&view=help&from=<origin>`. Opening Help pushes a history entry and stores the origin's scroll position in the origin entry. Back pops that entry, restoring the section, filters, folder scope and scroll position, and returns focus to the entry point. When there is no origin entry (a direct link), Back replaces the Help URL with the `from` destination. The active-filter row is hidden on Help, as it is on Settings.

## Regression coverage

- App: the home Help button opens Help with `view=help&from=library` and does not change the navigation item count; Back returns to Your libraries and refocuses the button.
- App: Settings → Help keeps `libraryId`, `folderId` and `mediaType`; the section index link focuses its heading; reading Help makes no media, scan or task requests; Back returns to Settings with the original URL, and Library still opens the same folder.
- App: a refreshed `?libraryId=1&folderId=2&view=help&from=settings` URL shows Help without media requests or POSTs, and Back goes to Settings with the folder scope kept.
- Help: every section is indexed; every entry has a location, a behaviour and an icon, label or indicator; the key distinctions are present (folder name sort vs media-only sorts, refresh vs rescan, hiding vs clearing filters, no volume swipe in Reels, Clear finished vs deletion, shared instance-wide watch progress, no random videos); no installation panel; the guide renders only one button (Back), and Back works from the keyboard.

## Limitations

- The layout was not viewed in a real browser or on a phone. Narrow-screen layout (entry visuals stack above their text below the `sm` breakpoint) is untested by automation.
- Scroll restoration on Back relies on the origin's content rendering synchronously from the query cache (true for Your libraries and the static Settings sections). Content that loads later, such as the Hidden folders list, may shift the position slightly.
- The Stage 8 open items (real-device scroll/gesture acceptance and target-hardware measurements) are unaffected by this stage and remain open.

## Follow-up fixes (same day)

- **Start slideshow did nothing.** A closing sheet leaves its history entry with an asynchronous `history.back()`. When the viewer opened before that finished, the traversal popped the viewer's entry and closed it. `Modal` now waits for a pending traversal before it pushes its own entry. Also, a folder with only subfolders has no direct media; the slideshow now falls back to including subfolders and navigates within that scope, and shows a message when there is nothing to play. The new `Modal` test delays traversal as browsers do; it fails without the fix.
- **Refresh collection** inside a library now opens the existing rescan confirmation (Background tasks, "Start a rescan now?"). Outside a library it still reloads results. `RescanButton` can be opened from outside and can render without its icon trigger.
- **Folder information** no longer shows library scan status.
- **Hidden folders** uses the standard `SettingsSection` heading.
- **Bottom bar** is now in the page flow instead of `position: fixed` over the content, so filled video can no longer show at its edge. Reels offsets that had allowed for the bar overlaying the stage were reduced to match.
- **Filter-row visibility** for Reels is stored separately (`luma-reels-show-filters`) from Library/Search/Collections (`luma-show-filters`).

After these changes: `npx tsc -b`, `npm run build` and `npm run lint` passed; `npm test` gave 78 passed across 16 files. No backend code changed. E2E was not run. The bottom-bar fix was not checked on a real phone.
