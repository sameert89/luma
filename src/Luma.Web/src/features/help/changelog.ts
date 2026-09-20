/**
 * Release notes shown in What's new after an update, newest first. Each entry is written for
 * the person using Luma rather than for the diff: what changed for them, in one line each.
 */
export type Release = { version: string; date: string; headline: string; changes: string[] }

export const releases: Release[] = [
  {
    version: '1.0.7',
    date: '2026-09-20',
    headline: 'Refreshing a folder behaves',
    changes: [
      'Refreshing a folder while a scan is already running moves that folder to the front of it, so what you are looking at is checked first, instead of refusing with an error.',
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
