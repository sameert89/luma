import { useInfiniteQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Check, Film, Heart, Images, LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { CachedImage } from '../../components/ui/CachedImage'
import { Checkbox, QuietButton } from '../../components/ui/Controls'
import { errorMessage, mediaPage, type Filters, type Media } from './api'
import { useFolderIndexing } from './useFolderIndexing'
import { usePreviewPriority } from './usePreviewPriority'

export function Gallery({ filters, selected, selecting, onSelect, onOpen, scrollerRef, leadingContent }: {
  filters: Filters; selected: Set<number>; selecting: boolean; onSelect: (id: number) => void; onOpen: (item: Media) => void; scrollerRef: React.RefObject<HTMLDivElement | null>; leadingContent?: ReactNode
}) {
  const indexing = useFolderIndexing(filters.folderId)
  const query = useInfiniteQuery({ queryKey: ['media', filters], queryFn: ({ pageParam, signal }) => mediaPage(filters, pageParam, signal),
    initialPageParam: undefined as string | undefined, getNextPageParam: page => page.nextCursor ?? undefined, getPreviousPageParam: page => page.previousCursor ?? undefined,
    maxPages: 5, gcTime: 0, retry: 1,
    refetchInterval: state => indexing.waiting || state.state.data?.pages.some(page => page.items.some(item => !['ready', 'failed'].includes(item.thumbnail.status))) ? 3000 : false })
  const items = [...new Map((query.data?.pages.flatMap(page => page.items) ?? []).map(item => [item.id, item])).values()]
  const gridRef = useRef<HTMLDivElement>(null)
  const leadingRef = useRef<HTMLDivElement>(null)
  const [leadingHeight, setLeadingHeight] = useState(0)
  const [width, setWidth] = useState(800)
  useLayoutEffect(() => {
    const element = gridRef.current
    if (!element) return
    setWidth(element.getBoundingClientRect().width || 800)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const columns = Math.max(2, Math.min(8, Math.floor(width / 180)))
  // Gap/padding correspond to shared Tailwind gap-3 and the card caption, not per-feature style tokens.
  const rowHeight = (width - (columns - 1) * 12) / columns + 44
  const gridRows: { items: Media[]; header?: string | null; offset: number }[] = []
  for (const item of items) {
    const last = gridRows.at(-1)
    if (!last || last.items.length === columns || last.items[0].groupKey !== item.groupKey) {
      const header = item.groupKey && last?.items[0].groupKey !== item.groupKey ? item.groupLabel ?? item.groupKey : undefined
      gridRows.push({ items: [item], header, offset: last ? last.offset + rowHeight + (last.header ? 36 : 0) : 0 })
    } else last.items.push(item)
  }
  const layoutKey = gridRows.map(row => row.header ? 1 : 0).join('')
  const rows = gridRows.length
  const virtual = useVirtualizer({ count: rows, getScrollElement: () => scrollerRef.current, estimateSize: index => rowHeight + (gridRows[index]?.header ? 36 : 0), scrollMargin: leadingHeight, overscan: 2 })
  useLayoutEffect(() => {
    const element = leadingRef.current
    if (!element) return
    const measure = () => setLeadingHeight(element.offsetHeight)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => { virtual.measure() }, [columns, rowHeight, layoutKey, virtual])
  const anchor = useRef<{ id: number; offset: number; data: typeof query.data } | null>(null)
  const loading = useRef(false)
  const load = useCallback(async (backward: boolean) => {
    if (loading.current || query.isFetching) return
    const top = scrollerRef.current?.scrollTop ?? 0
    const row = [...gridRows].reverse().find(row => row.offset <= top - leadingHeight) ?? gridRows[0]
    if (row) anchor.current = { id: row.items[0].id, offset: top - leadingHeight - row.offset, data: query.data }
    loading.current = true
    try { if (backward) await query.fetchPreviousPage(); else await query.fetchNextPage() } finally { loading.current = false }
  }, [query, gridRows, leadingHeight, scrollerRef])
  useLayoutEffect(() => {
    if (!anchor.current || !scrollerRef.current || query.data === anchor.current.data) return
    const row = gridRows.find(row => row.items.some(item => item.id === anchor.current?.id))
    if (row) scrollerRef.current.scrollTop = leadingHeight + row.offset + anchor.current.offset
    anchor.current = null
  }, [query.data, gridRows, leadingHeight, scrollerRef])
  const visible = virtual.getVirtualItems()
  const last = visible.at(-1)?.index ?? -1
  // Prepare previews from the top of the viewport downwards, then wrap to the rows
  // above it, so they fill in the order this grid shows them.
  const first = visible[0]?.index ?? 0
  usePreviewPriority([...gridRows.slice(first), ...gridRows.slice(0, first)].flatMap(row => row.items))
  useEffect(() => {
    if (items.length && last >= rows - 3 && query.hasNextPage && !query.isFetching) void load(false)
  }, [last, rows, query.hasNextPage, query.isFetching, items.length, load])
  return <div ref={scrollerRef} tabIndex={-1} className="min-h-0 flex-1 overflow-auto p-4 focus-visible:outline-2 focus-visible:outline-accent" data-testid="gallery-scroll"
    onScroll={event => { if (event.currentTarget.scrollTop < rowHeight && query.hasPreviousPage && !query.isFetching) void load(true) }}>
    <div ref={gridRef} className="w-full">
      <div ref={leadingRef}>{leadingContent}</div>
      {indexing.waiting && <p role="status" className="flex items-center gap-2 pb-3 text-sm text-muted"><LoaderCircle className="size-4 motion-safe:animate-spin" />Checking this folder and preparing previews…</p>}
      {indexing.error && <p role="alert" className="pb-3 text-sm text-danger">{errorMessage(indexing.error)}</p>}
      {query.isPending && <div role="status" className="flex items-center justify-center gap-3 py-20 text-muted"><LoaderCircle className="size-5 animate-spin" />Loading your collection…</div>}
      {query.isError && <div role="alert" className="space-y-3 p-5 text-danger"><p>{errorMessage(query.error)}</p><QuietButton onClick={() => void query.refetch()}>Try again</QuietButton></div>}
      {!query.isPending && !query.isError && items.length === 0 && !leadingContent && <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-20 text-center"><Images className="size-12 text-muted" /><h2 className="text-xl font-semibold">No media to show</h2><p className="text-sm leading-relaxed text-muted">Try another folder or adjust your filters. If this is a new library, start a scan to add your photos and videos.</p></div>}
      {query.hasPreviousPage && <QuietButton className="sr-only focus:not-sr-only focus:absolute focus:z-10" onClick={() => void load(true)} disabled={query.isFetching}>Load earlier items</QuietButton>}
      <div className="relative" style={{ height: virtual.getTotalSize() }} data-testid="gallery-grid" data-retained-items={items.length}>
        {visible.map(row => <div key={row.index} className="absolute left-0 top-0 w-full pb-3" style={{ height: row.size, transform: `translateY(${row.start - leadingHeight}px)` }}>
          {gridRows[row.index].header && <h2 className="flex h-9 items-center text-sm font-semibold">{gridRows[row.index].header}</h2>}
          <div className="grid w-full gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {gridRows[row.index].items.map(item => <article key={item.id} className={`relative min-w-0 overflow-hidden rounded-md border ${selected.has(item.id) ? 'border-accent' : 'border-transparent'}`} data-testid="media-cell">
            <button data-media-id={item.id} className="block w-full text-left" aria-label={`Open ${item.fileName}`} onClick={() => onOpen(item)}>
              <CachedImage key={`${item.thumbnail.url}:${item.thumbnail.status}`} url={item.thumbnail.url} status={item.thumbnail.status} alt="" className="aspect-square w-full bg-surface object-cover" />
              <span className="block truncate px-1 py-2 text-xs text-muted">{item.fileName}</span>
            </button>
            {item.mediaType === 'video' && <span className="pointer-events-none absolute bottom-10 right-2 flex items-center gap-1 rounded bg-canvas/90 px-2 py-1 text-xs"><Film className="size-3" aria-hidden="true" />Video</span>}
            {item.preference === 'liked' && <Heart className="pointer-events-none absolute right-2 top-2 size-4 fill-accent text-accent" aria-label="Liked" />}
            {selecting && <span className="absolute left-2 top-2 flex size-11 items-center justify-center rounded-lg bg-canvas/90">
              <Checkbox aria-label={`Select ${item.fileName}`} checked={selected.has(item.id)} onChange={() => onSelect(item.id)} />
            </span>}
            {selected.has(item.id) && !selecting && <Check className="pointer-events-none absolute left-2 top-2 size-5 text-accent" />}
          </article>)}
          </div>
        </div>)}
      </div>
      {query.hasNextPage && <div className="flex justify-center py-4"><QuietButton onClick={() => void load(false)} disabled={query.isFetching}>{query.isFetching ? 'Loading more…' : 'Load more'}</QuietButton></div>}
      {items.length > 0 && !query.hasNextPage && <p className="py-5 text-center text-xs text-muted">End of results</p>}
    </div>
  </div>
}
