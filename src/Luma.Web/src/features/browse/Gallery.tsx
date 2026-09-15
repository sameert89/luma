import { useInfiniteQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Check, Film, Heart, Images, LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CachedImage } from '../../components/ui/CachedImage'
import { QuietButton } from '../../components/ui/Controls'
import { errorMessage, mediaPage, type Filters, type Media } from './api'

export function Gallery({ filters, selected, selecting, onSelect, onOpen, scrollerRef }: {
  filters: Filters; selected: Set<number>; selecting: boolean; onSelect: (id: number) => void; onOpen: (item: Media) => void; scrollerRef: React.RefObject<HTMLDivElement | null>
}) {
  const query = useInfiniteQuery({ queryKey: ['media', filters], queryFn: ({ pageParam, signal }) => mediaPage(filters, pageParam, signal),
    initialPageParam: undefined as string | undefined, getNextPageParam: page => page.nextCursor ?? undefined, getPreviousPageParam: page => page.previousCursor ?? undefined,
    maxPages: 5, gcTime: 0, retry: 1 })
  const items = query.data?.pages.flatMap(page => page.items) ?? []
  const gridRef = useRef<HTMLDivElement>(null)
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
  const rows = Math.ceil(items.length / columns)
  const virtual = useVirtualizer({ count: rows, getScrollElement: () => scrollerRef.current, estimateSize: () => rowHeight, overscan: 2 })
  const anchor = useRef<{ id: number; offset: number; data: typeof query.data } | null>(null)
  const loading = useRef(false)
  const load = useCallback(async (backward: boolean) => {
    if (loading.current || query.isFetching) return
    const top = scrollerRef.current?.scrollTop ?? 0
    const row = Math.floor(top / rowHeight)
    if (items[row * columns]) anchor.current = { id: items[row * columns].id, offset: top - row * rowHeight, data: query.data }
    loading.current = true
    try { if (backward) await query.fetchPreviousPage(); else await query.fetchNextPage() } finally { loading.current = false }
  }, [query, items, rowHeight, columns, scrollerRef])
  useLayoutEffect(() => {
    if (!anchor.current || !scrollerRef.current || query.data === anchor.current.data) return
    const index = items.findIndex(item => item.id === anchor.current?.id)
    if (index >= 0) scrollerRef.current.scrollTop = Math.floor(index / columns) * rowHeight + anchor.current.offset
    anchor.current = null
  }, [query.data, items, columns, rowHeight, scrollerRef])
  const visible = virtual.getVirtualItems()
  const last = visible.at(-1)?.index ?? -1
  useEffect(() => {
    if (items.length && last >= rows - 3 && query.hasNextPage && !query.isFetching) void load(false)
  }, [last, rows, query.hasNextPage, query.isFetching, items.length, load])
  return <div ref={scrollerRef} tabIndex={-1} className="min-h-0 flex-1 overflow-auto p-4 focus-visible:outline-2 focus-visible:outline-accent" data-testid="gallery-scroll"
    onScroll={event => { if (event.currentTarget.scrollTop < rowHeight && query.hasPreviousPage && !query.isFetching) void load(true) }}>
    <div ref={gridRef} className="w-full">
      {query.isPending && <div role="status" className="flex items-center justify-center gap-3 py-20 text-muted"><LoaderCircle className="size-5 animate-spin" />Loading your collection…</div>}
      {query.isError && <div role="alert" className="space-y-3 p-5 text-danger"><p>{errorMessage(query.error)}</p><QuietButton onClick={() => void query.refetch()}>Try again</QuietButton></div>}
      {!query.isPending && !query.isError && items.length === 0 && <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-20 text-center"><Images className="size-12 text-muted" /><h2 className="text-xl font-semibold">No media to show</h2><p className="text-sm leading-relaxed text-muted">Try another folder or adjust your filters. If this is a new library, start a scan to add your photos and videos.</p></div>}
      {query.hasPreviousPage && <QuietButton className="sr-only focus:not-sr-only focus:absolute focus:z-10" onClick={() => void load(true)} disabled={query.isFetching}>Load earlier items</QuietButton>}
      <div className="relative" style={{ height: virtual.getTotalSize() }} data-testid="gallery-grid" data-retained-items={items.length}>
        {visible.map(row => <div key={row.index} className="absolute left-0 top-0 grid w-full gap-3 pb-3" style={{ height: rowHeight, transform: `translateY(${row.start}px)`, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {items.slice(row.index * columns, (row.index + 1) * columns).map(item => <article key={item.id} className={`relative min-w-0 overflow-hidden rounded-md border ${selected.has(item.id) ? 'border-accent' : 'border-transparent'}`} data-testid="media-cell">
            <button data-media-id={item.id} className="block w-full text-left" aria-label={`Open ${item.fileName}`} onClick={() => onOpen(item)}>
              <CachedImage key={`${item.thumbnail.url}:${item.thumbnail.status}`} url={item.thumbnail.url} alt="" className="aspect-square w-full bg-surface object-cover" />
              <span className="block truncate px-1 py-2 text-xs text-muted">{item.fileName}</span>
            </button>
            {item.mediaType === 'video' && <span className="pointer-events-none absolute bottom-10 right-2 flex items-center gap-1 rounded bg-canvas/90 px-2 py-1 text-xs"><Film className="size-3" aria-hidden="true" />Video</span>}
            {item.preference === 'liked' && <Heart className="pointer-events-none absolute right-2 top-2 size-4 fill-accent text-accent" aria-label="Liked" />}
            {selecting && <label className="absolute left-2 top-2 flex size-11 cursor-pointer items-center justify-center rounded-md bg-canvas/90">
              <input type="checkbox" className="size-5 accent-accent" aria-label={`Select ${item.fileName}`} checked={selected.has(item.id)} onChange={() => onSelect(item.id)} />
            </label>}
            {selected.has(item.id) && !selecting && <Check className="pointer-events-none absolute left-2 top-2 size-5 text-accent" />}
          </article>)}
        </div>)}
      </div>
      {query.hasNextPage && <div className="flex justify-center py-4"><QuietButton onClick={() => void load(false)} disabled={query.isFetching}>{query.isFetching ? 'Loading more…' : 'Load more'}</QuietButton></div>}
      {items.length > 0 && !query.hasNextPage && <p className="py-5 text-center text-xs text-muted">End of results</p>}
    </div>
  </div>
}
