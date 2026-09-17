import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { ArrowUp, ArrowDown, Clapperboard, EllipsisVertical, Heart, Settings2, SlidersHorizontal, Tag, Timer, Volume2, VolumeX, X } from 'lucide-react'
import { IconButton } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { MediaStage } from './MediaStage'
import { TagEditor } from '../tags/TagEditor'
import { usePreviewPriority } from './usePreviewPriority'
import { ApiError } from '../../lib/api/client'
import { errorMessage, queryString, request, type Filters, type Media, type MediaPage, type Neighbors } from './api'

const autoScrollSeconds = 3
const reelsStateKey = 'luma-reels-state'

function savedReelsState(query: string) {
  try {
    const saved = JSON.parse(localStorage.getItem(reelsStateKey) ?? '{}')
    return { muted: typeof saved?.muted === 'boolean' ? saved.muted : true,
      autoScroll: saved?.autoScroll === true,
      mediaId: saved?.query === query && Number.isSafeInteger(saved?.mediaId) && saved.mediaId > 0 ? saved.mediaId as number : null }
  } catch { return { muted: true, autoScroll: false, mediaId: null } }
}

export function Reels({ filters, viewerOpen = false, onFilters, onOpenViewer }: { filters: Filters; viewerOpen?: boolean; onFilters: () => void; onOpenViewer: (item: Media) => void }) {
  const root = useRef<HTMLElement>(null)
  const queryFilters: Filters = filters
  const positionQuery = new URLSearchParams(queryString(queryFilters))
  positionQuery.sort()
  const positionKey = positionQuery.toString()
  const [saved] = useState(() => savedReelsState(positionKey))
  const [restoredId, setRestoredId] = useState<number | null>(saved.mediaId)
  const [active, setActive] = useState<Media | null>(null)
  const [direction, setDirection] = useState<'next' | 'previous'>('next')
  const [muted, setMuted] = useState(saved.muted)
  const [autoScroll, setAutoScroll] = useState(saved.autoScroll)
  const [tags, setTags] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const suspended = viewerOpen || tags || optionsOpen
  const client = useQueryClient()
  const first = useQuery({ queryKey: ['reels-first', queryFilters], queryFn: ({ signal }) => request<MediaPage>(`/api/media?${queryString({ ...queryFilters, limit: 1 })}`, signal), enabled: !restoredId, gcTime: 0 })
  const base = active ?? first.data?.items[0]
  const baseId = active?.id ?? restoredId ?? base?.id
  const detail = useQuery({ queryKey: ['detail', baseId], queryFn: ({ signal }) => request<Media>(`/api/media/${baseId}`, signal), enabled: !!baseId, gcTime: 0, refetchInterval: query => query.state.data?.preview.status === 'ready' ? false : 3000 })
  const item = detail.data ?? (base?.id === baseId ? base : undefined)
  useEffect(() => {
    if (restoredId && !active && (detail.data?.availability === 'missing' || detail.error instanceof ApiError && detail.error.status === 404)) setRestoredId(null)
  }, [restoredId, active, detail.data?.availability, detail.error])
  useEffect(() => {
    try { localStorage.setItem(reelsStateKey, JSON.stringify({ muted, autoScroll, query: positionKey, mediaId: item?.id ?? restoredId })) }
    catch { /* Storage may be unavailable; current controls still work. */ }
  }, [muted, autoScroll, positionKey, item?.id, restoredId])
  const neighbors = useQuery({ queryKey: ['reels-neighbors', queryFilters, item?.id], queryFn: ({ signal }) => request<Neighbors>(`/api/media/${item!.id}/neighbors?${queryString(queryFilters)}`, signal), enabled: !!item, gcTime: 0 })
  const next = neighbors.data?.next
  const preference = useMutation({ mutationFn: ({ id, value }: { id: number; value: string }) => request(`/api/media/${id}/preference`, undefined, 'PUT', { preference: value }),
    onSuccess: async (_result, { id }) => { await Promise.all([client.invalidateQueries({ queryKey: ['detail', id] }), client.invalidateQueries({ queryKey: ['media'] })]) } })
  usePreviewPriority([item, next, neighbors.data?.previous])
  useEffect(() => {
    if (next?.preview.status !== 'ready') return
    const preload = new Image()
    preload.src = next.preview.url
    return () => preload.removeAttribute('src')
  }, [next?.preview.status, next?.preview.url])
  function navigate(direction: 'next' | 'previous') { const target = neighbors.data?.[direction]; if (target) { setDirection(direction); setActive(target) } }
  // Videos advance through MediaStage's onEnded; a photo has no such event, so it gets its
  // own timer here. Depending on the item's id/type rather than the query objects keeps an
  // unrelated refetch (a new object with the same id) from silently restarting the count.
  useEffect(() => {
    if (suspended || !autoScroll || !item || item.mediaType === 'video' || !next) return
    const timer = window.setTimeout(() => { setDirection('next'); setActive(next) }, autoScrollSeconds * 1000)
    return () => window.clearTimeout(timer)
  }, [suspended, autoScroll, item?.id, item?.mediaType, next])
  useEffect(() => { function key(event: KeyboardEvent) { if (document.querySelector('[role="dialog"]') || event.target instanceof HTMLElement && event.target.closest('input,select,textarea,video,button')) return; if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const move = event.key === 'ArrowDown' ? 'next' : 'previous'; const target = neighbors.data?.[move]; if (target) { setDirection(move); setActive(target) } } }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key) }, [neighbors.data])
  if (first.isError) return <p role="alert" className="p-5 text-danger">{errorMessage(first.error)}</p>
  if (!item && detail.isError && !(detail.error instanceof ApiError && detail.error.status === 404)) return <p role="alert" className="p-5 text-danger">{errorMessage(detail.error)}</p>
  if (!item) return <p role="status" className="p-5 text-muted">{first.isPending || detail.isPending && !!baseId ? 'Loading reels...' : 'No media match these filters.'}</p>
  const liked = item.preference === 'liked'
  return <section ref={root} aria-label="Reels" className="relative flex min-h-0 flex-1 flex-col bg-black">
    <div className="flex min-h-0 flex-1"><MediaStage item={item} direction={direction} optionsOpen={optionsOpen} onOptionsOpenChange={setOptionsOpen} reels muted={muted} suspended={suspended} fullscreenRoot={root} onOpenViewer={onOpenViewer} onNavigate={navigate} onLike={() => { if (!liked) preference.mutate({ id: item.id, value: 'liked' }) }} onEnded={() => { if (!suspended && autoScroll && next) { setDirection('next'); setActive(next) } }} /></div>
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-3 sm:p-5">
      <p className="pointer-events-auto rounded-full bg-canvas/80 px-3 py-1 text-lg font-semibold tracking-tight">luma<span className="text-accent">.</span><Clapperboard className="ml-1 inline size-3 align-super text-accent" aria-hidden="true" /><span className="sr-only"> reels</span></p>
      {/* Only the toggle sits on the stage by default; the rest drops open below it so
          the viewport stays clear of controls until someone actually wants them. */}
      <div className="pointer-events-auto flex flex-col items-end gap-2">
        <IconButton label={menuOpen ? 'Close reels menu' : 'Reels menu'} aria-expanded={menuOpen} aria-controls="reels-menu" className="border-transparent bg-canvas/85" onClick={() => setMenuOpen(value => !value)}>{menuOpen ? <X className="size-4" /> : <EllipsisVertical className="size-4" />}</IconButton>
        <div id="reels-menu" className="motion-drop" data-open={menuOpen} inert={!menuOpen}>
          <div className="flex min-h-0 flex-col items-end gap-2 overflow-hidden pt-0.5">
            <IconButton label="Filters" className="border-transparent bg-canvas/85" onClick={onFilters}><SlidersHorizontal className="size-4" /></IconButton>
            <IconButton label={liked ? 'Unlike' : 'Like'} className="border-transparent bg-canvas/85" aria-pressed={liked} disabled={preference.isPending} onClick={() => preference.mutate({ id: item.id, value: liked ? 'neutral' : 'liked' })}><Heart className={`size-4 ${liked ? 'fill-accent text-accent' : ''}`} /></IconButton>
            <IconButton label={muted ? 'Unmute' : 'Mute'} className="border-transparent bg-canvas/85" aria-pressed={muted} onClick={() => setMuted(!muted)}>{muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}</IconButton>
            <IconButton label="Auto-scroll" className="border-transparent bg-canvas/85" aria-pressed={autoScroll} onClick={() => setAutoScroll(value => !value)}><Timer className={`size-4 ${autoScroll ? 'text-accent' : ''}`} /></IconButton>
            <IconButton label="Tags" className="border-transparent bg-canvas/85" aria-pressed={tags} onClick={() => setTags(!tags)}><Tag className="size-4" /></IconButton>
            <IconButton label="View options" className="border-transparent bg-canvas/85" onClick={() => setOptionsOpen(true)}><Settings2 className="size-4" /></IconButton>
            <IconButton label="Previous" className="border-transparent bg-canvas/85" disabled={!neighbors.data?.previous} onClick={() => navigate('previous')}><ArrowUp className="size-4" /></IconButton>
            <IconButton label="Next" className="border-transparent bg-canvas/85" disabled={!next} onClick={() => navigate('next')}><ArrowDown className="size-4" /></IconButton>
          </div>
        </div>
      </div>
    </div>
    <Modal open={tags} onOpenChange={setTags} title="Tags" description="Add or remove tags for this item." sheet><div className="overflow-auto p-5"><TagEditor key={item.id} mediaIds={[item.id]} tags={item.tags} /></div></Modal>
    {preference.isError && <p role="alert" className="absolute bottom-28 z-10 rounded-full bg-canvas px-4 py-2 text-sm text-danger">{errorMessage(preference.error)}</p>}
    {neighbors.isError && <p role="alert" className="absolute bottom-20 z-10 rounded-full bg-canvas px-4 py-2 text-sm text-danger">{errorMessage(neighbors.error)}</p>}
  </section>
}
