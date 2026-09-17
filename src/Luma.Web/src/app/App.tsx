import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, ChevronRight, Clapperboard, FolderOpen, Images, Keyboard, MonitorPlay, RefreshCw, Search, Settings, Smartphone, Tag, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BottomNavigation, type NavigationItem } from '../components/ui/BottomNavigation'
import { Button } from '../components/ui/Button'
import { IconButton, QuietButton, Select } from '../components/ui/Controls'
import { Modal } from '../components/ui/Modal'
import { CachedImage } from '../components/ui/CachedImage'
import { SearchHeader } from '../components/ui/SearchHeader'
import { ThemePicker, themes, type Theme } from '../components/ui/ThemePicker'
import { RescanButton } from '../features/browse/RescanButton'
import { FilterForm } from '../features/browse/FilterForm'
import { Gallery } from '../features/browse/Gallery'
import { ScanControls } from '../features/browse/ScanControls'
import { Reels } from '../features/browse/Reels'
import { Viewer } from '../features/browse/Viewer'
import { TagEditor } from '../features/tags/TagEditor'
import { errorMessage, queryString, request, type Filters, type FolderPage, type Library, type Media } from '../features/browse/api'

type Section = 'library' | 'reels' | 'search' | 'collections' | 'settings'

function reelsFilters(value: Filters): Filters {
  return { ...value, libraryId: undefined, folderId: undefined, mediaType: 'video' }
}

function libraryFilters(value: Filters, from: Section): Filters {
  return from === 'reels' && value.mediaType === 'video' ? { ...value, mediaType: undefined } : value
}

function searchFilters(value: Filters, from: Section): Filters {
  return from === 'reels' && value.mediaType === 'video' ? { ...value, mediaType: undefined } : value
}

function CoverArt({ url, height, fallback }: { url?: string | null; height: string; fallback: ReactNode }) {
  return <div className={`relative overflow-hidden bg-canvas ${height}`}>
    {url ? <>
      <CachedImage url={url} status="ready" alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-45 blur-md" />
      <div className="absolute inset-0 bg-canvas/25" />
      <CachedImage url={url} status="ready" alt="" className="relative z-10 h-full w-full object-contain p-1" />
    </> : fallback}
  </div>
}

function readFilters(): Filters {
  const params = new URLSearchParams(window.location.search)
  const numeric = new Set(['libraryId', 'folderId', 'minSizeBytes', 'maxSizeBytes', 'minWidth', 'minHeight', 'width', 'height', 'minAspectRatio', 'maxAspectRatio'])
  const result: Record<string, unknown> = {}
  for (const [key, value] of params) {
    if (key === 'cursor' || key === 'limit') continue
    result[key] = key === 'tag' || key === 'extension' ? params.getAll(key) : numeric.has(key) ? Number(value) : key === 'recursive' || key === 'tagged' ? value === 'true' : value
  }
  return result as Filters
}

export function App() {
  const [filters, setFilters] = useState<Filters>(readFilters)
  const [section, setSection] = useState<Section>(() => readFilters().q ? 'search' : 'library')
  const [search, setSearch] = useState(filters.q ?? '')
  const [filterOpen, setFilterOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState(new Set<number>())
  const [selectionError, setSelectionError] = useState('')
  const [active, setActive] = useState<Media | null>(null)
  const [folderCursor, setFolderCursor] = useState<string | undefined>()
  const [refresh, setRefresh] = useState(0)
  const [theme, setTheme] = useState<Theme>(() => themes.find(theme => theme.id === localStorage.getItem('luma-theme'))?.id ?? 'obsidian')
  const scroll = useRef<HTMLDivElement>(null)
  const triggerId = useRef<number | null>(null)
  const viewerScrollTop = useRef(0)
  const client = useQueryClient()
  const libraries = useQuery({ queryKey: ['libraries'], queryFn: ({ signal }) => request<Library[]>('/api/libraries', signal) })
  const library = libraries.data?.find(item => item.id === filters.libraryId)
  const folders = useQuery({ queryKey: ['folders', filters.libraryId, filters.folderId, folderCursor], queryFn: ({ signal }) => request<FolderPage>(`/api/folders?${new URLSearchParams({ ...(filters.libraryId ? { libraryId: String(filters.libraryId) } : {}), ...(filters.folderId ? { parentId: String(filters.folderId) } : {}), ...(folderCursor ? { cursor: folderCursor } : {}), limit: '48' })}`, signal), enabled: !!(filters.folderId || library?.rootFolderId), gcTime: 0 })
  const startScan = useMutation({ mutationFn: (libraryId: number) => request(`/api/libraries/${libraryId}/scans`, undefined, 'POST', {}), onSuccess: () => client.invalidateQueries({ queryKey: ['indexing'] }) })
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('luma-theme', theme) }, [theme])
  useEffect(() => { window.history.replaceState(window.history.state, '', `${window.location.pathname}${queryString(filters) ? `?${queryString(filters)}` : ''}`) }, [filters])
  useEffect(() => {
    if (!window.history.state) window.history.replaceState({ filters: readFilters(), section: readFilters().q ? 'search' : 'library' }, '', window.location.href)
    function back(event: PopStateEvent) {
      if (event.state?.lumaModal) return
      const value = event.state?.filters ?? readFilters()
      setFilters(value); setSearch(value.q ?? ''); setSection(event.state?.section ?? 'library'); setFolderCursor(undefined)
    }
    window.addEventListener('popstate', back)
    return () => window.removeEventListener('popstate', back)
  }, [])
  function apply(value: Filters, target: Section = 'library') { window.history[window.history.state?.lumaModal ? 'replaceState' : 'pushState']({ filters: value, section: target }, '', `${window.location.pathname}${queryString(value) ? `?${queryString(value)}` : ''}`); setFilters(value); setSearch(value.q ?? ''); setSelected(new Set()); setFolderCursor(undefined); setFilterOpen(false); setSection(target) }
  function visitLibrary(item: Library) { apply({ libraryId: item.id, folderId: item.rootFolderId ?? undefined }); if (!item.rootFolderId) startScan.mutate(item.id) }
  function navigateSection(target: Section) {
    if (target === 'collections') apply({}, target)
    else if (target === 'reels') apply(reelsFilters(filters), target)
    else if (target === 'library') apply(libraryFilters(filters, section), target)
    else if (target === 'search') apply(searchFilters(filters, section), target)
    else { window.history.pushState({ filters, section: target }, '', window.location.href); setSection(target) }
    setSelecting(false); setSelected(new Set())
  }
  function select(id: number) { setSelected(old => { const next = new Set(old); if (next.has(id)) next.delete(id); else if (next.size < 500) next.add(id); else { setSelectionError('Select at most 500 items at a time.'); return old }; return next }) }
  function restoreViewerPosition() { if (scroll.current) scroll.current.scrollTop = viewerScrollTop.current; const button = document.querySelector<HTMLButtonElement>(`button[data-media-id="${triggerId.current}"]`); if (button) button.focus({ preventScroll: true }); else scroll.current?.focus({ preventScroll: true }) }
  const filterCount = Object.entries(filters).filter(([key, val]) => !['libraryId', 'folderId', 'order', 'sort', 'q'].includes(key) && val !== undefined && val !== '' && !(Array.isArray(val) && !val.length)).length
  const home = section === 'library' && !filters.libraryId && !filters.q && filterCount === 0
  const idleSearch = section === 'search' && !filters.q && filterCount === 0
  const navItems: NavigationItem[] = [{ id: 'library', label: 'Library', icon: Images }, { id: 'reels', label: 'Reels', icon: Clapperboard }, { id: 'search', label: 'Search', icon: Search }, { id: 'collections', label: 'Saved', icon: Bookmark }, { id: 'settings', label: 'Settings', icon: Settings }]
  const galleryFilters: Filters = section === 'collections' ? { ...filters, preference: 'liked' } : filters
  const galleryTitle = section === 'reels' ? 'Reels' : section === 'collections' ? 'Favourites' : filters.q ? `Results for “${filters.q}”` : folders.data?.current.name ?? library?.name ?? 'Library'
  const showGallery = section === 'reels' || section === 'collections' || (!home && !idleSearch)
  const helpCards = [
    { icon: Keyboard, title: 'Viewer shortcuts', body: 'Left and Right move through media. + and − zoom, 1 opens actual size, R rotates, F toggles fullscreen, I opens details, T jumps to tags, and Escape closes the top panel.' },
    { icon: Smartphone, title: 'Touch gestures', body: 'Swipe left or right in the viewer. Pinch images to zoom, then drag to pan. Reels use vertical swipes and Up or Down on a keyboard.' },
    { icon: MonitorPlay, title: 'Video handoff', body: 'If a video is unsupported, copy its stream URL and open it in VLC or another network-stream player that can reach this Luma server. Originals are streamed without transcoding.' }
  ]
  const folderCards = section === 'library' && folders.data?.items.length ? <section aria-label="Folders" className="grid grid-cols-2 gap-3 pb-4 sm:grid-cols-3 xl:grid-cols-5">
    {folders.data.items.map(folder => <button key={folder.id} type="button" className="group overflow-hidden rounded-lg border border-line bg-surface text-left hover:border-accent" onClick={() => apply({ ...filters, libraryId: folder.libraryId, folderId: folder.id })}>
      <CoverArt url={folder.coverUrl} height="h-24 sm:h-28" fallback={<div className="flex h-full items-center justify-center text-muted"><FolderOpen className="size-8 sm:size-10" /></div>} />
      <div className="flex items-center gap-2 p-3 sm:gap-3 sm:p-4"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-canvas text-accent sm:size-10"><FolderOpen className="size-4 sm:size-5" /></span><div className="min-w-0"><h2 className="truncate text-sm font-semibold">{folder.name}</h2><p className="text-xs text-muted">Open folder</p></div></div>
    </button>)}
  </section> : undefined
  return <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-canvas text-ink">
    <a href="#collection" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-accent focus:p-3 focus:text-on-accent">Skip to collection</a>
    {section !== 'reels' && <SearchHeader value={search} onChange={setSearch} onHome={() => apply({})} onFilters={() => setFilterOpen(true)} onSearch={() => apply({ ...filters, q: search.trim() || undefined, recursive: search.trim() && filters.folderId ? true : undefined }, 'search')} searchRequested={section === 'search'} />}
    <div className="flex min-h-0 flex-1"><aside className="hidden w-56 shrink-0 border-r border-line p-3 md:block"><nav aria-label="Primary navigation" className="space-y-2">{navItems.map(item => { const Icon = item.icon; const current = section === item.id; return <QuietButton key={item.id} aria-current={current ? 'page' : undefined} className={`w-full justify-start ${current ? 'border-transparent bg-surface text-accent' : 'border-transparent'}`} onClick={() => navigateSection(item.id as Section)}><Icon className="size-4" />{item.label}</QuietButton> })}</nav><div className="mt-8 border-t border-line pt-4"><p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted">Libraries</p>{libraries.data?.map(item => <QuietButton key={item.id} className={`mb-1 w-full justify-start border-transparent ${filters.libraryId === item.id && section === 'library' ? 'bg-surface' : ''}`} onClick={() => visitLibrary(item)}><FolderOpen className="size-4" /><span className="truncate">{item.name}</span></QuietButton>)}</div></aside>
      <main key={`${section}:${queryString(filters)}`} id="collection" className={`motion-page flex min-w-0 flex-1 flex-col ${section === 'reels' ? 'pb-0' : 'pb-20 md:pb-0'}`} tabIndex={-1}>
        {section === 'settings' ? <div className="overflow-auto"><ThemePicker value={theme} onChange={setTheme} /><section className="mx-auto grid max-w-5xl gap-4 p-5 sm:grid-cols-3"><div className="rounded-3xl border border-line bg-surface p-5 sm:col-span-3"><p className="text-sm font-medium text-accent">Guide</p><h2 className="mt-1 text-2xl font-semibold">Help and shortcuts</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">Quick controls for browsing large collections without leaving the keyboard or touch surface.</p></div>{helpCards.map(card => { const Icon = card.icon; return <article key={card.title} className="rounded-3xl border border-line bg-surface p-5"><span className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-canvas text-accent"><Icon className="size-6" /></span><h3 className="text-base font-semibold">{card.title}</h3><p className="mt-2 text-sm leading-relaxed text-muted">{card.body}</p></article> })}</section></div> : <>
          {section !== 'reels' && <div className="shrink-0 space-y-2 px-4 pb-2 pt-3 sm:space-y-3 sm:px-6 sm:pb-3 sm:pt-4"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="hidden text-xs text-muted sm:block">{section === 'collections' ? 'Your saved media' : home ? 'Your spaces' : filters.q ? 'Search' : 'Library'}</p><h1 className="truncate text-xl font-semibold sm:text-2xl">{home ? 'Your libraries' : galleryTitle}</h1></div><div className="flex shrink-0 gap-2">{showGallery && <><Select shape="pill" aria-label="Sort media" className="hidden w-36 sm:block" value={filters.order ?? 'desc'} onChange={event => apply({ ...filters, order: event.target.value }, section)}><option value="desc">Newest first</option><option value="asc">Oldest first</option></Select>{filters.libraryId && section === 'library' ? <RescanButton libraryId={filters.libraryId} name={library?.name} /> : <IconButton label="Refresh collection" onClick={() => { void client.invalidateQueries({ queryKey: ['media'] }); setRefresh(x => x + 1) }}><RefreshCw className="size-4" /></IconButton>}<QuietButton className={selecting ? 'border-accent bg-accent text-on-accent' : ''} aria-pressed={selecting} onClick={() => { setSelecting(!selecting); if (selecting) setSelected(new Set()) }}>{selecting ? 'Done selecting' : 'Select'}</QuietButton></>}</div></div>
          {section === 'library' && folders.data && <>{folders.data.ancestors.length > 0 && <nav aria-label="Folder breadcrumb" className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap text-sm text-muted">{[...folders.data.ancestors, folders.data.current].map((folder, index) => <span key={folder.id} className="flex shrink-0 items-center gap-1"><button type="button" className="rounded-full px-2 py-1 hover:bg-surface hover:text-ink" onClick={() => apply({ ...filters, libraryId: folder.libraryId, folderId: folder.id })}>{folder.name}</button>{index < folders.data.ancestors.length && <ChevronRight className="size-3" />}</span>)}</nav>}</>}
          {selected.size > 0 && <div className="flex items-center gap-3 rounded-2xl bg-surface p-3"><p className="text-sm">{selected.size} selected</p><Button className="min-h-10" onClick={() => setBulkOpen(true)}><Tag className="mr-2 size-4" />Edit tags</Button><IconButton label="Clear selection" onClick={() => setSelected(new Set())}><X className="size-4" /></IconButton></div>}{selectionError && <p role="alert" className="text-sm text-danger">{selectionError}</p>}
          </div>}
          {libraries.data?.length === 0 ? <section className="mx-auto flex max-w-lg flex-col items-center gap-4 p-10 text-center"><FolderOpen className="size-12 text-accent" /><h2 className="text-xl font-semibold">Connect your first library</h2><p className="leading-relaxed text-muted">Add a media folder in the server configuration, then restart Luma.</p></section> : idleSearch ? <section className="mx-auto flex max-w-lg flex-col items-center gap-4 p-10 text-center"><Search className="size-12 text-muted" /><h2 className="text-xl font-semibold">Search your media</h2><p className="text-sm leading-relaxed text-muted">Type a search or open filters to choose exactly what to show.</p></section> : home ? <div className="overflow-auto p-4 sm:p-6"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{libraries.data?.map(item => <section key={item.id} className="overflow-hidden rounded-2xl border border-line bg-surface"><button type="button" className="block w-full text-left" disabled={startScan.isPending} onClick={() => visitLibrary(item)}><CoverArt url={item.coverUrl} height="h-24 sm:h-32" fallback={<div className="flex h-full items-center justify-center gap-2 text-xs text-muted sm:text-sm"><Images className="size-5 sm:size-6" />{item.rootFolderId ? 'Preparing album cover' : 'No media indexed yet'}</div>} /><div className="flex items-center gap-2 p-3 sm:gap-3 sm:p-5"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-canvas text-accent sm:size-11 sm:rounded-2xl"><FolderOpen className="size-4 sm:size-6" /></span><div className="min-w-0"><h2 className="truncate text-sm font-semibold sm:text-lg">{item.name}</h2><p className="text-xs text-muted sm:text-sm">{item.rootFolderId ? 'Browse library' : 'Start indexing'}</p></div></div></button><div className="border-t border-line p-4">{item.rootFolderId ? <RescanButton libraryId={item.id} name={item.name} /> : <p className="text-xs leading-relaxed text-muted">Indexing starts when you open this library. Other libraries stay idle.</p>}{item.rootFolderId && <details className="mt-3"><summary className="cursor-pointer text-xs text-muted">Indexing status</summary><ScanControls libraryId={item.id} /></details>}</div></section>)}</div></div> : <>{section === 'library' && filters.libraryId && <details className="hidden shrink-0 px-4 pb-2 sm:block sm:px-6"><summary className="cursor-pointer text-xs text-muted">Library status and scan controls</summary><ScanControls key={filters.libraryId} libraryId={filters.libraryId} /></details>}{section === 'reels' ? <Reels key={`${queryString(filters)}:${refresh}`} filters={reelsFilters(filters)} onFilters={() => setFilterOpen(true)} onOpenViewer={item => { triggerId.current = item.id; setActive(item) }} /> : <Gallery key={`${section}:${queryString(galleryFilters)}:${refresh}`} filters={galleryFilters} selected={selected} selecting={selecting} onSelect={select} onOpen={item => { triggerId.current = item.id; viewerScrollTop.current = scroll.current?.scrollTop ?? 0; setActive(item) }} scrollerRef={scroll} leadingContent={folderCards} />}</>}
          {libraries.isError && <p role="alert" className="p-5 text-danger">{errorMessage(libraries.error)}</p>}{folders.isError && <p role="alert" className="px-4 text-sm text-danger">{errorMessage(folders.error)}</p>}
        </>}
      </main></div>
    <BottomNavigation items={navItems} active={section} onChange={id => navigateSection(id as Section)} />
    <Modal open={filterOpen} onOpenChange={setFilterOpen} title="Search and filters" description="Narrow the current media view." sheet><FilterForm value={filters} onApply={value => apply(value, section === 'library' ? 'search' : section)} /></Modal>
    <Modal open={bulkOpen} onOpenChange={setBulkOpen} title={`Tag ${selected.size} items`} description="Add or remove a tag on every selected item." sheet><div className="overflow-auto p-5"><TagEditor mediaIds={[...selected]} bulk /></div></Modal>
    {active && <Viewer active={active} filters={galleryFilters} onChange={setActive} onClose={() => { setActive(null); requestAnimationFrame(restoreViewerPosition) }} restoreFocus={restoreViewerPosition} />}
  </div>
}
