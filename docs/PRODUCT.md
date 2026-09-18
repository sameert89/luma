# Luma Product Contract

## Product description

Luma is a lightweight, self-hosted browser for large photo and video collections.

Its primary purpose is to make very large existing media libraries enjoyable to browse and easy to search without requiring powerful server hardware.

Luma should feel fast even when the media library contains hundreds of thousands of items.

## Product priorities

In order:

1. Browsing performance.
2. Search and tag performance.
3. Good desktop and mobile UX.
4. Low server resource usage.
5. Simple deployment and maintenance.
6. Preservation of original media.
7. Feature breadth.

When priorities conflict, earlier items generally win.

## Primary user workflows

### Browse library

Luma opens on a libraries-only home screen. The homepage must not fetch or display a combined media feed. Global search may return results across libraries; search inside a folder includes its descendants by default. Collections links such as Favourites may reuse search results without focusing the mobile search field or opening the keyboard; focus is requested only by an explicit search action.

Initial indexing is an explicit, per-library choice. A configured library is idle until the user starts it from its library card (or an administrator explicitly enables startup scanning). Opening a ready library must use SQLite and generated cache files only. Album covers use prepared thumbnails, including media inside nested folders. Status and scan controls are available on demand so they never displace the media grid. Rescanning requires confirmation explaining its disk/CPU cost, and mobile browsing retains a visible scan/preparation indicator.

The grid rendering will be done based on subfolders, the usual sorting by date modified, name, type etc. along with shuffle and group by should be available for the user

The user can choose to search for a keyword, tag or date or library, and they should have same browsing/sorting controls available in the search results. Main search accepts partial words across filenames, root-relative paths and assigned tags, in any order; every word must match somewhere. Explicit tag filters still provide exact normalized tag matching.

Search supplies the keyword; the independent Filters and sorting sheet supplies date ranges, media type, extensions, name/path constraints, size, grouping and ordering. Applying filters preserves the current Library, Search or Reels destination and scope. With no keyword, filters operate on all media in the selected scope; resetting filters preserves the keyword.

The user should not have to wait for original files to be scanned or metadata to be read during normal browsing. Clearing the search field clears the active query, returning to the last library location for a search begun in Library, or the default Search page for a search begun in Search.

Scrolling must remain responsive for extremely large result sets.

### View media

Selecting an item opens a dedicated viewer.

The user can navigate to previous and next media without returning to the gallery.

The viewer gives the preview nearly all available viewport space. File information, preference actions and tag editing live in an on-demand details sheet.

### Search using tags

The user can quickly find media by one or more tags.

Tag search should provide autocomplete.

Tag filtering should work consistently across gallery and reels views.

### Edit tags

The user can:

- add tags
- remove tags
- create new tags
- edit tags quickly from the viewer
- tag multiple selected items
- remove tags from multiple selected items
- use autocomplete for existing tags
- assign multiple tags

Tagging should not require external software.

### Switch browsing modes

A media query can be viewed using different presentation modes.

Initial modes:

- Gallery
- Reels

Gallery and Reels use the same filter definitions and server query semantics, but their selected filters and sorting are mode-specific state. Modes are not synchronized in either direction: the gallery's query never becomes the Reels query, and nothing chosen while browsing Reels — its library/folder scope, sort, or any other filter — changes the folder or query that Library and Search return to. Reels keeps the filters and sort last chosen in Reels and restores them on return, including after a restart; its first ever visit clears the gallery library/folder location and defaults to videos and animated GIFs (`mediaType=motion`). The exception is the viewer's explicit **Watch on Reels** action for a video or GIF: it opens Reels at that item within the viewer's current scope and filters, limited to media that moves. Each mode's viewer navigation must follow that mode's active query.

## Gallery mode

Gallery mode provides a traditional media browser.

Requirements:

- responsive grid
- virtualized rendering
- lazy thumbnail loading
- custom gallery cover configurable: automatic selection is the default; the media viewer info dialog exposes only Use as folder cover and Use as library cover
- smooth scrolling
- mixed photos and videos
- filter and sort (much like the afore mentioned sorting), filters should be video only, date range, keywords etc. Filters refine the current view independently of keyword search.
- visible indication of video items
- current filters remain visible or easily accessible
- desktop and mobile layouts
- Some video formats may not be playable by the web player, in which case user should be able to use an external player and stream it via Luma.

Opening the gallery must not require reading source files.

## Reels mode

Reels mode provides full-screen or near-full-screen sequential browsing optimized for touch devices. It is inspired by Tiktok/Instragram reels

Requirements:

- vertical navigation between media
- active videos may autoplay according to browser/platform restrictions, and loop continuously until the person moves on (auto-scroll instead advances when a video ends).
- auto-scroll as a simple on/off toggle; enabled videos advance when playback ends and photos advance after a fixed dwell time (3 seconds), with no configurable timing requirement. The active reel is restored after navigating away and back to the same filters/sort; mute and auto-scroll preferences are retained. Changing the feed resets its position. Playback and auto-scroll pause while sheets or the media viewer cover Reels; opening the viewer pauses the underlying stream first, and only previously playing reels resume when it closes
- Reels uses the standard media action row (see below): Like, Dislike and the menu toggle at the bottom right, sitting just above the seek strip. Filters, mute, auto-scroll, tags, view options, media information and previous/next (up/down chevrons) live in the menu, which opens upward; the toggle becomes an X when open. View options uses a settings icon within that menu, with no separate bottom options button. Tags, media information and view options use accessible sheets with explicit close buttons, outside-click dismissal and Escape support. Navigation and playback still work without opening the menu
- only the current and nearby media should be mounted/preloaded; the next video fetches only its metadata and first bytes, never the whole file
- images, animated GIFs and videos are all supported with option to choose them
- the same applicable filter and sort capabilities as gallery, with independent mode state rather than a synchronized query
- tags must remain accessible and nicely rendered like reels captions if user wishes to see it
- dedicated mute button and auto scroll button
- tapping the media pauses or resumes a video; double tapping its centre likes the item and triple tapping it dislikes the item (the like from the first two taps is not sent when a third follows); double tapping the left or right third of a video skips 10 seconds, and pressing and holding plays it at 2× until release
- playback progress stays out of the way: it appears when its strip is tapped or focused and fades out again
- loading a large result set must not create thousands of DOM elements

The first implementation should prioritize smooth navigation over elaborate animations.

Reels does not require the normal video player's full control set or browser-native control chrome. Its required controls are navigation, mute, auto-scroll, like, filters, and accessible tags. Any seek or other optional playback control that is provided must remain keyboard-accessible, and controls that hide themselves must reappear on keyboard focus. Touch gestures are shortcuts for controls that also exist as buttons, never the only way to reach a behaviour. The full playback control requirements below apply to the normal video viewer.

## Standard media action row

Every media surface — the photo viewer, the video viewer and Reels — uses one action row with the same contents, order and placement, so controls never move between modes:

- Like, Dislike and a three-dot menu toggle, side by side at the right end of a single row near the bottom of the stage.
- The row sits directly above the player bar where one exists (the video controls, or the Reels seek strip) and stays at that same height for photos, so moving between photos and videos never shifts it.
- The menu opens upward from the toggle and holds every secondary action. In the viewer: view options, media details, Watch on Reels (videos and GIFs), and previous/next item using ‹ › chevrons — there are no separate arrow buttons on the stage. Keyboard arrows and swipes still navigate. In Reels: filters, mute, auto-scroll, tags, view options, media information and previous/next.
- Like and Dislike are toggle buttons (`aria-pressed`) with constant names. Liked shows a filled heart; disliked shows an outlined broken heart in the danger colour, never a filled shape, so it cannot be mistaken for a like.
- A running slideshow fades the row with the rest of the viewer chrome; faded controls do not receive clicks.

## Likes/Dislikes and existence of dislike export
- The user should be able to like/favourite a piece of media and then filter based on the likes if they wish to do so.
- The user should be able to dislike a piece of media
- The user should be able to export their disliked media, this requirement is so that they can later delete them if they want, a list with full paths should be exportable

## Image viewer

The image viewer should support:

- previous item
- next item
- fit to screen
- fill available space
- 100% / actual-size viewing where meaningful
- zoom in
- zoom out
- pan when zoomed
- rotate for viewing
- fullscreen
- tag editing
- basic metadata display
- access to the original file

Rotation performed in the viewer is initially visual-only unless an explicit persistence feature is later introduced.

## Video viewer

The video viewer should use the browser's native media playback capabilities.

Required controls in the normal video viewer (not Reels):

- play/pause
- seek
- volume
- mute
- fullscreen
- playback speed
- fit/fill behavior where practical
- previous item
- next item
- tag editing
- basic metadata display

Luma must not implement its own decoding engine.

Playback should feel like a streaming service's player:

- the scrubber moves smoothly, shows played and buffered ranges, and dragging it previews the position at once while throttling actual seeks
- a buffering indicator appears when playback genuinely stalls
- double tapping the left/right of the video skips 10 seconds; pressing and holding plays at 2× and restores the chosen speed on release; J/K/L and M are keyboard shortcuts
- picture-in-picture where the browser supports it, background playback, and lock-screen/headset controls through Media Session
- in fullscreen, controls hide after a few seconds of inactivity during playback, return on any interaction, and a visible exit-fullscreen control is always offered
- on upright phones the scrubber gets its own full-width, larger row and secondary controls compact into the row below (volume is left to the hardware keys); landscape phones, tablets and desktop keep the single-row player

## Slideshow

The viewer can run the active query as a slideshow, started from the viewer (button or S) or from the gallery toolbar. Photos and GIFs advance after a chosen dwell time (3, 5, 10 or 20 seconds, remembered per device), videos play through and advance when they end, and the next slide is decoded ahead of time. Viewer chrome fades while the pointer rests. The slideshow stops at the end of the results rather than wrapping.

## Hidden folders

A folder (never a library root) can be hidden from its folder actions. The folder and everything beneath it disappear from Library, Search, Reels, slideshows and covers and are no longer indexed; nothing on disk changes. Settings lists hidden folders and shows them again instantly.

The normal video viewer must expose the complete playback control set above using the browser's native playback capabilities. Controls may use Luma's themed interface; displaying browser-default control chrome is not required.

## Search

Initial searchable/filterable properties:

- tags
- media type
- date range
- orientation
- path
- starts with
- ends with
- extension
- tagged/untagged
- liked/disliked
- dimensions (w/h larger than/exact)
- aspect ratio

Possible future searchable properties:

- camera metadata
- duration
- Facial data
- delta

Do not add these until the primary browsing experience is working well or is explicitly stated mid way.

## Tags

Tags are a first-class feature.

Tag editing should require minimal interaction.

Desktop goal:

- keyboard-accessible tag editor
- autocomplete
- Enter to apply
- fast removal
- minimal modal dialogs

Mobile goal:

- tag editing remains accessible without navigating to a separate administration page

Tags are case-insensitively unique.

Existing tags can be renamed (fixing a typo) or deleted (removing it and every assignment). Renaming into another tag's spelling merges the two rather than failing. Collections exposes this from each tag: a long press is a touch shortcut, and a visible manage control reaches the same rename/delete action for keyboard and pointer users, since a gesture is never the only way to reach a control.

Example:

```text
Vacation
vacation
VACATION
```

must resolve to one logical tag.

## Bulk operations

Initial bulk operation:

- add tags to selected media
- remove tags from selected media

Bulk operations should be implemented using dedicated server-side operations rather than one HTTP call per media item.

## Random media API

Luma provides a simple endpoint suitable for embedding a random image elsewhere.

Baseline behavior:

```text
GET /api/random
```

returns image content.

The API should support the same filters that search does

Examples:

```text
GET /api/random?tag=wallpaper
GET /api/random?orientation=landscape
GET /api/random?tag=cat&orientation=landscape
```

The endpoint should remain intentionally easy to use.

## Theming

Luma should support a coherent & beautiful theme system.

Initial requirement:

- Dark and White
- Catpuccin
- Orange & Black
- Red & White

Theme styling should be based on reusable design tokens/CSS variables rather than scattered hard-coded values.

Inter is the default interface typeface, served with the application so browsing does not depend on a third-party font service. Interface icons come from the shared Lucide React set; feature code should not maintain hand-drawn SVG path data.

The UI should remain visually consistent across:

- gallery
- viewer
- reels
- tag editor
- search/filter interfaces

## Mobile UX

Mobile is a first-class client.

The interface must not simply shrink the desktop layout.

The primary mobile destinations are Library, Reels, Search, Collections and Settings. They use a fixed bottom navigation bar. Search, sort and filters stay compact; filters open as a one-column bottom sheet, and scan status stays collapsed until requested. The folder heading truncates within a single row alongside icon-only preparation and selection controls, plus a folder actions toggle. Preparation spins while busy; selection becomes an X while active. There is no separate sort pill. Each folder card also exposes its own three-dot actions toggle beside its truncated name; folder information and whole-folder metadata import live in that menu. Full names and location remain available in folder information. Controls must never consume the gallery's primary viewport or overflow it horizontally.

Important mobile workflows:

- scroll gallery
- open media
- swipe/navigate media
- use reels
- edit tags
- search tags
- return to previous query state

## Desktop UX

Desktop should support:

- mouse
- keyboard
- large screens
- dense gallery browsing

Keyboard shortcuts should eventually cover common viewer operations.

Potential defaults:

```text
Left Arrow   previous
Right Arrow  next
+            zoom in
-            zoom out
1            actual size
T            edit tags
I            information
Escape       close viewer
```

Exact shortcuts may change after UX testing. And these should be listed in help section of the application.

## Data safety

Original files must not be modified by routine application behavior.

Tag editing changes Luma's database.

Metadata export is a separate explicit operation.

## Authentication

Authentication is not required for the initial local/private-network version.

The architecture should not prevent authentication from being introduced later.

Authentication must not be allowed to complicate the initial browsing architecture.

## Explicit initial non-goals

Initial versions should not include:

- face recognition
- object recognition
- AI search
- cloud synchronization
- automatic albums
- collaborative sharing
- photo editing
- video editing
- duplicate detection
- geographic maps
- complex role-based access control

Features may be reconsidered later based on actual use.
