import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight, Folder, FolderOpen, Images, Menu, RefreshCw, Search, SlidersHorizontal, Tag, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../components/ui/Button'
import { IconButton, Input, QuietButton, Select } from '../components/ui/Controls'
import { Modal } from '../components/ui/Modal'
import { FilterForm } from '../features/browse/FilterForm'
import { Gallery } from '../features/browse/Gallery'
import { ScanControls } from '../features/browse/ScanControls'
import { Viewer } from '../features/browse/Viewer'
import { TagEditor } from '../features/tags/TagEditor'
import { errorMessage, queryString, request, type Filters, type FolderPage, type Library, type Media } from '../features/browse/api'

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
  const [search, setSearch] = useState(filters.q ?? '')
  const [filterOpen, setFilterOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState(new Set<number>())
  const [selectionError, setSelectionError] = useState('')
  const [active, setActive] = useState<Media | null>(null)
  const [folderCursor, setFolderCursor] = useState<string | undefined>()
  const [refresh, setRefresh] = useState(0)
  const scroll = useRef<HTMLDivElement>(null)
  const triggerId = useRef<number | null>(null)
  const viewerScrollTop = useRef(0)
  const client = useQueryClient()
  const libraries = useQuery({ queryKey: ['libraries'], queryFn: ({ signal }) => request<Library[]>('/api/libraries', signal) })
  const library = libraries.data?.find(item => item.id === filters.libraryId)
  const folders = useQuery({ queryKey: ['folders', filters.libraryId, filters.folderId, folderCursor], queryFn: ({ signal }) => request<FolderPage>(`/api/folders?${new URLSearchParams({ ...(filters.libraryId ? { libraryId: String(filters.libraryId) } : {}), ...(filters.folderId ? { parentId: String(filters.folderId) } : {}), ...(folderCursor ? { cursor: folderCursor } : {}), limit: '48' })}`, signal), enabled: !!(filters.folderId || library?.rootFolderId), gcTime: 0 })
  useEffect(() => { window.history.replaceState(null, '', `${window.location.pathname}${queryString(filters) ? `?${queryString(filters)}` : ''}`) }, [filters])
  function apply(value: Filters) { setFilters(value); setSearch(value.q ?? ''); setSelected(new Set()); setFolderCursor(undefined); setFilterOpen(false); setLibraryOpen(false) }
  function select(id: number) {
    setSelected(old => {
      const next = new Set(old)
      if (next.has(id)) next.delete(id)
      else if (next.size < 500) next.add(id)
      else { setSelectionError('Select at most 500 items at a time.'); return old }
      return next
    })
  }
  function restoreViewerPosition() {
    if (scroll.current) scroll.current.scrollTop = viewerScrollTop.current
    const button = document.querySelector<HTMLButtonElement>(`button[data-media-id="${triggerId.current}"]`)
    if (button) button.focus({ preventScroll: true })
    else scroll.current?.focus({ preventScroll: true })
  }
  const filterCount = Object.entries(filters).filter(([key, val]) => !['libraryId', 'folderId', 'order', 'sort', 'q'].includes(key) && val !== undefined && val !== '' && !(Array.isArray(val) && !val.length)).length
  const navigation = <div className="flex h-full flex-col gap-6 overflow-auto p-4">
    <div><p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Browse</p>
      <QuietButton className={`w-full justify-start ${!filters.libraryId ? 'bg-surface' : ''}`} onClick={() => apply({ ...filters, libraryId: undefined, folderId: undefined })}><Images className="size-4" />All media</QuietButton>
    </div>
    <nav aria-label="Libraries"><p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Libraries</p><ul className="space-y-2">{libraries.data?.map(item => <li key={item.id}><QuietButton className={`w-full justify-start text-left ${filters.libraryId === item.id ? 'bg-surface' : ''}`} aria-current={filters.libraryId === item.id ? 'page' : undefined} onClick={() => apply({ ...filters, libraryId: item.id, folderId: item.rootFolderId ?? undefined })}><FolderOpen className="size-4 shrink-0" /><span className="truncate">{item.name}</span>{item.availability === 'unavailable' && <span className="text-xs text-muted">Offline</span>}</QuietButton></li>)}</ul></nav>
    {(filters.libraryId ?? libraries.data?.[0]?.id) !== undefined && <ScanControls key={filters.libraryId ?? libraries.data?.[0]?.id} libraryId={(filters.libraryId ?? libraries.data?.[0]?.id)!} />}
    <p className="mt-auto text-xs leading-relaxed text-muted">Your originals stay untouched.<br />Tags and preferences live in Luma.</p>
  </div>
  return <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-canvas text-ink">
    <a href="#collection" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-accent focus:p-3 focus:text-on-accent">Skip to collection</a>
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-line px-4 sm:px-6">
      <IconButton label="Open libraries" className="md:hidden" onClick={() => setLibraryOpen(true)}><Menu className="size-5" /></IconButton>
      <a href="/" className="text-2xl font-semibold tracking-tight" aria-label="Luma home">luma<span className="text-accent">.</span></a>
      <form className="ml-auto flex w-full max-w-lg gap-2" role="search" onSubmit={event => { event.preventDefault(); apply({ ...filters, q: search.trim() || undefined }) }}>
        <Input aria-label="Search media" placeholder="Search your collection" value={search} maxLength={200} onChange={event => setSearch(event.target.value)} />
        <IconButton type="submit" label="Search"><Search className="size-5" /></IconButton>
      </form>
    </header>
    <div className="flex min-h-0 flex-1">
      <aside className="hidden w-60 shrink-0 border-r border-line md:block">{navigation}</aside>
      <main id="collection" className="flex min-w-0 flex-1 flex-col" tabIndex={-1}>
        <div className="shrink-0 space-y-4 border-b border-line px-4 py-5 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="mb-1 text-xs text-muted">{filters.q ? `Search: ${filters.q}` : 'Your collection'}</p><h1 className="text-2xl font-semibold">{folders.data?.current.name ?? library?.name ?? 'All media'}</h1></div>
            <div className="flex flex-wrap items-center gap-2"><QuietButton onClick={() => setFilterOpen(true)}><SlidersHorizontal className="size-4" />Filters{filterCount > 0 ? ` (${filterCount})` : ''}</QuietButton>
              <Select aria-label="Sort media" className="w-auto" value={filters.order ?? 'desc'} onChange={event => apply({ ...filters, order: event.target.value })}><option value="desc">Newest first</option><option value="asc">Oldest first</option></Select>
              <IconButton label="Refresh collection" onClick={() => { void client.invalidateQueries({ queryKey: ['media'] }); void client.invalidateQueries({ queryKey: ['libraries'] }); setRefresh(x => x + 1) }}><RefreshCw className="size-4" /></IconButton>
              <QuietButton aria-pressed={selecting} onClick={() => { setSelecting(!selecting); if (selecting) setSelected(new Set()) }}>Select</QuietButton>
            </div>
          </div>
          {folders.data && <nav aria-label="Folder breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-muted">{[...folders.data.ancestors, folders.data.current].map(folder => <span key={folder.id} className="flex items-center gap-1"><QuietButton className="border-transparent" onClick={() => apply({ ...filters, libraryId: folder.libraryId, folderId: folder.id })}>{folder.name}</QuietButton><ChevronRight className="size-3" /></span>)}</nav>}
          {folders.data && folders.data.items.length > 0 && <div className="max-h-32 overflow-auto"><ul className="flex flex-wrap gap-2">{folders.data.items.map(folder => <li key={folder.id}><QuietButton onClick={() => apply({ ...filters, libraryId: folder.libraryId, folderId: folder.id })}><Folder className="size-4 text-accent" /><span className="max-w-40 truncate">{folder.name}</span></QuietButton></li>)}</ul></div>}
          {(folders.data?.nextCursor || folders.data?.previousCursor) && <div className="flex gap-2"><QuietButton disabled={!folders.data.previousCursor} onClick={() => setFolderCursor(folders.data?.previousCursor ?? undefined)}><ArrowLeft className="size-4" />Earlier folders</QuietButton><QuietButton disabled={!folders.data.nextCursor} onClick={() => setFolderCursor(folders.data?.nextCursor ?? undefined)}>More folders<ChevronRight className="size-4" /></QuietButton></div>}
          {folders.isError && <p role="alert" className="text-sm text-danger">{errorMessage(folders.error)}</p>}
          {selected.size > 0 && <div className="flex items-center gap-3"><p className="text-sm">{selected.size} selected</p><Button className="gap-2" onClick={() => setBulkOpen(true)}><Tag className="size-4" />Edit tags</Button><IconButton label="Clear selection" onClick={() => setSelected(new Set())}><X className="size-4" /></IconButton></div>}
          {selectionError && <p role="alert" className="text-sm text-danger">{selectionError}</p>}
        </div>
        {libraries.data?.length === 0 ? <section className="mx-auto flex max-w-lg flex-col items-center gap-4 p-10 text-center"><FolderOpen className="size-12 text-accent" /><h2 className="text-xl font-semibold">Connect your first library</h2><p className="leading-relaxed text-muted">Choose your media folder in the server configuration, then restart Luma. The Quick start in README includes Docker and single-process setup instructions.</p></section>
          : <Gallery key={`${queryString(filters)}:${refresh}`} filters={filters} selected={selected} selecting={selecting} onSelect={select} onOpen={item => { triggerId.current = item.id; viewerScrollTop.current = scroll.current?.scrollTop ?? 0; setActive(item) }} scrollerRef={scroll} />}
        {libraries.isError && <p role="alert" className="p-5 text-danger">{errorMessage(libraries.error)}</p>}
      </main>
    </div>
    <Modal open={libraryOpen} onOpenChange={setLibraryOpen} title="Your libraries" description="Choose a library or start a scan.">{navigation}</Modal>
    <Modal open={filterOpen} onOpenChange={setFilterOpen} title="Search and filters" description="Combine filters to find photos and videos.">{filterOpen && <FilterForm value={filters} onApply={apply} />}</Modal>
    <Modal open={bulkOpen} onOpenChange={setBulkOpen} title={`Tag ${selected.size} items`} description="Add or remove a tag on every selected item."><div className="overflow-auto p-5"><TagEditor mediaIds={[...selected]} bulk /></div></Modal>
    {active && <Viewer active={active} filters={filters} onChange={setActive} onClose={() => { setActive(null); requestAnimationFrame(restoreViewerPosition) }} restoreFocus={restoreViewerPosition} />}
  </div>
}
