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

Luma opens on a libraries-only home screen. The homepage must not fetch or display a combined media feed. Global search may return results across libraries; search inside a folder includes its descendants by default.

Initial indexing is an explicit, per-library choice. A configured library is idle until the user starts it from its library card (or an administrator explicitly enables startup scanning). Opening a ready library must use SQLite and generated cache files only. Album covers use prepared thumbnails, including media inside nested folders. Status and scan controls are available on demand so they never displace the media grid. Rescanning requires confirmation explaining its disk/CPU cost, and mobile browsing retains a visible scan/preparation indicator.

The grid rendering will be done based on subfolders, the usual sorting by date modified, name, type etc. along with shuffle and group by should be available for the user

The user can choose to search for a keyword, tag or date or library, and they should have same browsing/sorting controls available in the search results.

The user can use search to add filters, like date ranges, media type, media extension, starts with/ ends with, size.

The user should not have to wait for original files to be scanned or metadata to be read during normal browsing.

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

Gallery and Reels use the same filter definitions and server query semantics, but their selected filters and sorting are mode-specific state. Switching modes is not required to preserve or synchronize the current query. Reels may clear the gallery library/folder location and default to videos; this is intentional. Each mode's viewer navigation must follow that mode's active query.

## Gallery mode

Gallery mode provides a traditional media browser.

Requirements:

- responsive grid
- virtualized rendering
- lazy thumbnail loading
- custom gallery cover configurable
- smooth scrolling
- mixed photos and videos
- filter and sort (much like the afore mentioned sorting), filters should be video only, date range, keywords etc. Filters and search are synonymously used, filter is just an advanced search here with option to customize the search.
- visible indication of video items
- current filters remain visible or easily accessible
- desktop and mobile layouts
- Some video formats may not be playable by the web player, in which case user should be able to use an external player and stream it via Luma.

Opening the gallery must not require reading source files.

## Reels mode

Reels mode provides full-screen or near-full-screen sequential browsing optimized for touch devices. It is inspired by Tiktok/Instragram reels

Requirements:

- vertical navigation between media
- active videos may autoplay according to browser/platform restrictions.
- auto-scroll as a simple on/off toggle; enabled videos advance when playback ends, with no configurable timing requirement
- only the current and nearby media should be mounted/preloaded
- images and videos are both supported with option to choose them
- the same applicable filter and sort capabilities as gallery, with independent mode state rather than a synchronized query
- tags must remain accessible and nicely rendered like reels captions if user wishes to see it
- dedicated mute button and auto scroll button
- loading a large result set must not create thousands of DOM elements

The first implementation should prioritize smooth navigation over elaborate animations.

Reels does not require the normal video player's full control set or browser-native control chrome. Its required controls are navigation, mute, auto-scroll, filters, and accessible tags. Any seek or other optional playback control that is provided must remain keyboard-accessible. The full playback control requirements below apply to the normal video viewer.

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

The primary mobile destinations are Library, Reels, Search, Collections and Settings. They use a fixed bottom navigation bar. Search, sort and filters stay compact; filters open as a one-column bottom sheet, and scan status stays collapsed until requested. Controls must never consume the gallery's primary viewport or overflow it horizontally.

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
