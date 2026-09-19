import { SettingsSection } from '../components/ui/SettingsSection'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, ChevronRight, CircleHelp, Clapperboard, FolderOpen, GitFork, Images, Search, Settings, Tag, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BottomNavigation, type NavigationItem } from '../components/ui/BottomNavigation'
import { Button } from '../components/ui/Button'
import { IconButton, QuietButton, QuietLink } from '../components/ui/Controls'
import { Modal } from '../components/ui/Modal'
import { SearchHeader, type SearchSuggestion } from '../components/ui/SearchHeader'
import { ThemePicker, themes, type Theme } from '../components/ui/ThemePicker'
import { BackgroundJobsButton } from '../features/status/BackgroundJobs'
import { FolderActions } from '../features/browse/FolderActions'
import { AlbumCover, AlbumCoverSettings } from '../features/browse/AlbumCover'
import { shuffleSeed } from '../features/browse/shuffleSeed'
import { FilterForm } from '../features/browse/FilterForm'
import { Collections } from '../features/browse/Collections'
import { GalleryActions } from '../features/browse/GalleryActions'
import { ActiveFilters } from '../features/browse/ActiveFilters'
import { RandomUrls } from '../features/browse/RandomUrls'
import { Gallery } from '../features/browse/Gallery'
import { Reels } from '../features/browse/Reels'
import { Viewer } from '../features/browse/Viewer'
import { HiddenFolders } from '../features/browse/HiddenFolders'
import { LibrarySettings, LibrarySetup } from '../features/browse/LibrarySetup'
import { SourceVerificationSettings } from '../features/browse/SourceVerificationSettings'
import { MetadataExchange } from '../features/tags/MetadataExchange'
import { TagEditor } from '../features/tags/TagEditor'
import { Help } from '../features/help/Help'
import { errorMessage, queryString, request, type Filters, type FolderPage, type Library, type Media, type MediaPage } from '../features/browse/api'
import packageJson from '../../package.json'

type Section = 'library' | 'reels' | 'search' | 'collections' | 'settings' | 'help'
// Help is opened from another destination and returns to it; `from` keeps that across a refresh.
type HelpOrigin = Exclude<Section, 'help'>
const helpOrigins: HelpOrigin[] = ['library', 'reels', 'search', 'collections', 'settings']

// Reels play everything that moves: videos and animated GIFs.
const reelsMediaType = 'motion'

// Tag grouping repeats an item under each of its tags, which reads as a repeat in Reels and the
// slideshow because they play one item after another. Both browse those filters ungrouped instead.
const ungroupTags = (value: Filters): Filters => value.groupBy === 'tag' ? { ...value, groupBy: 'none' } : value

function readFilters(): Filters {
  const params = new URLSearchParams(window.location.search)
  const numeric = new Set(['libraryId', 'folderId', 'minSizeBytes', 'maxSizeBytes', 'minWidth', 'minHeight', 'width', 'height', 'minAspectRatio', 'maxAspectRatio'])
  const result: Record<string, unknown> = {}
  for (const [key, value] of params) {
    if (key === 'cursor' || key === 'limit' || key === 'media' || key === 'view' || key === 'from') continue
    result[key] = key === 'tag' || key === 'extension' ? params.getAll(key) : numeric.has(key) ? Number(value) : key === 'recursive' || key === 'tagged' ? value === 'true' : value
  }
  if (result.sort === 'shuffle' && !result.seed) result.seed = shuffleSeed()
  return result as Filters
}

function readSection(): Section {
  const params = new URLSearchParams(window.location.search)
  const view = params.get('view')
  return view === 'reels' ? 'reels' : view === 'help' ? 'help' : params.get('q') ? 'search' : 'library'
}

function readHelpOrigin(): HelpOrigin {
  const from = new URLSearchParams(window.location.search).get('from')
  return helpOrigins.find(origin => origin === from) ?? 'library'
}

export function App() {
  const [filters, setFilters] = useState<Filters>(readFilters)
  const [section, setSection] = useState<Section>(readSection)
  const [helpOrigin, setHelpOrigin] = useState<HelpOrigin>(readHelpOrigin)
  const [search, setSearch] = useState(filters.q ?? '')
  const [searchFocusRequested, setSearchFocusRequested] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  // Reels keeps its own filter-row visibility; Library, Search and Collections share one.
  const [filtersVisible, setFiltersVisible] = useState(() => localStorage.getItem('luma-show-filters') !== '0')
  const [reelsFiltersVisible, setReelsFiltersVisible] = useState(() => localStorage.getItem('luma-reels-show-filters') !== '0')
  function toggleFilters() { setFiltersVisible(value => { localStorage.setItem('luma-show-filters', value ? '0' : '1'); return !value }) }
  function toggleReelsFilters() { setReelsFiltersVisible(value => { localStorage.setItem('luma-reels-show-filters', value ? '0' : '1'); return !value }) }
  const filterRowVisible = section === 'reels' ? reelsFiltersVisible : filtersVisible
  const [bulkOpen, setBulkOpen] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState(new Set<number>())
  const [selectionError, setSelectionError] = useState('')
  const [active, setActive] = useState<Media | null>(null)
  const [restoreId] = useState(() => { const id = Number(new URLSearchParams(window.location.search).get('media')); return Number.isSafeInteger(id) && id > 0 ? id : null })
  const [restoreViewer] = useState(() => new URLSearchParams(window.location.search).get('view') !== 'reels')
  const restored = useQuery({ queryKey: ['restore-media', restoreId], queryFn: ({ signal }) => request<Media>(`/api/media/${restoreId}`, signal), enabled: !!restoreId && restoreViewer, gcTime: 0 })
  const restoredOnce = useRef(!restoreViewer)
  useEffect(() => { if (restored.data && !restoredOnce.current) { restoredOnce.current = true; setActive(restored.data) } }, [restored.data])
  const [slideshowStart, setSlideshowStart] = useState(false)
  // A slideshow of a folder with only subfolders plays everything inside it instead.
  const [slideshowFilters, setSlideshowFilters] = useState<Filters | null>(null)
  const [reelsStart, setReelsStart] = useState<number | null>(() => new URLSearchParams(window.location.search).get('view') === 'reels' ? restoreId : null)
  const [reelId, setReelId] = useState<number | null>(restoreViewer ? null : restoreId)
  const [folderCursor, setFolderCursor] = useState<string | undefined>()
  const [refresh, setRefresh] = useState(0)
  const [theme, setTheme] = useState<Theme>(() => themes.find(theme => theme.id === localStorage.getItem('luma-theme'))?.id ?? 'obsidian')
  const scroll = useRef<HTMLDivElement>(null)
  const libraryMemory = useRef<Filters>(filters.q ? {} : filters)
  const searchOrigin = useRef<'library' | 'search'>('search')
  const triggerId = useRef<number | null>(null)
  const viewerScrollTop = useRef(0)
  const client = useQueryClient()
  const libraries = useQuery({ queryKey: ['libraries'], queryFn: ({ signal }) => request<Library[]>('/api/libraries', signal) })
  const library = libraries.data?.find(item => item.id === filters.libraryId)
  const folderOrder = filters.order ?? 'desc'
  // Folders carry a name and their directory's modified time: date sorts order them by that time,
  // every other sort (name, type, size, shuffle) by name. Both follow the selected direction.
  const folderSort = (filters.sort ?? 'modified') === 'modified' || filters.sort === 'captured' ? 'modified' : 'name'
  const folders = useQuery({ queryKey: ['folders', filters.libraryId, filters.folderId, folderCursor, folderSort, folderOrder], queryFn: ({ signal }) => request<FolderPage>(`/api/folders?${new URLSearchParams({ ...(filters.libraryId ? { libraryId: String(filters.libraryId) } : {}), ...(filters.folderId ? { parentId: String(filters.folderId) } : {}), ...(folderCursor ? { cursor: folderCursor } : {}), limit: '48', sort: folderSort, order: folderOrder })}`, signal), enabled: !!(filters.folderId || library?.rootFolderId), gcTime: 0 })
  const [initialLibrary, setInitialLibrary] = useState<Library | null>(null)
  useEffect(() => {
    document.documentElement.dataset.theme = theme; localStorage.setItem('luma-theme', theme)
    // Installed apps and mobile browsers tint their own chrome to match the theme.
    const canvas = getComputedStyle(document.documentElement).getPropertyValue('--color-canvas').trim()
    if (canvas) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', canvas)
  }, [theme])
  useEffect(() => { if (section === 'library' && !filters.q) libraryMemory.current = filters }, [section, filters])
  useEffect(() => { const params = new URLSearchParams(queryString(filters)); if (active) params.set('media', String(active.id)); else if (section === 'reels' && reelId) params.set('media', String(reelId)); else if (restoreId && !restoredOnce.current) params.set('media', String(restoreId)); if (section === 'reels') params.set('view', 'reels'); if (section === 'help') { params.set('view', 'help'); params.set('from', helpOrigin) }; window.history.replaceState(window.history.state, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`) }, [filters, active?.id, section, restoreId, reelId, helpOrigin])
  useEffect(() => {
    if (!window.history.state) window.history.replaceState({ filters: readFilters(), section: readSection() }, '', window.location.href)
    function back(event: PopStateEvent) {
      if (event.state?.lumaModal) return
      const value = event.state?.filters ?? readFilters()
      setFilters(value); setSearch(value.q ?? ''); setSection(event.state?.section ?? 'library'); setFolderCursor(undefined); setReelsStart(null)
      if (event.state?.helpOrigin) setHelpOrigin(event.state.helpOrigin)
    }
    window.addEventListener('popstate', back)
    return () => window.removeEventListener('popstate', back)
  }, [])
  function apply(value: Filters, target: Section = 'library', reelStart: number | null = null) { setReelsStart(reelStart); setReelId(reelStart); window.history[window.history.state?.lumaModal ? 'replaceState' : 'pushState']({ filters: value, section: target }, '', `${window.location.pathname}${queryString(value) ? `?${queryString(value)}` : ''}`); setFilters(value); setSearch(value.q ?? ''); setSelected(new Set()); setFolderCursor(undefined); setFilterOpen(false); setSection(target) }
  function visitLibrary(item: Library) { if (!item.rootFolderId) { setInitialLibrary(item); return }; apply({ libraryId: item.id, folderId: item.rootFolderId }) }
  function navigateSection(target: Section) {
    setSearchFocusRequested(target === 'search')
    if (target === 'search' && section !== 'search') searchOrigin.current = 'search'
    if (target === 'collections') apply({}, target)
    else if (target === 'reels') apply(ungroupTags({ ...filters, mediaType: filters.mediaType ?? reelsMediaType }), target)
    else if (target === 'library') apply(filters, target)
    else if (target === 'search') apply(filters, target)
    else { window.history.pushState({ filters, section: target }, '', window.location.href); setSection(target) }
    setSelecting(false); setSelected(new Set())
  }
  // Help is its own history entry: the origin entry remembers its scroll position, and Back
  // pops to it so its section, filters and folder come back exactly as they were.
  function openHelp() {
    if (section === 'help') return
    const scroller = document.querySelector<HTMLElement>('[data-scroll-restore]')
    window.history.replaceState({ ...window.history.state, scrollTop: scroller?.scrollTop ?? 0 }, '')
    window.history.pushState({ filters, section: 'help', helpOrigin: section }, '', window.location.href)
    setHelpOrigin(section); setSection('help')
  }
  function closeHelp() {
    // Opened directly from a link there is no origin entry to pop, so leave for `from` in place.
    if (window.history.state?.helpOrigin) window.history.back()
    else { window.history.replaceState({ filters, section: helpOrigin }, '', window.location.href); setSection(helpOrigin) }
  }
  const previousSection = useRef(section)
  useLayoutEffect(() => {
    const leftHelp = previousSection.current === 'help' && section !== 'help'
    previousSection.current = section
    if (!leftHelp) return
    const scroller = document.querySelector<HTMLElement>('[data-scroll-restore]')
    if (scroller && typeof window.history.state?.scrollTop === 'number') scroller.scrollTop = window.history.state.scrollTop
    document.querySelector<HTMLElement>('[data-help-entry]')?.focus({ preventScroll: true })
  }, [section])
  const helpParams = new URLSearchParams(queryString(filters))
  helpParams.set('view', 'help'); helpParams.set('from', section === 'help' ? helpOrigin : section)
  function submitSearch() {
    if (!search.trim()) { clearSearch(); return }
    if (section === 'library') searchOrigin.current = 'library'
    apply({ ...filters, q: search.trim(), recursive: filters.folderId ? true : undefined }, 'search')
  }
  // Suggestions are library-wide: a tag shows everything with exactly that tag, a folder opens it,
  // and a file opens that file over results for its name so the viewer can move on to similar names.
  function chooseSuggestion(suggestion: SearchSuggestion) {
    if (section === 'library') searchOrigin.current = 'library'
    if (suggestion.kind === 'tag') { apply({ tag: [suggestion.label] }, 'search'); return }
    if (suggestion.kind === 'folder') { apply({ libraryId: suggestion.libraryId ?? undefined, folderId: suggestion.id }, 'library'); return }
    apply({ q: suggestion.label }, 'search')
    void request<Media>(`/api/media/${suggestion.id}`).then(item => openViewer(item)).catch(() => { /* the results still show the file */ })
  }
  function clearSearch() {
    if (section === 'library' || searchOrigin.current === 'library') apply({ ...libraryMemory.current, q: undefined }, 'library')
    else apply({}, 'search')
  }
  function select(id: number) { setSelected(old => { const next = new Set(old); if (next.has(id)) next.delete(id); else if (next.size < 500) next.add(id); else { setSelectionError('Select at most 500 items at a time.'); return old }; return next }) }
  function openViewer(item: Media, slideshow = false) { triggerId.current = item.id; viewerScrollTop.current = scroll.current?.scrollTop ?? 0; setSlideshowStart(slideshow); setActive(item) }
  async function startSlideshow() {
    setSelectionError('')
    try {
      const scope = ungroupTags(galleryFilters)
      const first = (value: Filters) => request<MediaPage>(`/api/media?${queryString({ ...value, limit: 1 })}`).then(page => page.items[0])
      let item = await first(scope)
      let nested: Filters | null = null
      if (!item && scope.folderId && !scope.recursive) { nested = { ...scope, recursive: true }; item = await first(nested) }
      if (!item) { setSelectionError('There is nothing here to show in a slideshow.'); return }
      setSlideshowFilters(nested)
      openViewer(item, true)
    } catch (error) { setSelectionError(errorMessage(error)) }
  }
  // Continues the viewer's current place in Reels: same scope and filters, limited to
  // media that moves, starting at this item.
  function watchOnReels(item: Media) {
    setActive(null); setSlideshowStart(false)
    apply(ungroupTags(filters), 'reels', item.id)
  }
  function restoreViewerPosition() { if (scroll.current) scroll.current.scrollTop = viewerScrollTop.current; const button = document.querySelector<HTMLButtonElement>(`button[data-media-id="${triggerId.current}"]`); if (button) button.focus({ preventScroll: true }); else scroll.current?.focus({ preventScroll: true }) }
  const hasViewOptions = Object.entries(filters).some(([key, val]) => !['q', 'cursor', 'limit'].includes(key) && val !== undefined && val !== '' && !(Array.isArray(val) && !val.length))
  const home = section === 'library' && !filters.q && !hasViewOptions
  const idleSearch = section === 'search' && !filters.q && !hasViewOptions
  const navItems: NavigationItem[] = [{ id: 'library', label: 'Library', icon: Images }, { id: 'reels', label: 'Reels', icon: Clapperboard }, { id: 'search', label: 'Search', icon: Search }, { id: 'collections', label: 'Collections', icon: Bookmark }, { id: 'settings', label: 'Settings', icon: Settings }]
  const galleryFilters: Filters = filters
  const showAllMedia = section === 'search' || !home && !filters.libraryId
  const galleryTitle = section === 'reels' ? 'Reels' : section === 'collections' ? 'Collections' : filters.q ? `Results for “${filters.q}”` : folders.data?.current.name ?? library?.name ?? (showAllMedia ? 'All media' : 'Library')
  const showGallery = section !== 'collections' && (section === 'reels' || (!home && !idleSearch))
  // auto-fit/minmax has no equivalent in the fixed column-count scale. Cards still
  // need an explicit maximum so a sparse album row remains easy to scan on desktop.
  const folderCards = section === 'library' && folders.data?.items.length ? <section aria-label="Folders" className="grid grid-cols-[repeat(auto-fill,minmax(9rem,24rem))] gap-3 pb-4">
    {folders.data.items.map(folder => <article key={folder.id} className="relative w-full max-w-sm overflow-hidden rounded-xl border border-line bg-surface hover:border-accent">
      {/* One control opens the folder; its caption sits on the cover over a scrim that keeps white text legible on any photo or theme. */}
      <button type="button" aria-label={`Open ${folder.name}`} title={folder.name} className="relative block w-full text-left focus-visible:ring-inset" onClick={() => apply({ ...filters, libraryId: folder.libraryId, folderId: folder.id })}>
        <AlbumCover images={folder.coverImages} override={folder.coverOverride} height="h-32 sm:h-36" fallback={<div className="flex h-full items-center justify-center pb-6 text-muted"><FolderOpen className="size-8 sm:size-10" /></div>} />
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-linear-to-t from-black/85 via-black/50 to-transparent px-3 pt-8 pb-2.5 text-white">
          <FolderOpen className="size-3.5 shrink-0 opacity-80" /><span className="truncate text-sm font-semibold [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">{folder.name}</span>
        </span>
      </button>
      <div className="absolute top-1.5 right-1.5"><FolderActions folder={folder} libraryName={library?.name} ancestors={[...folders.data!.ancestors, folders.data!.current]} tone="overlay" /></div>
    </article>)}
    {(folders.data.previousCursor || folders.data.nextCursor) && <nav aria-label="Folder pages" className="col-span-full flex items-center justify-center gap-3"><QuietButton disabled={!folders.data.previousCursor} onClick={() => setFolderCursor(folders.data?.previousCursor ?? undefined)}>Previous folders</QuietButton><QuietButton disabled={!folders.data.nextCursor} onClick={() => setFolderCursor(folders.data?.nextCursor ?? undefined)}>Next folders</QuietButton></nav>}
  </section> : undefined
  return <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-canvas text-ink">
    <a href="#collection" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-accent focus:p-3 focus:text-on-accent">Skip to collection</a>
    {restored.isError && <p role="alert" className="p-3 text-danger">Could not restore the open item: {errorMessage(restored.error)}</p>}
    {section !== 'reels' && <SearchHeader value={search} onChange={setSearch} onHome={() => apply({})} onFilters={() => setFilterOpen(true)} onSearch={submitSearch} onSuggestion={chooseSuggestion} onClear={clearSearch} searchRequested={searchFocusRequested} />}
    {filterRowVisible && section !== 'settings' && section !== 'help' && <ActiveFilters libraryName={library?.name} folderName={folders.data?.current.name} filters={filters} onApply={value => apply(value, section)} />}
    <div className="flex min-h-0 flex-1"><aside className="hidden w-56 shrink-0 flex-col border-r border-line p-3 md:flex"><nav aria-label="Primary navigation" className="space-y-2">{navItems.map(item => { const Icon = item.icon; const current = section === item.id; return <QuietButton key={item.id} aria-current={current ? 'page' : undefined} className={`w-full justify-start ${current ? 'border-transparent bg-surface text-accent' : 'border-transparent'}`} onClick={() => navigateSection(item.id as Section)}><Icon className="size-4" />{item.label}</QuietButton> })}</nav><div className="mt-8 border-t border-line pt-4"><p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted">Libraries</p>{libraries.data?.map(item => <QuietButton key={item.id} className={`mb-1 w-full justify-start border-transparent ${filters.libraryId === item.id && section === 'library' ? 'bg-surface' : ''}`} onClick={() => visitLibrary(item)}><FolderOpen className="size-4" /><span className="truncate">{item.name}</span></QuietButton>)}</div><footer data-testid="desktop-version" className="mt-auto px-3 pt-4 text-left text-xs text-muted">Luma v{packageJson.version}</footer></aside>
      <main key={`${section}:${queryString(filters)}`} id="collection" className="motion-page flex min-h-0 min-w-0 flex-1 flex-col" tabIndex={-1}>
        {section === 'settings' ? <div className="overflow-auto" data-scroll-restore><ThemePicker value={theme} onChange={setTheme} /><AlbumCoverSettings /><SettingsSection title="Random media URL" description="Generate a reusable random-media link using your current browsing filters."><RandomUrls filters={filters} /></SettingsSection><SettingsSection title="Metadata exchange" description="Download metadata and disliked paths from your library."><MetadataExchange dislikes heading={false} /></SettingsSection><LibrarySettings /><HiddenFolders /><SourceVerificationSettings /><SettingsSection title="Help" description="See what each button, gesture and keyboard shortcut does."><QuietLink data-help-entry href={`?${helpParams}`} className="w-fit" onClick={event => { event.preventDefault(); openHelp() }}><CircleHelp className="size-4" aria-hidden="true" />Open the Help guide</QuietLink></SettingsSection><SettingsSection title="About" description="Version and project information for this Luma installation."><div className="flex flex-col items-start gap-2 text-sm"><p><span className="font-medium">Luma</span> <span className="text-muted">v{packageJson.version}</span></p><p className="text-muted">Created by Sameer Trivedi.</p><QuietLink href="https://github.com/sameert89/luma" target="_blank" rel="noreferrer"><GitFork className="size-4" aria-hidden="true" />GitHub</QuietLink></div></SettingsSection></div> : section === 'help' ? <Help onBack={closeHelp} /> : <>
          {section !== 'reels' && <div className="shrink-0 space-y-2 px-4 pb-2 pt-3 sm:px-6 sm:pb-3 sm:pt-4"><div className="flex min-w-0 items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">{section === 'library' && filters.folderId && <FolderOpen className="size-5 shrink-0 text-accent" />}<h1 className="min-w-0 truncate text-xl font-semibold sm:text-2xl" title={home ? 'Your libraries' : galleryTitle}>{home ? 'Your libraries' : galleryTitle}</h1></div>
            <div className="flex shrink-0 items-center gap-2">{home && <>{libraries.data?.some(item => item.rootFolderId) && <BackgroundJobsButton variant="text" />}<QuietButton data-help-entry onClick={openHelp}><CircleHelp className="size-4" aria-hidden="true" />Help</QuietButton></>}{showGallery && <>
              {section === 'library' && <BackgroundJobsButton libraryId={filters.libraryId} />}
              <GalleryActions folder={section === 'library' ? folders.data?.current : undefined} libraryName={library?.name} ancestors={folders.data?.ancestors} onHidden={() => apply({ ...filters, folderId: folders.data?.current.parentId ?? undefined })} selecting={selecting} onSelect={() => { setSelecting(!selecting); if (selecting) setSelected(new Set()) }} onSlideshow={() => void startSlideshow()} onRefresh={() => { void client.invalidateQueries({ queryKey: ['media'] }); void client.invalidateQueries({ queryKey: ['folders'] }); setRefresh(x => x + 1) }} filtersVisible={filtersVisible} onToggleFilters={toggleFilters} onFilters={() => setFilterOpen(true)} onClearFilters={() => apply({}, section)} />
            </>}</div>
          </div>
          {section === 'library' && folders.data && <>{folders.data.ancestors.length > 0 && <nav aria-label="Folder breadcrumb" className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap text-sm text-muted">{[...folders.data.ancestors, folders.data.current].map((folder, index) => <span key={folder.id} className="flex shrink-0 items-center gap-1"><button type="button" className="rounded-full px-2 py-1 hover:bg-surface hover:text-ink" onClick={() => apply({ ...filters, libraryId: folder.libraryId, folderId: folder.id })}>{folder.name}</button>{index < folders.data.ancestors.length && <ChevronRight className="size-3" />}</span>)}</nav>}</>}
          {selected.size > 0 && <div className="flex items-center gap-3 rounded-2xl bg-surface p-3"><p className="text-sm">{selected.size} selected</p><Button className="min-h-10" onClick={() => setBulkOpen(true)}><Tag className="mr-2 size-4" />Edit tags</Button><IconButton label="Clear selection" onClick={() => setSelected(new Set())}><X className="size-4" /></IconButton></div>}{selectionError && <p role="alert" className="text-sm text-danger">{selectionError}</p>}
          </div>}
          {section === 'collections' ? <Collections onChoose={value => apply(value, 'search')} /> : libraries.data?.length === 0 ? <section className="mx-auto flex max-w-lg flex-col items-center gap-4 p-10 text-center"><FolderOpen className="size-12 text-accent" /><h2 className="text-xl font-semibold">Connect your first library</h2><p className="leading-relaxed text-muted">Add a media folder in the server configuration, then restart Luma.</p></section> : idleSearch ? <section className="mx-auto flex max-w-lg flex-col items-center gap-4 p-10 text-center"><Search className="size-12 text-muted" /><h2 className="text-xl font-semibold">Search your media</h2><p className="text-sm leading-relaxed text-muted">Type a search or open filters to choose exactly what to show.</p></section> : home ? <div className="overflow-auto p-4 sm:p-6" data-scroll-restore><div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,24rem))] gap-3">{libraries.data?.map(item => <article key={item.id} className="relative w-full max-w-sm overflow-hidden rounded-xl border border-line bg-surface hover:border-accent"><button type="button" aria-label={`Open ${item.name}`} title={item.name} className="relative block w-full text-left focus-visible:ring-inset" onClick={() => visitLibrary(item)}><AlbumCover images={item.coverImages} override={item.coverOverride} height="h-32 sm:h-36" fallback={<div className="flex h-full items-center justify-center pb-6 text-muted"><Images className="size-8 sm:size-10" /></div>} /><span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end gap-1.5 bg-linear-to-t from-black/85 via-black/50 to-transparent px-3 pt-8 pb-2.5 text-white"><FolderOpen className="mb-0.5 size-3.5 shrink-0 opacity-80" /><span className="min-w-0"><span className="block truncate text-sm font-semibold [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">{item.name}</span>{!item.rootFolderId && <span className="block text-xs text-white/80">Start indexing</span>}</span></span></button>{item.rootFolderId && <div className="absolute top-1.5 right-1.5"><FolderActions folder={{ id: item.rootFolderId, libraryId: item.id, parentId: null, name: item.name, coverUrl: item.coverUrl, coverOverride: item.coverOverride, coverImages: item.coverImages }} libraryName={item.name} tone="overlay" /></div>}</article>)}</div></div> : <>{section === 'reels' ? <Reels key={`${queryString(filters)}:${refresh}:${reelsStart ?? ''}`} filters={filters} startId={reelsStart} viewerOpen={!!active} filtersVisible={reelsFiltersVisible} onToggleFilters={toggleReelsFilters} onItemChange={setReelId} onFilters={() => setFilterOpen(true)} onOpenViewer={item => { triggerId.current = item.id; setActive(item) }} /> : <Gallery key={`${section}:${queryString(galleryFilters)}:${refresh}`} filters={galleryFilters} selected={selected} selecting={selecting} onSelect={select} onOpen={item => openViewer(item)} scrollerRef={scroll} leadingContent={folderCards} scopePending={section === 'library' && (libraries.isPending || !!(filters.folderId || library?.rootFolderId) && (folders.isPending || folders.isFetching))} scopeError={section === 'library' ? folders.error : null} />}</>}
          {libraries.isError && <p role="alert" className="p-5 text-danger">{errorMessage(libraries.error)}</p>}{folders.isError && <p role="alert" className="px-4 text-sm text-danger">{errorMessage(folders.error)}</p>}
        </>}
      </main></div>
    <BottomNavigation items={navItems} active={section} onChange={id => navigateSection(id as Section)} />
    <LibrarySetup library={initialLibrary} onClose={() => setInitialLibrary(null)} onReady={(libraryId, rootFolderId) => { setInitialLibrary(null); apply({ libraryId, ...(rootFolderId ? { folderId: rootFolderId } : {}) }) }} />
    <Modal open={filterOpen} onOpenChange={setFilterOpen} title="Filters and sorting" description="Narrow the current media view." sheet><FilterForm value={filters} onApply={value => apply(value, section === 'library' || section === 'search' || section === 'reels' ? section : 'search')} /></Modal>
    <Modal open={bulkOpen} onOpenChange={setBulkOpen} title={`Tag ${selected.size} items`} description="Add or remove a tag on every selected item." sheet><div className="overflow-auto p-5"><TagEditor mediaIds={[...selected]} bulk /><div className="mt-6"><MetadataExchange mediaIds={[...selected]} /></div></div></Modal>
    {active && <Viewer active={active} filters={slideshowFilters ?? galleryFilters} startSlideshow={slideshowStart} onChange={setActive} onWatchReels={watchOnReels} onClose={() => { setActive(null); setSlideshowStart(false); setSlideshowFilters(null); requestAnimationFrame(restoreViewerPosition) }} restoreFocus={restoreViewerPosition} />}
  </div>
}
