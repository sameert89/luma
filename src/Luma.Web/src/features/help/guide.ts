import {
  Bookmark, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleHelp, Clapperboard, Download, EllipsisVertical, Eye, EyeOff, FileInput, Film,
  FileImage, FolderOpen, Heart, HeartCrack, ImageMinus, Images, Info, ListVideo, Maximize, Minimize, Pause, PictureInPicture2, Play, Plus, Presentation, RefreshCw, Search, Settings,
  Settings2, Shuffle, SlidersHorizontal, Tag, Timer, Volume2, VolumeX, X, type LucideIcon,
} from 'lucide-react'

/**
 * One documented control. `icons` are the same Lucide components the live control renders
 * (two for toggles that swap icons); `label` is the visible text of a control that has none,
 * and `progressBar` draws the thumbnail progress indicator, which has neither.
 */
export type GuideEntry = { name: string; where: string; what: string; icons?: LucideIcon[]; label?: string; progressBar?: boolean }
export type GuideGroup = { title: string; entries: GuideEntry[] }
export type GuideSection = { id: string; title: string; summary: string; groups: GuideGroup[]; notes?: string[] }

export const guideSections: GuideSection[] = [
  {
    id: 'libraries', title: 'Libraries, folders and gallery', summary: 'Browse, filter, sort, select and hide folders',
    groups: [
      { title: 'Getting around', entries: [
        { icons: [Images], name: 'Library', where: 'Bottom bar on phones, side navigation on wider screens', what: 'Returns to library browsing with your current folder and filters.' },
        { label: 'luma.', name: 'Luma home', where: 'Top left of the header', what: 'Clears every filter and returns to Your libraries.' },
        { icons: [FolderOpen], name: 'Open a library or folder', where: 'Library cards on Your libraries; folder cards at the top of a folder', what: 'Opens it. A library with nothing indexed asks how to index it first.' },
        { icons: [ChevronRight], name: 'Folder breadcrumb', where: 'Under the folder title, inside a subfolder', what: 'Jumps straight back to any parent folder.' },
        { label: 'Previous folders', name: 'Previous folders / Next folders', where: 'Below the folder cards in folders with many subfolders', what: 'Pages through the subfolders.' },
        { label: 'Load more', name: 'Load more', where: 'Bottom of a long gallery', what: 'Loads the next page of results; scrolling to the end does the same.' },
      ] },
      { title: 'Indexing', entries: [
        { label: 'Start indexing', name: 'Initial indexing', where: 'Opens when you choose a library that has not been indexed yet', what: 'Starts the first scan. Choose Index only, Index + embedded metadata, or Index + embedded metadata + XMP to decide which tags are read while indexing.' },
        { icons: [RefreshCw], name: 'Background jobs', where: 'Beside Help on Your libraries, and in the header of an open library', what: 'Opens the list of indexing, import and export jobs. The icon spins while any job runs.' },
      ] },
      { title: 'Folder and gallery menus', entries: [
        { icons: [EllipsisVertical], name: 'Folder actions', where: 'On every folder and library card, and in the header of the open folder', what: 'Opens the folder menu. A library is its top folder, so its card has the same menu. In the header it also holds the gallery actions below.' },
        { icons: [RefreshCw], name: 'Rescan folder / Rescan library', where: 'Folder actions menu', what: 'Checks the folder and every folder inside it (or the whole library, from its card) for new, changed or removed files. Choose whether to read embedded metadata or XMP too, then Start rescan; progress shows in Background jobs.' },
        { icons: [EllipsisVertical], name: 'Gallery actions', where: 'Header of search results and other views outside a folder', what: 'Slideshow, selection, refresh and filter actions for the current results.' },
        { label: 'Start slideshow', name: 'Start slideshow', where: 'Folder or gallery actions menu', what: 'Opens the first result in the viewer and advances through the rest automatically. A folder that only contains subfolders plays everything inside them.' },
        { label: 'Refresh collection', name: 'Refresh collection', where: 'Folder or gallery actions menu', what: 'Reloads what is shown from Luma’s index. It never rescans; use Rescan folder for that.' },
        { icons: [Info], name: 'Folder information', where: 'Folder actions menu', what: 'Shows the folder’s name, library and location.' },
        { icons: [FileInput], name: 'Import folder metadata', where: 'Folder actions menu', what: 'Merges EXIF/XMP tags from every indexed file directly in this folder, regardless of the current filters. Originals are never changed.' },
        { icons: [ImageMinus], name: 'Reset album cover', where: 'Folder actions menu, when you picked the folder’s cover yourself', what: 'Forgets your cover choice so the folder goes back to an automatic cover in your Settings style. No photos change.' },
        { icons: [EyeOff], name: 'Hide folder', where: 'Folder actions menu, for folders inside a library (not the library itself)', what: 'Leaves the folder and everything in it out of browsing, search, Reels, slideshows and indexing. Nothing is deleted; show it again from Settings.' },
        { label: 'Use as folder cover', name: 'Use as folder cover / Use as library cover', where: 'Media details in the viewer', what: 'Makes the open item the cover art for its folder or library.' },
      ] },
      { title: 'Filters and sorting', entries: [
        { icons: [SlidersHorizontal], name: 'Filters', where: 'Header, right of search (in Reels: the Reels menu)', what: 'Opens Filters and sorting to limit results by folder, tags, search, media type, favourite state, date, size and more.' },
        { label: 'Edit filters', name: 'Edit filters', where: 'Folder or gallery actions menu', what: 'Opens the same Filters and sorting sheet.' },
        { label: 'Hide filters', name: 'Hide filters / Show filters', where: 'Folder or gallery actions menu', what: 'Hides or shows the row of active filters under the header. Hiding the row does not clear anything; the filters still apply. Reels remembers its own choice.' },
        { label: 'Tags: beach ×', name: 'Active filter chip', where: 'Active-filter row under the header', what: 'Removes that one filter. Removing the library also removes the folder.' },
        { label: 'Clear all filters', name: 'Clear all filters', where: 'End of the active-filter row, and the folder or gallery actions menu', what: 'Removes every filter, including library and folder scope, so results widen to everything.' },
        { label: 'Sort by', name: 'Sort by and Sort direction', where: 'Filters and sorting → Order and grouping', what: 'Orders media by modified date, captured date, name, type, size or shuffle, ascending or descending.' },
        { label: 'Reshuffle', name: 'Reshuffle', where: 'Filters and sorting, when Sort by is Shuffle', what: 'Picks a new random order. The same shuffle stays stable while you browse.' },
        { label: 'Group by', name: 'Group by', where: 'Filters and sorting → Order and grouping', what: 'Groups results under folder, date or type headings. Tags shows one card per tag; Browse opens that tag’s items.' },
        { label: 'Clear folder scope', name: 'Clear folder scope / Include subfolders', where: 'Filters and sorting → Location and name', what: 'Drops the folder limit, or includes everything below the folder instead of only its own files.' },
        { label: 'Reset filters', name: 'Apply filters / Reset filters', where: 'Bottom of Filters and sorting', what: 'Apply uses your changes; Reset removes every filter at once.' },
      ] },
      { title: 'Selecting media', entries: [
        { label: 'Select media', name: 'Select media / Done selecting', where: 'Folder or gallery actions menu', what: 'Shows a checkbox on each thumbnail. Select up to 500 items at a time.' },
        { icons: [Tag], name: 'Edit tags', where: 'Selection bar, once items are selected', what: 'Adds or removes one tag on every selected item, or imports their embedded metadata.' },
        { icons: [X], name: 'Clear selection', where: 'Selection bar', what: 'Deselects everything.' },
      ] },
    ],
    notes: [
      'Folders follow the selected direction. Date sorts order folders by when each folder last changed on disk; every other sort orders them by name, with numbers in order (Day 2 before Day 10) and letter case and accents ignored.',
      'Refresh collection only reloads what Luma has already indexed. Rescan folder (or Rescan library) reads the files on disk again and always asks first.',
      'Hiding the active-filter row only hides it. Use Clear all filters to actually widen the results.',
    ],
  },
  {
    id: 'search', title: 'Search, tags and Collections', summary: 'Find media, tag it and mark favourites',
    groups: [
      { title: 'Search', entries: [
        { icons: [Search], name: 'Search', where: 'Header search field, and Search in the bottom bar', what: 'Searches file names, folders and tags within the current filters. Inside a folder it covers that folder and its subfolders.' },
        { icons: [Tag, FolderOpen, FileImage], name: 'Search suggestions', where: 'Below the search field as you type', what: 'Completes tags, folders and file names from your whole library, each marked Tag, Folder or File with where it lives. A tag shows everything with exactly that tag; a folder or file opens it. Press Enter without choosing to search the typed text.' },
        { icons: [Search, X], name: 'Open search / Close search', where: 'Header on phones', what: 'Reveals or tucks away the search field.' },
        { icons: [X], name: 'Clear search', where: 'Header, when the search has text', what: 'Clears the search and returns to the folder you searched from, or to the empty Search page.' },
      ] },
      { title: 'Tags', entries: [
        { icons: [Plus], name: 'Find or create a tag', where: 'Tags in Media details, the Reels Tags sheet and bulk Edit tags', what: 'Matching tags list below the field as you type; tap one to add it (tags already on the item show Added). Create “…” adds a new tag, as does pressing Enter.' },
        { label: 'beach ×', name: 'Remove tag', where: 'Tag list for the open item', what: 'Removes that tag from this item only.' },
        { label: 'Apply to 3 items', name: 'Bulk tag operation', where: 'Edit tags for a selection', what: 'Choose Add a tag or Remove a tag, then apply it to every selected item.' },
      ] },
      { title: 'Favourites', entries: [
        { icons: [Heart], name: 'Like', where: 'Action row in the viewer and Reels, and Media details', what: 'Marks the item as a favourite; press again to return it to unrated. Liked thumbnails show a small heart.' },
        { icons: [HeartCrack], name: 'Dislike', where: 'Action row in the viewer and Reels, and Media details', what: 'Marks the item as disliked; press again to return it to unrated. Disliked items still appear unless you filter them out.' },
        { label: 'Favourite state', name: 'Favourite state filter', where: 'Filters and sorting → Media', what: 'Shows only Favourites, Hidden (disliked) or Unrated items.' },
      ] },
      { title: 'Collections', entries: [
        { icons: [Bookmark], name: 'Collections', where: 'Bottom bar or side navigation', what: 'Lists your favourites and every tag. Opening it starts from no filters.' },
        { icons: [Heart], name: 'Open favourites', where: 'Collections → Favourites', what: 'Shows every liked item.' },
        { icons: [Tag], name: 'Tag', where: 'Collections → Tags', what: 'Shows every item with that tag. Press and hold to manage the tag.' },
        { icons: [EllipsisVertical], name: 'Manage tag', where: 'Beside each tag in Collections', what: 'Rename the tag (renaming to another tag’s name merges them) or delete it from every item after confirming.' },
      ] },
    ],
    notes: ['Like and Dislike are toggles: a highlighted heart means the state is on, and pressing it again clears it.'],
  },
  {
    id: 'viewer', title: 'Photo and video viewer', summary: 'Open a file, navigate, view details and play video',
    groups: [
      { title: 'Viewer controls', entries: [
        { icons: [Presentation, Pause], name: 'Slideshow', where: 'Top right of the viewer', what: 'Starts or pauses a slideshow. Photos advance on a timer, videos when they end, and it stops at the last item.' },
        { label: '5 s', name: 'Slide duration', where: 'Beside Slideshow while it runs', what: 'Cycles through 3, 5, 10 and 20 seconds per photo. Remembered on this device.' },
        { icons: [X], name: 'Close viewer', where: 'Top right of the viewer', what: 'Returns to the gallery at the same place.' },
        { icons: [EllipsisVertical, X], name: 'Viewer menu', where: 'Bottom right, beside Like and Dislike', what: 'Opens or closes the menu of actions above it.' },
        { icons: [Settings2], name: 'View options', where: 'Viewer menu', what: 'Fit or fill, zoom, actual size, rotate, playback speed, picture in picture, fullscreen, download and stream URL.' },
        { icons: [Info], name: 'Media details', where: 'Viewer menu', what: 'Like and Dislike, tags, cover choices, metadata import and export, and file information.' },
        { icons: [Clapperboard], name: 'Watch on Reels', where: 'Viewer menu, for videos and GIFs', what: 'Continues in Reels starting at this item, with the same folder and filters.' },
        { icons: [ChevronLeft, ChevronRight], name: 'Previous item / Next item', where: 'Viewer menu', what: 'Moves through the current results in their sorted order.' },
      ] },
      { title: 'View options', entries: [
        { label: 'Fill', name: 'Fit / Fill', where: 'View options', what: 'Shows the whole item, or fills the screen and crops the edges. Remembered on this device.' },
        { label: '100%', name: 'Zoom out, reset zoom, zoom in', where: 'View options, for photos', what: 'The − and + buttons zoom; the percentage returns to fit.' },
        { label: 'Actual size', name: 'Actual size', where: 'View options, for photos', what: 'Loads the original file and shows it pixel for pixel.' },
        { label: 'Rotate', name: 'Rotate', where: 'View options, for photos', what: 'Turns the picture 90° on screen only; the file is not changed.' },
        { icons: [Maximize], name: 'Fullscreen', where: 'View options, and the video control bar', what: 'Fills the screen. Controls fade while media plays and return when you move or tap.' },
        { icons: [Minimize], name: 'Exit fullscreen', where: 'Top right in fullscreen, or the video control bar', what: 'Leaves fullscreen.' },
        { icons: [Download], name: 'Download', where: 'View options', what: 'Downloads the original file.' },
        { label: 'Copy stream URL', name: 'Copy stream URL', where: 'View options, for videos', what: 'Copies the video’s address for VLC or another network-stream player. Use it when this browser cannot play the format; originals are streamed without conversion.' },
      ] },
      { title: 'Video playback', entries: [
        { icons: [Play, Pause], name: 'Play / Pause', where: 'Left of the video control bar', what: 'Starts or pauses the video.' },
        { label: 'Seek', name: 'Seek bar', where: 'Video control bar', what: 'Drag or tap to jump to a time. The lighter part shows what has loaded.' },
        { icons: [Volume2, VolumeX], name: 'Mute / Unmute', where: 'Video control bar', what: 'Silences the video or restores its volume.' },
        { label: 'Volume', name: 'Volume slider', where: 'Video control bar', what: 'Sets the volume in fine steps.' },
        { icons: [ListVideo], name: 'Autoplay next video', where: 'Video control bar, including fullscreen', what: 'When on, the next video starts by itself when the current one ends. Luma remembers the choice. Reels uses its own Auto-scroll instead.' },
        { label: '1×', name: 'Playback speed', where: 'Video control bar (View options on upright phones)', what: 'Cycles 1×, 1.5×, 2× and 0.5×.' },
        { icons: [PictureInPicture2], name: 'Picture in picture', where: 'Video control bar (View options on upright phones), where the browser supports it', what: 'Pops the video into a small floating window.' },
        { label: 'Resume from 1:23', name: 'Resume from … / Start from beginning', where: 'Over a video you left part-way through', what: 'Carries on from where you stopped, or starts again from 0:00.' },
      ] },
      { title: 'Metadata for one item', entries: [
        { label: 'Import metadata tags', name: 'Import metadata tags', where: 'Media details, and Media information in Reels', what: 'Reads this file’s embedded EXIF/XMP tags into Luma. Tick Include adjacent XMP sidecars to read a matching .xmp file too.' },
        { label: 'Export XMP', name: 'Export XMP', where: 'Media details, and Media information in Reels', what: 'Prepares a download of this item’s tags as XMP; Download export appears when it is ready.' },
      ] },
      { title: 'Thumbnail indicators', entries: [
        { icons: [Film], name: 'Video badge', where: 'Corner of a video thumbnail', what: 'Marks a video. GIFs show a GIF badge instead.' },
        { progressBar: true, name: 'Watch progress bar', where: 'Along the bottom of a video thumbnail', what: 'No bar means unwatched, a partial bar means in progress, and a full bar means watched.' },
        { icons: [Heart], name: 'Liked', where: 'Top corner of a thumbnail', what: 'The item is one of your favourites.' },
      ] },
    ],
    notes: [
      'Watch progress is saved on this Luma server, so every browser and device using it shares the same progress. It is not a per-person account sync.',
      'Resume appears in the normal viewer only; Reels always starts a video from the beginning.',
    ],
  },
  {
    id: 'reels', title: 'Reels', summary: 'Full-screen vertical browsing of videos and GIFs',
    groups: [
      { title: 'Reels controls', entries: [
        { icons: [Clapperboard], name: 'Reels', where: 'Bottom bar or side navigation', what: 'Opens Reels with your current filters. Without a media type filter it shows videos and GIFs.' },
        { icons: [EllipsisVertical, X], name: 'Reels menu', where: 'Bottom right, beside Like and Dislike', what: 'Opens or closes the Reels actions.' },
        { icons: [SlidersHorizontal], name: 'Filters', where: 'Reels menu', what: 'Opens Filters and sorting for Reels.' },
        { icons: [EyeOff, Eye], name: 'Hide filters / Show filters', where: 'Reels menu', what: 'Hides or shows the active-filter row without clearing any filter. This choice applies to Reels only; Library and Search keep their own.' },
        { icons: [VolumeX, Volume2], name: 'Mute / Unmute', where: 'Reels menu', what: 'Reels start muted; your choice is remembered on this device.' },
        { icons: [Timer], name: 'Auto-scroll', where: 'Reels menu', what: 'When on, moves to the next reel when a video ends, or after 3 seconds on a photo. When off, videos loop.' },
        { icons: [Tag], name: 'Tags', where: 'Reels menu', what: 'Adds or removes tags on the current reel.' },
        { icons: [Settings2], name: 'View options', where: 'Reels menu', what: 'Fit or fill, Open in viewer, volume slider, playback speed, picture in picture, fullscreen, download and stream URL.' },
        { icons: [Info], name: 'Media information', where: 'Reels menu', what: 'File information plus metadata import and XMP export for this reel.' },
        { icons: [ChevronUp, ChevronDown], name: 'Previous / Next', where: 'Reels menu', what: 'Moves to the previous or next reel.' },
        { icons: [Play], name: 'Play video', where: 'Centre of a paused reel', what: 'Resumes playback.' },
        { label: 'Open in viewer', name: 'Open in viewer', where: 'View options in Reels', what: 'Opens the current reel in the normal viewer with its full video controls.' },
        { label: 'Seek video', name: 'Seek bar', where: 'Tap the bottom strip of a video reel', what: 'Reveals the seek bar for a few seconds; the first touch only reveals it, so playback never jumps by accident.' },
      ] },
    ],
    notes: [
      'Watch on Reels in the viewer starts at the item you were viewing and keeps your folder and explicit filters.',
      'Reels has a volume slider in View options but no right-side volume swipe: vertical swipes always move between reels.',
      'Reels remembers where you were for the same set of filters.',
    ],
  },
  {
    id: 'tasks', title: 'Background jobs', summary: 'Scans, metadata imports and exports',
    groups: [
      { title: 'Where to find the queue', entries: [
        { icons: [RefreshCw], name: 'Background jobs', where: 'Beside Help on Your libraries, and in the header of an open library', what: 'Opens the jobs list. Start a rescan from a folder or library card’s Folder actions menu.' },
      ] },
      { title: 'Queue actions', entries: [
        { label: 'Cancel', name: 'Cancel / Cancel scan', where: 'On a queued or running task', what: 'Stops the task. Work already finished, such as prepared previews and imported tags, is kept.' },
        { label: 'Queue again', name: 'Queue again', where: 'On a cancelled, failed or interrupted task', what: 'Runs the task again as a new task, which replaces the stopped one in the list.' },
        { label: 'Clear', name: 'Clear', where: 'On any task that is no longer active', what: 'Removes that one entry from the list.' },
        { label: 'Clear finished', name: 'Clear finished', where: 'Top of the queue', what: 'Removes every completed, cancelled, failed and interrupted entry and leaves active ones in place.' },
      ] },
    ],
    notes: [
      'Each task shows what it is (indexing, tag import, XMP export or disliked paths export), its state (queued, running, completed, cancelled, failed or interrupted) and its progress.',
      'Interrupted means Luma stopped the task, for example on restart. An interrupted or cancelled task stops at once and never picks up again by itself.',
      'Clear finished only tidies the list. It does not delete media, scan history or metadata checkpoints.',
      'Cancelling stops further work; it does not undo changes a task has already made.',
    ],
  },
  {
    id: 'settings', title: 'Settings', summary: 'Theme, album covers, random media links, exports and hidden folders',
    groups: [
      { title: 'Settings sections', entries: [
        { icons: [Settings], name: 'Settings', where: 'Bottom bar or side navigation', what: 'Opens Settings. Your current filters stay in place for when you return.' },
        { label: 'Theme & appearance', name: 'Theme & appearance', where: 'Settings', what: 'Chooses Luma’s colours on this device.' },
        { label: 'Album covers', name: 'Album covers', where: 'Settings', what: 'Smart covers show a mosaic for albums with three or more photos and fit single photos to the card; Cropped covers fill the card with one photo. Covers you picked yourself keep their photo either way.' },
        { icons: [Shuffle], name: 'Random media URL', where: 'Settings', what: 'Builds a reusable link that returns a random cached photo or GIF preview matching your current browsing filters. It does not serve random videos.' },
        { label: 'Export XMP', name: 'Export XMP / Export disliked paths', where: 'Settings → Metadata exchange', what: 'Prepares downloads of your tags as XMP, or a list of disliked file paths. Download export appears when ready.' },
        { icons: [Eye], name: 'Show', where: 'Settings → Hidden folders', what: 'Brings a hidden folder back into browsing and indexing.' },
        { label: 'Missing-file checks', name: 'Missing-file checks', where: 'Settings', what: 'Optionally checks known source paths in small background batches and hides files deleted from an available library. It is off by default; rescans still reconcile deletions.' },
        { icons: [CircleHelp], name: 'Help', where: 'Settings, and beside Your libraries', what: 'Opens this guide.' },
        { label: 'About', name: 'About', where: 'End of Settings', what: 'Shows the installed Luma version, project link and creator credit. The version also appears at the bottom-left of desktop navigation.' },
      ] },
    ],
    notes: ['Metadata imports are started from a folder (Folder actions → Import folder metadata) or from a single file (Media details → Import metadata tags), not from Settings.'],
  },
]

export type Gesture = { gesture: string; where: string; result: string }

export const gestures: Gesture[] = [
  { gesture: 'Swipe left or right', where: 'Viewer', result: 'Next or previous item.' },
  { gesture: 'Pinch', where: 'Photos in the viewer', result: 'Zooms in or out; drag to pan while zoomed.' },
  { gesture: 'Double-tap', where: 'Photos and GIFs in the viewer', result: 'Zooms into the tapped spot; double-tap again to return to fit.' },
  { gesture: 'Mouse wheel', where: 'Photos in the viewer', result: 'Zooms in or out.' },
  { gesture: 'Tap', where: 'Videos', result: 'Plays or pauses. In fullscreen with hidden controls, the first tap only shows them.' },
  { gesture: 'Double-tap left or right third', where: 'Videos in the viewer and Reels', result: 'Skips back or forward 10 seconds.' },
  { gesture: 'Press and hold', where: 'Playing videos', result: 'Plays at 2× until you let go.' },
  { gesture: 'Swipe up or down on the right side', where: 'Videos in the normal viewer only', result: 'Raises or lowers the volume, with a brief volume readout.' },
  { gesture: 'Swipe up or down', where: 'Reels', result: 'Next or previous reel. Mouse wheel and trackpad scrolling do the same.' },
  { gesture: 'Double-tap / triple-tap the centre', where: 'Reels (videos, photos and GIFs)', result: 'Likes / dislikes the reel.' },
  { gesture: 'Tap the bottom strip', where: 'Video reels', result: 'Reveals the seek bar.' },
  { gesture: 'Press and hold a tag', where: 'Collections → Tags', result: 'Opens Manage tag.' },
]

export type Shortcut = { keys: string[]; result: string }
export type ShortcutGroup = { title: string; shortcuts: Shortcut[] }

export const shortcutGroups: ShortcutGroup[] = [
  { title: 'Viewer', shortcuts: [
    { keys: ['←', '→'], result: 'Previous or next item' },
    { keys: ['I'], result: 'Open media details' },
    { keys: ['T'], result: 'Open media details with the tag field ready' },
    { keys: ['S'], result: 'Start or pause the slideshow' },
    { keys: ['+', '−'], result: 'Zoom a photo in or out' },
    { keys: ['1'], result: 'Actual size' },
    { keys: ['R'], result: 'Rotate a photo 90°' },
    { keys: ['F'], result: 'Enter or leave fullscreen' },
    { keys: ['Esc'], result: 'Close the top panel, then the viewer' },
  ] },
  { title: 'Videos', shortcuts: [
    { keys: ['Space', 'K'], result: 'Play or pause' },
    { keys: ['J', 'L'], result: 'Back or forward 10 seconds' },
    { keys: ['M'], result: 'Mute or unmute (normal viewer only)' },
  ] },
  { title: 'Reels', shortcuts: [
    { keys: ['↑', '↓'], result: 'Previous or next reel' },
    { keys: ['←', '→'], result: 'Back or forward 5 seconds in a video' },
    { keys: ['Space', 'K'], result: 'Play or pause' },
    { keys: ['J', 'L'], result: 'Back or forward 10 seconds' },
    { keys: ['F'], result: 'Enter or leave fullscreen' },
  ] },
]
