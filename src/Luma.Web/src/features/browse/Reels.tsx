import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Clapperboard, Info, LoaderCircle, Settings2, SlidersHorizontal, Eye, EyeOff, Tag, Timer, Volume2, VolumeX } from 'lucide-react'
import { IconButton, QuietButton } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { MediaStage } from './MediaStage'
import { MediaActions, actionButton } from './MediaActions'
import { MediaInformation } from './MediaInformation'
import { MetadataExchange } from '../tags/MetadataExchange'
import { TagEditor } from '../tags/TagEditor'
import { useFullscreen } from './useFullscreen'
import { usePreviewPriority } from './usePreviewPriority'
import { usePreference } from './usePreference'
import { ApiError } from '../../lib/api/client'
import { errorMessage, imageUrl, queryString, request, type Filters, type Media, type MediaPage, type Neighbors } from './api'

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

// Once the current reel has had a moment to start, the next one fetches only enough to
// begin (metadata and the first bytes); browsers share that data with the element that
// later plays it. Whole videos are never downloaded ahead.
const warmNextMs = 1000

export function Reels({ filters, startId, viewerOpen = false, onFilters, onOpenViewer, onItemChange, filtersVisible = true, onToggleFilters }: { filters: Filters; filtersVisible?: boolean; onToggleFilters?: () => void; startId?: number | null; viewerOpen?: boolean; onFilters: () => void; onItemChange?: (id: number) => void; onOpenViewer: (item: Media) => void }) {
  const isFullscreen = useFullscreen()
  const root = useRef<HTMLElement>(null)
  const queryFilters: Filters = filters
  const positionQuery = new URLSearchParams(queryString(queryFilters))
  positionQuery.sort()
  const positionKey = positionQuery.toString()
  const [saved] = useState(() => savedReelsState(positionKey))
  const [restoredId, setRestoredId] = useState<number | null>(startId ?? saved.mediaId)
  const [active, setActive] = useState<Media | null>(null)
  const [direction, setDirection] = useState<'next' | 'previous'>('next')
  const [muted, setMuted] = useState(saved.muted)
  const [autoScroll, setAutoScroll] = useState(saved.autoScroll)
  const [tags, setTags] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const suspended = viewerOpen || tags || optionsOpen || infoOpen
  const first = useQuery({ queryKey: ['reels-first', queryFilters], queryFn: ({ signal }) => request<MediaPage>(`/api/media?${queryString({ ...queryFilters, limit: 1 })}`, signal), enabled: !restoredId, gcTime: 0 })
  const base = active ?? first.data?.items[0]
  const baseId = active?.id ?? restoredId ?? base?.id
  const detail = useQuery({ queryKey: ['detail', baseId], queryFn: ({ signal }) => request<Media>(`/api/media/${baseId}`, signal), enabled: !!baseId, gcTime: 0, refetchInterval: query => query.state.data?.preview.status === 'ready' ? false : 3000 })
  const item = detail.data ?? (base?.id === baseId ? base : undefined)
  useEffect(() => { if (item) onItemChange?.(item.id) }, [item?.id, onItemChange])
  useEffect(() => {
    if (restoredId && !active && (detail.data?.availability === 'missing' || detail.error instanceof ApiError && detail.error.status === 404)) setRestoredId(null)
  }, [restoredId, active, detail.data?.availability, detail.error])
  useEffect(() => {
    try { localStorage.setItem(reelsStateKey, JSON.stringify({ muted, autoScroll, query: positionKey, mediaId: item?.id ?? restoredId })) }
    catch { /* Storage may be unavailable; current controls still work. */ }
  }, [muted, autoScroll, positionKey, item?.id, restoredId])
  const neighbors = useQuery({ queryKey: ['reels-neighbors', queryFilters, item?.id], queryFn: ({ signal }) => request<Neighbors>(`/api/media/${item!.id}/neighbors?${queryString(queryFilters)}`, signal), enabled: !!item, gcTime: 0 })
  const next = neighbors.data?.next
  const preference = usePreference()
  usePreviewPriority([item, next, neighbors.data?.previous], true)
  useEffect(() => {
    if (!next || next.mediaType !== 'video' || suspended) return
    let warm: HTMLVideoElement | null = null
    const timer = window.setTimeout(() => {
      warm = document.createElement('video')
      warm.muted = true
      warm.preload = 'metadata'
      warm.src = `/api/media/${next.id}/original`
    }, warmNextMs)
    return () => { window.clearTimeout(timer); if (warm) { warm.removeAttribute('src'); warm.load() } }
  }, [next?.id, next?.mediaType, suspended])
  const nextStill = !next ? null : next.mediaType === 'video' ? next.preview.status === 'ready' ? next.preview.url : null : imageUrl(next)
  useEffect(() => {
    if (!nextStill) return
    const preload = new Image()
    preload.src = nextStill
    return () => preload.removeAttribute('src')
  }, [nextStill])
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
  if (!item) {
    const loading = first.isPending || detail.isPending && !!baseId
    return <section aria-labelledby="reels-state-title" className="flex min-h-0 flex-1 items-center justify-center bg-black px-6 text-center text-white">
      <div role={loading ? 'status' : undefined} className="flex max-w-sm flex-col items-center gap-4">
        {loading ? <LoaderCircle className="size-10 text-white/60 motion-safe:animate-spin" aria-hidden="true" /> : <span className="flex size-16 items-center justify-center rounded-full border border-white/15 bg-white/10"><Clapperboard className="size-7 text-white/70" aria-hidden="true" /></span>}
        <h1 id="reels-state-title" className="text-xl font-semibold">{loading ? 'Loading reels…' : 'No reels to show'}</h1>
        {!loading && <><p className="text-sm leading-relaxed text-white/60">No photos or videos match this view. Adjust the filters or choose another folder.</p><QuietButton className="border-white/20 text-white hover:bg-white/10" onClick={onFilters}><SlidersHorizontal className="size-4" />Adjust filters</QuietButton></>}
      </div>
    </section>
  }
  const liked = item.preference === 'liked'
  return <section ref={root} aria-label="Reels" className="relative flex min-h-0 flex-1 flex-col bg-black">
    {/* Reels loop until the person moves on; auto-scroll advances at the end instead. */}
    <div className="flex min-h-0 flex-1"><MediaStage item={item} direction={direction} optionsOpen={optionsOpen} onOptionsOpenChange={setOptionsOpen} reels muted={muted} onMutedChange={setMuted} suspended={suspended} loop={!(autoScroll && next)} fullscreenRoot={root} onOpenViewer={onOpenViewer} onNavigate={navigate} onLike={() => { if (!liked) preference.mutate({ id: item.id, value: 'liked' }) }} onDislike={() => { if (item.preference !== 'disliked') preference.mutate({ id: item.id, value: 'disliked' }) }} onEnded={() => { if (!suspended && autoScroll && next) { setDirection('next'); setActive(next) } }} /></div>
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start p-3 sm:p-5">
      <p className="pointer-events-auto rounded-full bg-canvas/80 px-3 py-1 text-lg font-semibold tracking-tight">luma<span className="text-accent">.</span><Clapperboard className="ml-1 inline size-3 align-super text-accent" aria-hidden="true" /><span className="sr-only"> reels</span></p>
    </div>
    {/* The shared action row sits just above the seek strip; see MediaActions. */}
    <div hidden={isFullscreen}><MediaActions preference={item.preference} onPreference={value => preference.mutate({ id: item.id, value })}
      menuOpen={menuOpen} onMenuOpenChange={setMenuOpen} menuLabel="Reels menu" className="bottom-16">
      <IconButton label="Filters" className={actionButton} onClick={onFilters}><SlidersHorizontal className="size-4" /></IconButton>
      {onToggleFilters && <IconButton label={filtersVisible ? 'Hide filters' : 'Show filters'} className={actionButton} onClick={onToggleFilters}>{filtersVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</IconButton>}
      <IconButton label={muted ? 'Unmute' : 'Mute'} className={actionButton} aria-pressed={muted} onClick={() => setMuted(!muted)}>{muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}</IconButton>
      <IconButton label="Auto-scroll" className={actionButton} aria-pressed={autoScroll} onClick={() => setAutoScroll(value => !value)}><Timer className={`size-4 ${autoScroll ? 'text-accent' : ''}`} /></IconButton>
      <IconButton label="Tags" className={actionButton} aria-pressed={tags} onClick={() => setTags(!tags)}><Tag className="size-4" /></IconButton>
      <IconButton label="View options" className={actionButton} onClick={() => setOptionsOpen(true)}><Settings2 className="size-4" /></IconButton>
      <IconButton label="Media information" className={actionButton} onClick={() => setInfoOpen(true)}><Info className="size-4" /></IconButton>
      <IconButton label="Previous" className={actionButton} disabled={!neighbors.data?.previous} onClick={() => navigate('previous')}><ChevronUp className="size-4" /></IconButton>
      <IconButton label="Next" className={actionButton} disabled={!next} onClick={() => navigate('next')}><ChevronDown className="size-4" /></IconButton>
    </MediaActions></div>
    <Modal open={tags} onOpenChange={setTags} title="Tags" description="Add or remove tags for this item." sheet><div className="overflow-auto p-5"><TagEditor key={item.id} mediaIds={[item.id]} tags={item.tags} /></div></Modal>
    <Modal open={infoOpen} onOpenChange={setInfoOpen} title="Media information" description="File information for this reel." sheet><div className="overflow-auto p-5"><MediaInformation item={item} /><div className="mt-6"><MetadataExchange mediaIds={[item.id]} /></div></div></Modal>
    {preference.isError && <p role="alert" className="absolute bottom-28 z-10 rounded-full bg-canvas px-4 py-2 text-sm text-danger">{errorMessage(preference.error)}</p>}
    {neighbors.isError && <p role="alert" className="absolute bottom-20 z-10 rounded-full bg-canvas px-4 py-2 text-sm text-danger">{errorMessage(neighbors.error)}</p>}
  </section>
}
