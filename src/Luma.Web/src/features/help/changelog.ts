/**
 * Release notes shown in What's new after an update, newest first. Each entry is written for
 * the person using Luma rather than for the diff: what changed for them, in one line each.
 */
export type Release = { version: string; date: string; headline: string; changes: string[] }

export const releases: Release[] = [
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
