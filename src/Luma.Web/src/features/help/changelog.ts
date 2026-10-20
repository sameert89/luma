/**
 * Release notes shown in What's new after an update, newest first. Each entry is written for
 * the person using Luma rather than for the diff: what changed for them, in one line each.
 */
export type Release = { version: string; date: string; headline: string; changes: string[] }

export const releases: Release[] = [
  {
    version: '2.0.0-beta.6',
    date: '2026-10-20',
    headline: 'Browse, cut, copy and paste',
    changes: [
      'The file-management icon beside Select reveals a compact toolbar. Select photos, videos or folders, cut or copy, browse to the destination and paste. No destination path typing is needed. Keyboard shortcuts work too.',
      'Delete and new-folder actions submit background jobs and return immediately. Independent operations queue together instead of waiting for each file to finish. Paste never overwrites existing destinations.',
      'Completed file changes no longer cause redundant watcher scans. Copied and uploaded files are indexed directly, without rescanning their siblings.',
      'Upload opens a dedicated dialog with file/folder pickers and drag-and-drop. Transfers continue after closing it.',
      'Recycle bin and Help are at the top of Settings; About is at the end. Read-only libraries disable file management.',
    ],
  },
  {
    version: '2.0.0-beta.5',
    date: '2026-10-19',
    headline: 'Reliable comic reading and Gallery-style shelves',
    changes: [
      'Comic lists no longer fail when unread and previously read books have different SQLite number types. Saved progress is fetched before reopening a book, and Exit reader finishes the latest checkpoint first. Progress also works on HTTP LAN hosts.',
      'Panels starts with up to five recent unfinished books in a horizontally scrollable Continue reading row. Comic cards show their saved page progress.',
      'Comic folders reuse Gallery’s rectangular smart covers and cover-style setting. Covers are selected in bounded SQLite queries from generated cache entries.',
      'Pinch zoom keeps its scale, and continuous pages flow together without artificial padding or resetting every page measurement after each load.',
      'Gallery background jobs moves to the header, matching Panels. Panels keeps one Comic locations action and shows initial loading in the center without flashing during background refreshes. Dropdown arrows have an inset.',
      'Phone search expands in the same header row, temporarily replacing the logo and other actions. Suggestions span the header width; Close search restores the normal header. No database migration is added.',
    ],
  },
  {
    version: '2.0.0-beta.4',
    date: '2026-10-19',
    headline: 'Restore phone search reveal',
    changes: [
      'Phone search starts collapsed in Gallery, Collections, Flick and Panels. Search, Filters and Settings stay grouped on the right; tap Search to reveal and focus the field below them, and Close search to tuck it away.',
      'Search suggestions remain inline. Desktop search stays visible. No database migration is added.',
    ],
  },
  {
    version: '2.0.0-beta.3',
    date: '2026-10-19',
    headline: 'Organized comic shelves and a quieter reader',
    changes: [
      'Search input follows the header actions on phones. Comic locations always opens in a dialog with icons for its main actions.',
      'Panels shows discovery progress and Background jobs in its header. Open saved locations and browse their subfolders; search also matches series names.',
      'Reader settings opens from an icon button. A compact page counter opens page jump and a progress slider without stretching the footer.',
      'Tag comics from Details using the shared tag editor. Comic-only tags stay out of Gallery collections and suggestions; shared tags retain their normal merge and rename behavior.',
      'Comic locations default to Exclude from Gallery. This skips Gallery indexing and hides existing comic images, their exclusive tags and XMP exports while preserving indexed identities, metadata and reading progress. Uncheck to include them again.',
      'Database schema advances to 33. Back up SQLite before upgrading; returning to beta.2 or an older release requires restoring its matching pre-upgrade database.',
    ],
  },
  {
    version: '2.0.0-beta.2',
    date: '2026-10-19',
    headline: 'Simpler single-user setup and consistent search',
    changes: [
      'Administrator tokens are gone. Enable file management with the saved Settings switch or its initial Luma__Files__Enabled environment default. Writable libraries still need a :rw mount.',
      'Flick and Panels default to enabled and their switches work independently of file management.',
      'Gallery, Collections, Flick and Panels share a visible header search with inline suggestions. Flick searches videos; Panels suggests comic titles only. Settings moves to the header and hides search and filters; bottom navigation contains Library and Collections.',
      'The logo’s superscript icon identifies the active app. Settings has distinct group headings without a floating section bar, and read-only warnings are brief floating notices.',
      'Choose comic folders by browsing mounted libraries, including folders not indexed yet, or search indexed folder names. Typing a full path is optional.',
    ],
  },
  {
    version: '2.0.0-beta.1',
    date: '2026-10-18',
    headline: 'Luma 2.0 preview: Gallery, Flick and Panels',
    changes: [
      'Click the Luma logo to switch between Gallery, Flick and Panels. Each application keeps its own search and filters.',
      'Manage writable libraries with uploads, folders, moves and a recycle bin. Configure an administrator access token, then enter it in Settings → General → File management to unlock this tab. Read-only media keeps browsing, playback, captions and tagging available.',
      'Startup checks warn when a writable library still has a read-only mount. Correct the :rw mount and permissions, then recheck it in Settings.',
      'Captions are opt-in: turn on CC for matching same-folder SRT or embedded SubRip. Styled subtitles are unsupported; extraction and conversion files stay in the Luma cache.',
      'Panels saves your selected comic folders, scans them recursively and opens your bookshelf on later visits. Search by title or author and resume reading where you left off.',
      'Settings is grouped by app and returns to the app you came from. Administrators can disable Flick or Panels globally; environment defaults reproduce preferences while in-app choices take priority.',
      'The updated help guide includes setup examples and can be deployed independently to GitHub Pages. This is a beta: back up SQLite and original/staging media before upgrading; rollback requires the matching pre-upgrade backup.',
    ],
  },
  {
    version: '1.0.11',
    date: '2026-10-01',
    headline: 'Pull to refresh just refreshes, and Reels opens your way',
    changes: [
      'Pulling down a gallery now loads what you are looking at again and nothing else. It used to start a folder scan, which showed up as a job you had not asked for; to look for files added on disk, use Rescan folder in the folder menu.',
      'Settings has a default order for Reels on this device, such as Shuffle for a new feed each time you open it. Leaving Reels puts the library back in its own order.',
      'The Random media URL no longer searches the whole library when it lands on a TIFF. With few previews prepared, that search could read over a gigabyte for one picture and slow everything else down while it ran; it now shows the nearest photo it can, straight away.',
      'The Random media URL also stops answering “nothing to show” when it lands on a TIFF before any previews exist, as long as there are photos it can show.',
      'Picking a search suggestion no longer presses whatever sat behind the list. A suggestion over Clear all filters cleared the filters instead of being chosen, which made the suggestions lowest in the list impossible to pick.',
    ],
  },
  {
    version: '1.0.10',
    date: '2026-09-25',
    headline: 'Reels opens quickly and your place survives a restart',
    changes: [
      'Reels no longer searches through the photo ordering index to find videos and animated GIFs. Motion-only ordering indexes keep its first page and next/previous lookups proportional to the moving media in the library.',
      'Media listings no longer fail with “This search took too long” after an arbitrary two seconds. They run until they finish or the browser cancels them; cancellation still interrupts the database immediately.',
      'Closing a tab or installed app no longer loses the screen and filters you were using. Relaunching Luma at its start URL restores the last Library, Search, Collections, Settings, Help or Reels destination, its folder and filters, and an open viewer or reel.',
    ],
  },
  {
    version: '1.0.9',
    date: '2026-09-22',
    headline: 'Browsing stays quick while a scan runs',
    changes: [
      'Opening a folder while a scan is running no longer crawls. Checking the scan\u2019s progress used to count every file it had queued, and both the gallery and the background jobs button did that every three seconds \u2014 on a 200,000-item library, folder listings that answer in about a second went to 52 and 64 seconds. Progress is now kept as it changes rather than recounted.',
      'A running scan refreshes the collection as it gets through each batch of files, instead of on every progress report. A long scan no longer spends the whole time rebuilding a view that has not changed.',
    ],
  },
  {
    version: '1.0.8',
    date: '2026-09-22',
    headline: 'Folders open quickly, and the queue tells the truth',
    changes: [
      'Opening a folder no longer checks every file beneath it to pick the pictures on its tile. On a 200,000-item library that was 121,207 files read to show 240 thumbnails, and it was most of what the page cost: a folder listing measured 4.4 seconds before, and a fraction of a second after. The tiles show the same pictures as before.',
      'Work that Luma had already found is no longer lost when the server restarts mid-scan. It used to sit in the queue as outstanding forever without ever being picked up — one library carried 7,663 such files — and this release also releases the ones already stuck.',
      'Luma keeps its own notes on the size of your library up to date, so it keeps choosing the quick way through it as the library grows.',
      'Requests that take longer than half a second are now noted in the server log, so a slow library can be diagnosed from the log rather than by guesswork. Set Luma:SlowRequestMs to change the half second, or to 0 to turn it off.',
    ],
  },
  {
    version: '1.0.7',
    date: '2026-09-20',
    headline: 'Refreshing a folder behaves',
    changes: [
      'Refreshing a folder while a scan is already running moves that folder to the front of it, so what you are looking at is checked first, instead of refusing with an error.',
      'Pulling to refresh checks the folder you are looking at and stops there, so it costs the same however much sits below it. Rescan folder, which says what it costs, still covers everything inside.',
      'Messages about a refresh or a selection appear briefly at the bottom of the screen and go away by themselves, instead of staying in red above the collection for the rest of the session.',
      'Pull to refresh shows the turning disc phones use, floating over the collection rather than pushing it down.',
      'The gallery shows one status at a time: “Loading your collection” no longer flashes every few seconds over a folder that is already saying it is being checked.',
      'An installed Luma now carries the colours of the theme you chose into its status bar and splash screen, rather than staying on the Dark theme’s. It changes on one of the next launches, once the phone refreshes the app’s details.',
    ],
  },
  {
    version: '1.0.6',
    date: '2026-09-20',
    headline: 'Refresh to update, pull to rescan, and a quieter gallery',
    changes: [
      'Luma now tells you once when the server is running a newer version, and Settings keeps a Refresh to update button with the release you are on.',
      "What's new opens after an update with the release notes for the version you just loaded.",
      "Pull down at the top of a gallery to rescan the folder you are in, using the library's own tag-import setting instead of asking every time.",
      'Background jobs opens as a sheet you can scroll instead of filling the screen, and finished jobs stop piling up: only the ten most recent are kept.',
      'Filters and sorting keeps Apply and Reset in view as soon as you change something, so a long filter list no longer has to be scrolled to the bottom.',
      'Closing a sheet by tapping outside no longer presses the button underneath.',
      'The active filter row lost its outlines for a lighter band, and Clear all filters now stands out from the filter chips.',
      'Resume and Start from beginning sit directly on a video as two distinct buttons, without the grey panel behind them.',
      'Select media now shows a multi-select icon, and the background jobs button is larger and easier to hit.',
      'Opening search and navigating away without typing closes the field again.',
      'Added the Nord theme, bringing the theme grid to ten.',
    ],
  },
]

export const currentRelease = releases[0]
