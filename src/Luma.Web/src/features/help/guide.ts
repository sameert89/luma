import {
  ArrowDown,
  Bookmark,
  Captions,
  Check,
  ChevronDown,
  CircleFadingArrowUp,
  CopyCheck,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  Clapperboard,
  Download,
  EllipsisVertical,
  Eye,
  EyeOff,
  FileInput,
  Film,
  FileImage,
  FolderOpen,
  Heart,
  HeartCrack,
  ImageMinus,
  Images,
  Info,
  ListVideo,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  Plus,
  Presentation,
  RefreshCw,
  Search,
  Settings,
  Settings2,
  Shuffle,
  Sparkles,
  SlidersHorizontal,
  Tag,
  Timer,
  Volume2,
  VolumeX,
  X,
  type LucideIcon,
} from 'lucide-react'

/**
 * One documented control. `icons` are the same Lucide components the live control renders
 * (two for toggles that swap icons); `label` is the visible text of a control that has none,
 * and `progressBar` draws the thumbnail progress indicator, which has neither.
 */
export type GuideEntry = {
  name: string
  where: string
  what: string
  code?: string
  icons?: LucideIcon[]
  label?: string
  progressBar?: boolean
}
export type GuideGroup = { title: string; entries: GuideEntry[] }
export type GuideSection = { id: string; title: string; summary: string; groups: GuideGroup[]; notes?: string[] }

export const guideSections: GuideSection[] = [
  {
    id: 'setup',
    title: 'Libraries, setup and administration',
    summary: 'Configure roots, enable file management and choose comic locations',
    groups: [
      {
        title: 'How libraries work',
        entries: [
          {
            icons: [Settings],
            name: 'A library is a mounted server root',
            where: 'Server Docker configuration',
            what: 'Luma reads existing media in directories mounted into the server. A library is a root directory with a stable ID and name; albums are folders inside a library. The paths in Luma configuration are container paths, not host paths. Adding a disk or share requires mounting it and configuring another library, then restarting. The browser cannot access arbitrary paths on your computer.',
            code: 'environment:\n  Luma__Indexing__Libraries__0__Id: "1"\n  Luma__Indexing__Libraries__0__Name: "Photos"\n  Luma__Indexing__Libraries__0__Path: "/media"\n  Luma__Indexing__Libraries__1__Id: "2"\n  Luma__Indexing__Libraries__1__Name: "Comics"\n  Luma__Indexing__Libraries__1__Path: "/comics"\nvolumes:\n  - /your/photos:/media:ro\n  - /your/comics:/comics:ro',
          },
          {
            icons: [Settings],
            name: 'Stable library IDs and indexing',
            where: 'Gallery home / Library setup',
            what: 'Use consecutive configuration indexes starting at 0, but keep each library ID stable and unique across upgrades. Open a library and choose initial indexing options. Scanning reads originals to build the index; normal indexed browsing uses SQLite and cache. Read-only media is sufficient for browsing, tagging, video and captions.',
          },
        ],
      },
      {
        title: 'Enable file management',
        entries: [
          {
            icons: [Settings],
            name: 'Enable the file-management switch',
            where: 'Docker environment, then Settings → General → File management',
            what: 'Turn on Enable file management in Settings → General → File management. The switch is saved for this server and survives refresh/restart. Luma__Files__Enabled supplies the initial environment default; saved in-app choices take priority. There is no administrator password or token. Each editable library also needs Writable=true and a :rw media mount. Flick, Panels and comic metadata work independently of this switch.',
            code: 'environment:\n  Luma__Files__Enabled: "true"\n  Luma__PublicOrigin: "https://luma.example.com"\n  Luma__Indexing__Libraries__0__Writable: "true"\nvolumes:\n  - /your/photos:/media:rw',
          },
          {
            icons: [Settings],
            name: 'Read-only startup warning and recheck',
            where: 'Startup banner / Settings → General → File management',
            what: 'Luma checks write access at startup and when enabling file management. Read-only roots and failed checks disable uploads, folder creation, moves, recycling, restore and deletion for that library. Browsing, captions and database tags keep working. Correct the mount or permissions and choose Check media mounts to restore write actions. The button shows Checking while it runs, then reports how many libraries are writable and the result for each library; it does not change Docker mounts or library configuration. The tiny diagnostic probe uses excluded staging, never an original file. A brief floating notice dismisses automatically; detailed mount information stays in Settings. Dismiss hides the notice for this server boot.',
          },
        ],
      },
      {
        title: 'Panels comic locations',
        entries: [
          {
            icons: [Settings],
            name: 'Set up the bookshelf',
            where: 'Panels → Comic locations',
            what: 'The empty start page has Add comic location. It and Comic locations always open the same dialog. Choose one or more configured libraries and relative folders. Choose folder opens a browser of the mounted library, including unindexed comic folders. Search folders finds indexed folder names and matching visible folders; select the result, then Use this folder. Up one folder and Library root help you navigate without typing. An empty path selects the root. Save locations and scan queues recursive archive discovery. A discovery message shows processed books; the Background jobs icon in the Panels header opens progress, failures and retry controls. Books and folders refresh as discovery runs. Ordinary photo folders become comics only if you explicitly enable Treat folders containing images as comics. This setup works with read-only media and does not require file management to be enabled.',
          },
          {
            icons: [Settings],
            name: 'Exclude comic images from Gallery',
            where: 'Comic locations → Exclude from Gallery',
            what: 'Checked by default for each comic location, including existing locations when upgrading to beta.3. The location and all subfolders are skipped by Gallery discovery and hidden from Gallery results, folder browsing, exclusive tag collections/suggestions and XMP export. Already-indexed media IDs and tags remain stored, so there is no duplicate import or destructive move. Uncheck to restore Gallery visibility; rescan the library to discover images added while excluded. Manually hidden folders stay hidden independently. Overlapping comic locations share the same library/path identity; exclusion applies if any containing location has it checked. Separate server library roots must remain non-overlapping. Luma__Panels__Sources__0__ExcludeFromGallery supplies the initial environment default; saved locations take priority.',
          },
          {
            icons: [Settings],
            name: 'Revisit and change locations',
            where: 'Panels bookshelf → Comic locations',
            what: 'The Panels start page shows up to five recently read unfinished books in a horizontally scrollable Continue reading row with page indicators, followed by your saved locations. Folder cards reuse Gallery smart covers and follow the album-cover style in Settings. Open a location to browse its immediate subfolders and books, such as Base → Manga → DBZ. Up moves to the parent folder; Bookshelf returns to your saved locations. Comic locations lets you add, replace, remove or rescan sources. Books outside the selected locations are hidden; stored metadata and reading progress are preserved for re-adding a location. Search suggests comic titles; Enter searches titles, authors and series across the current library, or all locations from the start page. Filters include series, reading status, favourites and comic tag. Details includes the shared tag editor; comic-only tags do not appear in Gallery collections or suggestions.',
          },
        ],
      },
      {
        title: 'Deployment defaults and application toggles',
        entries: [
          {
            icons: [Settings],
            name: 'Enable or hide applications',
            where: 'Settings → General → Applications',
            what: 'Gallery is always available. Enable or hide Flick and Panels, both on by default, for everyone on this server. In-app choices are saved in SQLite and override Luma__Ui__FlickEnabled and Luma__Ui__PanelsEnabled environment defaults. Settings opens at the originating app’s section and Back returns to that app. The group headings are General, Gallery, Flick and Panels; there is no floating section-navigation bar. Search and Filters are hidden on Settings. Settings is the gear in the top header; bottom navigation contains Library and Collections only.',
          },
          {
            icons: [Settings],
            name: 'Reproduce interface preferences',
            where: 'Docker environment',
            what: 'Use Luma__Ui__Preferences__ followed by the exact preference key. Values are strings; JSON preferences use a quoted JSON object. Saved choices in the app take precedence. Supported keys: luma-theme, luma-appearance-v2, luma-album-covers, luma-reels-sort, luma-slideshow-seconds, luma-video-autoplay, luma-viewer-fill, luma-reels-fill, luma-show-filters, luma-reels-show-filters, luma-reels-state, luma-panels-reader-defaults. Boolean keys accept true/false or 1/0; JSON booleans use true or false. Reader defaults apply to comics without saved preferences.',
            code: `environment:\n  Luma__Ui__FlickEnabled: "true"\n  Luma__Ui__PanelsEnabled: "true"\n  Luma__Ui__Preferences__luma-theme: "forest"\n  Luma__Ui__Preferences__luma-appearance-v2: '{"background":"aurora","blur":4,"opacity":0.7,"darkness":0.1,"motion":"system","splashes":true}'\n  Luma__Ui__Preferences__luma-reels-sort: '{"sort":"modified","order":"desc"}'\n  Luma__Ui__Preferences__luma-reels-state: '{"muted":true,"autoScroll":false}'\n  Luma__Ui__Preferences__luma-panels-reader-defaults: '{"mode":"single","fit":"screen","direction":"ltr"}'\n  Luma__Panels__Sources__0__LibraryId: "2"\n  Luma__Panels__Sources__0__RelativePath: "Manga"\n  Luma__Panels__Sources__0__ImageFolders: "false"`,
          },
        ],
      },
    ],
    notes: [
      'Back up SQLite and original/staging/trash media at one stopped-service checkpoint before upgrading. Older versions reject newer schemas; rollback requires the matching old image and pre-upgrade backup.',
    ],
  },
  {
    id: 'v2-apps',
    title: 'Luma 2.0 applications and files',
    summary: 'Switch applications, manage writable libraries, upload and recover files',
    groups: [
      {
        title: 'Applications and file management',
        entries: [
          {
            label: 'Luma logo',
            name: 'Application switcher',
            where: 'Top-left Luma logo',
            what: 'Click the Luma logo to choose Gallery, Flick or Panels. Its small superscript icon identifies the active app. Each application keeps its own search and filters. Flick and Panels have their own navigation; use the logo to return to Gallery, even when a feed is empty.',
          },
          {
            label: 'Panels',
            name: 'Comic library and reader',
            where: 'Luma logo → Panels',
            what: 'Search comic titles or series, filter by series, comic tag, reading status or favourites, and open a comic to resume reading. On first visit, Comic locations lets you select libraries and folders for recursive discovery. Saved locations open as a bookshelf on later visits; change or rescan them from Comic locations independently of file management. Details edits title, series, author, description, favourite and cover page. The Reader settings icon opens a popup for single or continuous pages, reading direction, fit, zoom and fullscreen. Pinch zoom and drag to pan in the reader; continuous pages touch without artificial gaps and remain virtualized for large books. The compact page counter opens Go to page with a number field and slider; previous/next arrows, swipe and keyboard navigation stay available. Page changes save automatically; Exit reader waits for the latest checkpoint. Reopening fetches saved progress before rendering the reader, including on HTTP LAN hosts.',
          },
          {
            label: 'File management',
            name: 'File and folder changes',
            where: 'Gallery, inside a configured writable library',
            what: 'Use the file-management icon beside Select to reveal or hide Cut, Copy, Paste, Delete, New folder and Upload. Select media or folder checkboxes, choose Cut or Copy, browse into a destination folder, then Paste. The clipboard survives folder navigation; cut clears after successful queueing, while copy remains available. Ctrl/Cmd+X, C and V and Delete work while file management is open, outside text fields and dialogs. Paste stays within the source library and never overwrites collisions. New folder asks for a name in the current folder. Delete recycles by default and queues immediately after confirmation; progress and failures appear in Background jobs. Permanent deletion must be explicitly selected. Read-only libraries disable the file-management icon.',
          },
          {
            label: 'Upload files / Upload folder',
            name: 'Resumable uploads',
            where: 'Gallery → File management → Upload',
            what: 'The upload dialog has Choose files, Choose folder and a drag-and-drop area. Dropped folders keep their hierarchy. Uploads continue after closing the dialog; follow progress in Background jobs. Reselect matching files after a browser refresh to resume saved offsets. Existing destinations are never overwritten. Publication indexes only new files, without rescanning thousands of siblings.',
          },
          {
            label: 'Recycle bin',
            name: 'Restore or permanently remove recycled items',
            where: 'Top of Settings → Recycle bin',
            what: 'Choose a writable library. Shows original paths and deletion dates. Restore returns an item to its original path; use an alternative relative path if that location is occupied. Restore never overwrites another file. Permanently delete asks for confirmation. Automatic retention cleanup is not available yet; recycled files consume media-volume space. The recycle bin is not a backup.',
          },
          {
            label: 'Needs attention',
            name: 'Interrupted file operation recovery',
            where: 'Background jobs → an operation needing attention',
            what: 'Review source, staging and destination evidence, then explicitly choose a supported recovery action. A missing mount or collision keeps the operation reserved until resolved. Do not remove internal staging folders or journal rows to clear it.',
          },
        ],
      },
    ],
  },
  {
    id: 'libraries',
    title: 'Libraries, folders and gallery',
    summary: 'Browse, filter, sort, select and hide folders',
    groups: [
      {
        title: 'Getting around',
        entries: [
          {
            icons: [Images],
            name: 'Library',
            where: 'Bottom bar on phones, side navigation on wider screens',
            what: 'Returns to library browsing with your current folder and filters.',
          },
          {
            label: 'luma.',
            name: 'Luma home',
            where: 'Top left of the header',
            what: 'Clears every filter and returns to Your libraries.',
          },
          {
            icons: [FolderOpen],
            name: 'Open a library or folder',
            where: 'Library cards on Your libraries; folder cards at the top of a folder',
            what: 'Opens it. A library with nothing indexed asks how to index it first.',
          },
          {
            icons: [ChevronRight],
            name: 'Folder breadcrumb',
            where: 'Under the folder title, inside a subfolder',
            what: 'Jumps straight back to any parent folder.',
          },
          {
            label: 'Previous folders',
            name: 'Previous folders / Next folders',
            where: 'Below the folder cards in folders with many subfolders',
            what: 'Pages through the subfolders.',
          },
          {
            label: 'Load more',
            name: 'Load more',
            where: 'Bottom of a long gallery',
            what: 'Loads the next page of results; scrolling to the end does the same.',
          },
        ],
      },
      {
        title: 'Indexing',
        entries: [
          {
            label: 'Index folders as I open them',
            name: 'Set up library',
            where: 'Opens when you choose a library that has not been indexed yet',
            what: 'Choose automatic tag import separately from initial discovery. Lazy setup indexes folders as opened; filesystem watching then keeps changed folders current by default. Index everything now performs the initial full scan.',
          },
          {
            icons: [RefreshCw],
            name: 'Background jobs',
            where: 'Top-right header in Gallery and Panels',
            what: 'Opens the list of indexing, import and export jobs. The icon spins while any job runs.',
          },
          {
            icons: [ArrowDown],
            name: 'Pull to refresh',
            where: 'Top of a gallery, on touch screens',
            what: 'Drag the gallery down from the top to load what you are looking at again. It only refreshes the screen and starts no job; to look for files added on disk, use Rescan folder in the folder menu.',
          },
        ],
      },
      {
        title: 'Folder and gallery menus',
        entries: [
          {
            icons: [EllipsisVertical],
            name: 'Folder actions',
            where: 'On every folder and library card, and in the header of the open folder',
            what: 'Opens the folder menu. A library is its top folder, so its card has the same menu. In the header it also holds the gallery actions below.',
          },
          {
            icons: [RefreshCw],
            name: 'Rescan folder / Rescan library',
            where: 'Folder actions menu',
            what: 'Checks the folder and every folder inside it (or the whole library, from its card) for new, changed or removed files. Choose whether to read embedded metadata or XMP too, then Start rescan; progress shows in Background jobs.',
          },
          {
            icons: [EllipsisVertical],
            name: 'Gallery actions',
            where: 'Header of search results and other views outside a folder',
            what: 'Slideshow, selection, refresh and filter actions for the current results.',
          },
          {
            label: 'Start slideshow',
            name: 'Start slideshow',
            where: 'Folder or gallery actions menu',
            what: 'Opens the first result in the viewer and advances through the rest automatically. A folder that only contains subfolders plays everything inside them.',
          },
          {
            label: 'Refresh collection',
            name: 'Refresh collection',
            where: 'Folder or gallery actions menu',
            what: 'Reloads what is shown from Luma’s index. It never rescans; use Rescan folder for that.',
          },
          {
            icons: [Info],
            name: 'Folder information',
            where: 'Folder actions menu',
            what: 'Shows the folder’s name, library and location.',
          },
          {
            icons: [FileInput],
            name: 'Import folder metadata',
            where: 'Folder actions menu',
            what: 'Merges EXIF/XMP tags from every indexed file in this folder and the folders inside it, regardless of the current filters. Originals are never changed.',
          },
          {
            icons: [ImageMinus],
            name: 'Reset album cover',
            where: 'Folder actions menu, when you picked the folder’s cover yourself',
            what: 'Forgets your cover choice so the folder goes back to an automatic cover in your Settings style. No photos change.',
          },
          {
            icons: [EyeOff],
            name: 'Hide folder',
            where: 'Folder actions menu, for folders inside a library (not the library itself)',
            what: 'Leaves the folder and everything in it out of browsing, search, Flick, slideshows and indexing. Nothing is deleted; show it again from Settings.',
          },
          {
            label: 'Use as folder cover',
            name: 'Use as folder cover / Use as library cover',
            where: 'Media details in the viewer',
            what: 'Makes the open item the cover art for its folder or library.',
          },
        ],
      },
      {
        title: 'Filters and sorting',
        entries: [
          {
            icons: [SlidersHorizontal],
            name: 'Filters',
            where: 'Header, right of search (in Flick: the Flick menu)',
            what: 'Opens Filters and sorting to limit results by folder, tags, search, media type, favourite state, date, size and more.',
          },
          {
            label: 'Edit filters',
            name: 'Edit filters',
            where: 'Folder or gallery actions menu',
            what: 'Opens the same Filters and sorting sheet.',
          },
          {
            label: 'Hide filters',
            name: 'Hide filters / Show filters',
            where: 'Folder or gallery actions menu',
            what: 'Hides or shows the row of active filters under the header. Hiding the row does not clear anything; the filters still apply. Flick remembers its own choice.',
          },
          {
            label: 'Tags: beach ×',
            name: 'Active filter chip',
            where: 'Active-filter row under the header',
            what: 'Removes that one filter. Removing the library also removes the folder.',
          },
          {
            label: 'Clear all filters',
            name: 'Clear all filters',
            where: 'End of the active-filter row, and the folder or gallery actions menu',
            what: 'Removes every filter, including library and folder scope, so results widen to everything.',
          },
          {
            label: 'Sort by',
            name: 'Sort by and Sort direction',
            where: 'Filters and sorting → Order and grouping',
            what: 'Orders media by modified date, captured date, name, type, size or shuffle, ascending or descending.',
          },
          {
            label: 'Reshuffle',
            name: 'Reshuffle',
            where: 'Filters and sorting, when Sort by is Shuffle',
            what: 'Picks a new random order. The same shuffle stays stable while you browse.',
          },
          {
            label: 'Group by',
            name: 'Group by',
            where: 'Filters and sorting → Order and grouping',
            what: 'Groups results under tag, folder, date or type headings, in the same gallery. Tags lists an item under each of its tags and leaves untagged items out.',
          },
          {
            label: 'Clear folder scope',
            name: 'Clear folder scope / Include subfolders',
            where: 'Filters and sorting → Location and name',
            what: 'Drops the folder limit, or includes everything below the folder instead of only its own files.',
          },
          {
            label: 'Reset filters',
            name: 'Apply filters / Reset filters',
            where: 'Bottom of Filters and sorting',
            what: 'Apply uses your changes; Reset removes every filter at once.',
          },
        ],
      },
      {
        title: 'Selecting media',
        entries: [
          {
            icons: [CopyCheck, Check],
            name: 'Select media / Done selecting',
            where: 'Beside the folder or gallery actions button',
            what: 'Shows a checkbox on each thumbnail. Select up to 500 items at a time; use Select all to select the current results.',
          },
          {
            icons: [Tag],
            name: 'Edit tags',
            where: 'Selection bar, once items are selected',
            what: 'Adds or removes one tag on every selected item, or imports their embedded metadata.',
          },
          { icons: [X], name: 'Clear selection', where: 'Selection bar', what: 'Deselects everything.' },
        ],
      },
    ],
    notes: [
      'Folders follow the selected direction. Date sorts order folders by when each folder last changed on disk; every other sort orders them by name, with numbers in order (Day 2 before Day 10) and letter case and accents ignored.',
      'Refresh collection only reloads what Luma has already indexed. Rescan folder (or Rescan library) reads the files on disk again and always asks first.',
      'Hiding the active-filter row only hides it. Use Clear all filters to actually widen the results.',
    ],
  },
  {
    id: 'search',
    title: 'Search, tags and Collections',
    summary: 'Find media, tag it and mark favourites',
    groups: [
      {
        title: 'Search',
        entries: [
          {
            icons: [Search],
            name: 'Search',
            where: 'Header search field in Gallery, Collections, Flick and Panels',
            what: 'Searches file names, folders and tags within the current filters. Inside a folder it covers that folder and its subfolders.',
          },
          {
            icons: [Tag, FolderOpen, FileImage],
            name: 'Search suggestions',
            where: 'Below the search field as you type',
            what: 'Completes tags, folders and file names from your whole library, each marked Tag, Folder or File with where it lives. A tag shows everything with exactly that tag; a folder or file opens it. Press Enter without choosing to search the typed text.',
          },
          {
            icons: [Search, X],
            name: 'Open search / Close search',
            where: 'Header on phones',
            what: 'Phone search starts collapsed. Search, Filters and Settings are grouped on the right. Tap Open search to replace the logo and actions with an input on the same header row; Close search restores the normal header without clearing your query. Suggestions open below the header at its full content width, so they are not squeezed by the other buttons. Desktop search stays visible.',
          },
          {
            icons: [Search],
            name: 'Clear search',
            where: 'Search field',
            what: 'Delete the text with your keyboard and submit the empty field to clear the search and return to the folder you searched from, or to the empty Search page. The cross on phones closes search without clearing your text.',
          },
        ],
      },
      {
        title: 'Tags',
        entries: [
          {
            icons: [Plus],
            name: 'Find or create a tag',
            where: 'Tags in Media details, the Flick Tags sheet and bulk Edit tags',
            what: 'Matching tags list below the field as you type; tap one to add it (tags already on the item show Added). Create “…” adds a new tag, as does pressing Enter.',
          },
          {
            label: 'beach ×',
            name: 'Remove tag',
            where: 'Tag list for the open item',
            what: 'Removes that tag from this item only.',
          },
          {
            label: 'Apply to 3 items',
            name: 'Bulk tag operation',
            where: 'Edit tags for a selection',
            what: 'Choose Add a tag or Remove a tag, then apply it to every selected item.',
          },
        ],
      },
      {
        title: 'Favourites',
        entries: [
          {
            icons: [Heart],
            name: 'Like',
            where: 'Action row in the viewer and Flick, and Media details',
            what: 'Marks the item as a favourite; press again to return it to unrated. Liked thumbnails show a small heart.',
          },
          {
            icons: [HeartCrack],
            name: 'Dislike',
            where: 'Action row in the viewer and Flick, and Media details',
            what: 'Marks the item as disliked; press again to return it to unrated. Disliked items still appear unless you filter them out.',
          },
          {
            label: 'Favourite state',
            name: 'Favourite state filter',
            where: 'Filters and sorting → Media',
            what: 'Shows only Favourites, Hidden (disliked) or Unrated items.',
          },
        ],
      },
      {
        title: 'Collections',
        entries: [
          {
            icons: [Bookmark],
            name: 'Collections',
            where: 'Bottom bar or side navigation',
            what: 'Lists your favourites and every tag. Opening it starts from no filters.',
          },
          {
            icons: [Heart],
            name: 'Open favourites',
            where: 'Collections → Favourites',
            what: 'Shows every liked item.',
          },
          {
            icons: [Tag],
            name: 'Tag',
            where: 'Collections → Tags',
            what: 'Shows every item with that tag. Press and hold to manage the tag.',
          },
          {
            icons: [EllipsisVertical],
            name: 'Manage tag',
            where: 'Beside each tag in Collections',
            what: 'Rename the tag (renaming to another tag’s name merges them) or delete it from every item after confirming.',
          },
        ],
      },
    ],
    notes: [
      'Like and Dislike are toggles: a highlighted heart means the state is on, and pressing it again clears it.',
    ],
  },
  {
    id: 'viewer',
    title: 'Photo and video viewer',
    summary: 'Open a file, navigate, view details and play video',
    groups: [
      {
        title: 'Viewer controls',
        entries: [
          {
            icons: [Presentation, Pause],
            name: 'Slideshow',
            where: 'Top right of the viewer',
            what: 'Starts or pauses a slideshow. Photos advance on a timer, videos when they end, and it stops at the last item.',
          },
          {
            label: '5 s',
            name: 'Slide duration',
            where: 'Beside Slideshow while it runs',
            what: 'Cycles through 3, 5, 10 and 20 seconds per photo. Remembered on this device.',
          },
          {
            icons: [X],
            name: 'Close viewer',
            where: 'Top right of the viewer',
            what: 'Returns to the gallery at the same place.',
          },
          {
            icons: [EllipsisVertical, X],
            name: 'Viewer menu',
            where: 'Bottom right, beside Like and Dislike',
            what: 'Opens or closes the menu of actions above it.',
          },
          {
            icons: [Settings2],
            name: 'View options',
            where: 'Viewer menu',
            what: 'Fit or fill, zoom, actual size, rotate, playback speed, picture in picture, fullscreen, download and stream URL.',
          },
          {
            icons: [Info],
            name: 'Media details',
            where: 'Viewer menu',
            what: 'Like and Dislike, tags, cover choices, metadata import and export, and file information.',
          },
          {
            icons: [Clapperboard],
            name: 'Watch on Flick',
            where: 'Viewer menu, for videos and GIFs',
            what: 'Continues in Flick starting at this item, with the same folder and filters.',
          },
          {
            icons: [ChevronLeft, ChevronRight],
            name: 'Previous item / Next item',
            where: 'Viewer menu',
            what: 'Moves through the current results in their sorted order.',
          },
        ],
      },
      {
        title: 'View options',
        entries: [
          {
            label: 'Fill',
            name: 'Fit / Fill',
            where: 'View options',
            what: 'Shows the whole item, or fills the screen and crops the edges. Remembered on this device.',
          },
          {
            label: '100%',
            name: 'Zoom out, reset zoom, zoom in',
            where: 'View options, for photos',
            what: 'The − and + buttons zoom; the percentage returns to fit.',
          },
          {
            label: 'Actual size',
            name: 'Actual size',
            where: 'View options, for photos',
            what: 'Loads the original file and shows it pixel for pixel.',
          },
          {
            label: 'Rotate',
            name: 'Rotate',
            where: 'View options, for photos',
            what: 'Turns the picture 90° on screen only; the file is not changed.',
          },
          {
            icons: [Maximize],
            name: 'Fullscreen',
            where: 'View options, and the video control bar',
            what: 'Fills the screen. Controls fade while media plays and return when you move or tap.',
          },
          {
            icons: [Minimize],
            name: 'Exit fullscreen',
            where: 'Top right in fullscreen, or the video control bar',
            what: 'Leaves fullscreen.',
          },
          { icons: [Download], name: 'Download', where: 'View options', what: 'Downloads the original file.' },
          {
            label: 'Copy stream URL',
            name: 'Copy stream URL',
            where: 'View options, for videos',
            what: 'Copies the video’s address for VLC or another network-stream player. Use it when this browser cannot play the format; originals are streamed without conversion.',
          },
        ],
      },
      {
        title: 'Video playback',
        entries: [
          {
            icons: [Captions],
            name: 'Captions (CC)',
            where: 'Video playback bar (above it on smaller screens); lower left in Flick',
            what: 'Turns captions on or off for the current video. Captions are off by default. Luma does no subtitle discovery, extraction or conversion until you turn CC on. It discovers matching external SRT and embedded SubRip/SRT, then prepares only the selected track. Caption settings lets you choose among available tracks. Turning CC off removes the track and cancels pending discovery without stopping playback.',
          },
          {
            label: 'Caption settings',
            name: 'Supported subtitle files (2.0)',
            where: 'Beside CC after captions are enabled',
            what: 'For movie.mkv or movie.mp4, place movie.srt in the same folder; .SRT is also recognized. Language-suffixed files such as movie.en.srt and subtitles in other folders are not matched. Embedded tracks must actually use the SubRip/SRT codec. ASS/SSA, PGS/VobSub image subtitles, MP4 mov_text and other codecs are not supported; there is no OCR or automatic subtitle generation. SRT text must be UTF-8 or BOM-marked UTF-16, up to 4 MiB.',
          },
          {
            label: 'Plain text only',
            name: 'Subtitle styling and caching',
            where: 'Video captions',
            what: 'Stylized subtitles are not supported. Author fonts, colors, bold/italic markup, positioning and effects are discarded; captions use the browser’s plain presentation above the playback bar. Extracted SRT, converted WebVTT and all temporary subtitle files stay in the configured Luma cache directory, never beside originals. Cached captions are reused until the source changes or the bounded caption cache evicts them. Preparation errors leave playback available; turn CC off and on to retry.',
          },
          {
            icons: [Play, Pause],
            name: 'Play / Pause',
            where: 'Left of the video control bar',
            what: 'Starts or pauses the video.',
          },
          {
            label: 'Seek',
            name: 'Seek bar',
            where: 'Video control bar',
            what: 'Drag or tap to jump to a time. The lighter part shows what has loaded.',
          },
          {
            icons: [Volume2, VolumeX],
            name: 'Mute / Unmute',
            where: 'Video control bar',
            what: 'Silences the video or restores its volume.',
          },
          {
            label: 'Volume',
            name: 'Volume slider',
            where: 'Video control bar',
            what: 'Sets the volume in fine steps.',
          },
          {
            icons: [ListVideo],
            name: 'Autoplay next video',
            where: 'Video control bar, including fullscreen',
            what: 'When on, the next video starts by itself when the current one ends. Luma remembers the choice. Flick uses its own Auto-scroll instead.',
          },
          {
            label: '1×',
            name: 'Playback speed',
            where: 'Video control bar (View options on upright phones)',
            what: 'Cycles 1×, 1.5×, 2× and 0.5×.',
          },
          {
            icons: [PictureInPicture2],
            name: 'Picture in picture',
            where: 'Video control bar (View options on upright phones), where the browser supports it',
            what: 'Pops the video into a small floating window.',
          },
          {
            label: 'Resume from 1:23',
            name: 'Resume from … / Start from beginning',
            where: 'Over a video you left part-way through',
            what: 'Carries on from where you stopped, or starts again from 0:00.',
          },
        ],
      },
      {
        title: 'Metadata for one item',
        entries: [
          {
            label: 'Import metadata tags',
            name: 'Import metadata tags',
            where: 'Media details, and Media information in Flick',
            what: 'Reads this file’s embedded EXIF/XMP tags into Luma. Tick Include adjacent XMP sidecars to read a matching .xmp file too.',
          },
          {
            label: 'Export XMP',
            name: 'Export XMP',
            where: 'Media details, and Media information in Flick',
            what: 'Prepares a download of this item’s tags as XMP; Download export appears when it is ready.',
          },
        ],
      },
      {
        title: 'Thumbnail indicators',
        entries: [
          {
            icons: [Film],
            name: 'Video badge',
            where: 'Corner of a video thumbnail',
            what: 'Marks a video. GIFs show a GIF badge instead.',
          },
          {
            progressBar: true,
            name: 'Watch progress bar',
            where: 'Along the bottom of a video thumbnail',
            what: 'No bar means unwatched, a partial bar means in progress, and a full bar means watched.',
          },
          {
            icons: [Heart],
            name: 'Liked',
            where: 'Top corner of a thumbnail',
            what: 'The item is one of your favourites.',
          },
        ],
      },
    ],
    notes: [
      'Watch progress is saved on this Luma server, so every browser and device using it shares the same progress. It is not a per-person account sync.',
      'Resume appears in the normal viewer only; Flick always starts a video from the beginning.',
    ],
  },
  {
    id: 'reels',
    title: 'Flick',
    summary: 'Full-screen vertical browsing of videos and GIFs',
    groups: [
      {
        title: 'Flick controls',
        entries: [
          {
            icons: [Clapperboard],
            name: 'Flick',
            where: 'Top-left Luma logo → Flick',
            what: 'Opens Flick with its own saved filters. Switching applications does not copy Gallery filters; the viewer’s Watch on Flick action deliberately carries the current item and context. Without a media type filter Flick shows videos and GIFs.',
          },
          {
            icons: [EllipsisVertical, X],
            name: 'Flick menu',
            where: 'Bottom right, beside Like and Dislike',
            what: 'Opens or closes the Flick actions.',
          },
          {
            icons: [SlidersHorizontal],
            name: 'Filters',
            where: 'Flick header, beside Search',
            what: 'Opens Filters and sorting for Flick. The header search field works like Gallery, with inline tag/folder/file suggestions restricted to videos. Enter applies a video search; choosing a suggestion stays in Flick. Panels uses the same header with comic-title suggestions only.',
          },
          {
            icons: [EyeOff, Eye],
            name: 'Hide filters / Show filters',
            where: 'Flick menu',
            what: 'Hides or shows the active-filter row without clearing any filter. This choice applies to Flick only; Library and Search keep their own.',
          },
          {
            icons: [VolumeX, Volume2],
            name: 'Mute / Unmute',
            where: 'Flick menu',
            what: 'Flick start muted; your choice is remembered on this device.',
          },
          {
            icons: [Timer],
            name: 'Auto-scroll',
            where: 'Flick menu',
            what: 'When on, moves to the next reel when a video ends, or after 3 seconds on a photo. When off, videos loop.',
          },
          { icons: [Tag], name: 'Tags', where: 'Flick menu', what: 'Adds or removes tags on the current reel.' },
          {
            icons: [Settings2],
            name: 'View options',
            where: 'Flick menu',
            what: 'Fit or fill, Open in viewer, volume slider, playback speed, picture in picture, fullscreen, download and stream URL.',
          },
          {
            icons: [Info],
            name: 'Media information',
            where: 'Flick menu',
            what: 'File information plus metadata import and XMP export for this reel.',
          },
          {
            icons: [ChevronUp, ChevronDown],
            name: 'Previous / Next',
            where: 'Flick menu',
            what: 'Moves to the previous or next reel.',
          },
          { icons: [Play], name: 'Play video', where: 'Centre of a paused reel', what: 'Resumes playback.' },
          {
            label: 'Open in viewer',
            name: 'Open in viewer',
            where: 'View options in Flick',
            what: 'Opens the current reel in the normal viewer with its full video controls.',
          },
          {
            label: 'Seek video',
            name: 'Seek bar',
            where: 'Tap the bottom strip of a video reel',
            what: 'Reveals the seek bar for a few seconds; the first touch only reveals it, so playback never jumps by accident.',
          },
        ],
      },
    ],
    notes: [
      'Watch on Flick in the viewer starts at the item you were viewing and keeps your folder and explicit filters.',
      'Flick has a volume slider in View options but no right-side volume swipe: vertical swipes always move between reels.',
      'Flick remembers where you were for the same set of filters.',
    ],
  },
  {
    id: 'tasks',
    title: 'Background jobs',
    summary: 'Scans, metadata imports and exports',
    groups: [
      {
        title: 'Where to find the queue',
        entries: [
          {
            icons: [RefreshCw],
            name: 'Background jobs',
            where: 'Top-right header in Gallery and Panels',
            what: 'Opens the jobs list. Start a rescan from a folder or library card’s Folder actions menu.',
          },
        ],
      },
      {
        title: 'Queue actions',
        entries: [
          {
            label: 'Cancel',
            name: 'Cancel / Cancel scan',
            where: 'On a queued or running task',
            what: 'Stops the task. Work already finished, such as prepared previews and imported tags, is kept. Indexing asks first: folders you open afterwards are finished then, including their tags if the library imports tags.',
          },
          {
            label: 'Queue again',
            name: 'Queue again',
            where: 'On a cancelled, failed or interrupted task',
            what: 'Runs the task again as a new task, which replaces the stopped one in the list.',
          },
          {
            label: 'Clear',
            name: 'Clear',
            where: 'On any task that is no longer active',
            what: 'Removes that one entry from the list.',
          },
          {
            label: 'Clear finished',
            name: 'Clear finished',
            where: 'Top of the queue',
            what: 'Removes every completed, cancelled, failed and interrupted entry and leaves active ones in place.',
          },
        ],
      },
    ],
    notes: [
      'Each task shows what it is (indexing, tag import, XMP export or disliked paths export), its state (queued, running, completed, cancelled, failed or interrupted) and its progress.',
      'Interrupted means Luma stopped the task, for example on restart. An interrupted or cancelled task stops at once and never picks up again by itself.',
      'Clear finished only tidies the list. It does not delete media, scan history or metadata checkpoints.',
      'Finished jobs clear themselves once there are more than ten of a kind, so the list stays short without any tidying.',
      'Cancelling stops further work; it does not undo changes a task has already made.',
    ],
  },
  {
    id: 'settings',
    title: 'Settings',
    summary: 'Updates, theme, album covers, random media links, exports, library tag import and hidden folders',
    groups: [
      {
        title: 'Settings sections',
        entries: [
          {
            label: 'File management / Check media mounts',
            name: 'Writable media mounts (2.0)',
            where: 'Settings → File management',
            what: 'Use Enable file management in Settings → General. No administrator token is required. The saved server switch overrides the Luma__Files__Enabled environment default. Each editable library also needs Writable=true and a :rw mount. Failed mount checks disable write actions for that library; browsing, playback, captions and tagging continue. Correct permissions and use Check media mounts to restore file changes.',
          },
          {
            icons: [Settings],
            name: 'Settings',
            where: 'Gear button in the top header',
            what: 'Opens Settings. Your current filters stay in place for when you return.',
          },
          {
            icons: [CircleFadingArrowUp],
            name: 'Updates',
            where: 'Top of Settings',
            what: 'Shows the release this device is running. When the server has a newer one, Refresh to update loads it; Luma also offers that once, in a small message you can close.',
          },
          {
            icons: [Sparkles],
            name: 'What’s new',
            where: 'Settings → Updates',
            what: 'Lists what changed in this release. It opens by itself the first time you load a new version.',
          },
          {
            label: 'Theme & appearance',
            name: 'Theme & appearance',
            where: 'Settings',
            what: 'Chooses Luma’s colours on this device.',
          },
          {
            label: 'Album covers',
            name: 'Album covers',
            where: 'Settings',
            what: 'Smart covers show a mosaic for albums with three or more photos and fit single photos to the card; Cropped covers fill the card with one photo. Covers you picked yourself keep their photo either way.',
          },
          {
            label: 'Flick',
            name: 'Flick default order',
            where: 'Settings',
            what: 'Chooses the order Flick opens in on this device, such as Shuffle for a new feed each visit. Gallery and Flick retain independent filters and ordering when you switch applications.',
          },
          {
            icons: [Shuffle],
            name: 'Random media URL',
            where: 'Settings',
            what: 'Builds a reusable link that returns a random cached photo or GIF preview matching your current browsing filters. It does not serve random videos.',
          },
          {
            label: 'Export XMP',
            name: 'Export XMP / Export disliked paths',
            where: 'Settings → Metadata exchange',
            what: 'Prepares downloads of your tags as XMP, or a list of disliked file paths. Download export appears when ready.',
          },
          {
            label: 'Libraries',
            name: 'Automatic discovery and tag import',
            where: 'Settings → Libraries',
            what: 'Chooses watcher, periodic-scan or manual discovery per library, refresh-on-open behavior, debounce and stability timing, and the separate embedded/XMP tag-import mode. Tag choices do not affect thumbnails or previews.',
          },
          {
            icons: [Eye],
            name: 'Show',
            where: 'Settings → Hidden folders',
            what: 'Brings a hidden folder back into browsing and indexing.',
          },
          {
            icons: [CircleHelp],
            name: 'Help',
            where: 'Settings, and beside Your libraries',
            what: 'Opens this guide.',
          },
          {
            label: 'About',
            name: 'About',
            where: 'End of Settings',
            what: 'Shows the installed Luma version, project link and creator credit. The version also appears at the bottom-left of desktop navigation.',
          },
        ],
      },
    ],
    notes: [
      'Metadata imports are started from a folder (Folder actions → Import folder metadata) or from a single file (Media details → Import metadata tags), not from Settings.',
    ],
  },
]

export type Gesture = { gesture: string; where: string; result: string }

export const gestures: Gesture[] = [
  { gesture: 'Swipe left or right', where: 'Viewer', result: 'Next or previous item.' },
  { gesture: 'Pinch', where: 'Photos in the viewer', result: 'Zooms in or out; drag to pan while zoomed.' },
  {
    gesture: 'Double-tap',
    where: 'Photos and GIFs in the viewer',
    result: 'Zooms into the tapped spot; double-tap again to return to fit.',
  },
  { gesture: 'Mouse wheel', where: 'Photos in the viewer', result: 'Zooms in or out.' },
  {
    gesture: 'Tap',
    where: 'Videos',
    result: 'Plays or pauses. In fullscreen with hidden controls, the first tap only shows them.',
  },
  {
    gesture: 'Double-tap left or right third',
    where: 'Videos in the viewer and Flick',
    result: 'Skips back or forward 10 seconds.',
  },
  { gesture: 'Press and hold', where: 'Playing videos', result: 'Plays at 2× until you let go.' },
  {
    gesture: 'Swipe up or down on the right side',
    where: 'Videos in the normal viewer only',
    result: 'Raises or lowers the volume, with a brief volume readout.',
  },
  {
    gesture: 'Pull down from the top',
    where: 'Gallery',
    result:
      'Checks the folder in view for new, changed and removed files, using the library’s tag-import setting. It reads that one folder, not the folders inside it: Rescan folder covers those. While a scan is already running, this folder moves to the front of it.',
  },
  {
    gesture: 'Swipe up or down',
    where: 'Flick',
    result: 'Next or previous reel. Mouse wheel and trackpad scrolling do the same.',
  },
  {
    gesture: 'Double-tap / triple-tap the centre',
    where: 'Flick (videos, photos and GIFs)',
    result: 'Likes / dislikes the reel.',
  },
  { gesture: 'Tap the bottom strip', where: 'Video reels', result: 'Reveals the seek bar.' },
  { gesture: 'Press and hold a tag', where: 'Collections → Tags', result: 'Opens Manage tag.' },
]

export type Shortcut = { keys: string[]; result: string }
export type ShortcutGroup = { title: string; shortcuts: Shortcut[] }

export const shortcutGroups: ShortcutGroup[] = [
  {
    title: 'Viewer',
    shortcuts: [
      { keys: ['←', '→'], result: 'Previous or next item' },
      { keys: ['I'], result: 'Open media details' },
      { keys: ['T'], result: 'Open media details with the tag field ready' },
      { keys: ['S'], result: 'Start or pause the slideshow' },
      { keys: ['+', '−'], result: 'Zoom a photo in or out' },
      { keys: ['1'], result: 'Actual size' },
      { keys: ['R'], result: 'Rotate a photo 90°' },
      { keys: ['F'], result: 'Enter or leave fullscreen' },
      { keys: ['Esc'], result: 'Close the top panel, then the viewer' },
    ],
  },
  {
    title: 'Videos',
    shortcuts: [
      { keys: ['Space', 'K'], result: 'Play or pause' },
      { keys: ['J', 'L'], result: 'Back or forward 10 seconds' },
      { keys: ['M'], result: 'Mute or unmute (normal viewer only)' },
    ],
  },
  {
    title: 'Flick',
    shortcuts: [
      { keys: ['↑', '↓'], result: 'Previous or next reel' },
      { keys: ['←', '→'], result: 'Back or forward 5 seconds in a video' },
      { keys: ['Space', 'K'], result: 'Play or pause' },
      { keys: ['J', 'L'], result: 'Back or forward 10 seconds' },
      { keys: ['F'], result: 'Enter or leave fullscreen' },
    ],
  },
]
