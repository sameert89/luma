import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { ArrowUp, ArrowDown, Clapperboard, SlidersHorizontal, Tag, Timer, Volume2, VolumeX } from 'lucide-react'
import { IconButton } from '../../components/ui/Controls'
import { MediaStage } from './MediaStage'
import { TagEditor } from '../tags/TagEditor'
import { errorMessage, queryString, request, type Filters, type Media, type MediaPage, type Neighbors } from './api'

const autoScrollSeconds = 3

export function Reels({ filters, onFilters, onOpenViewer }: { filters: Filters; onFilters: () => void; onOpenViewer: (item: Media) => void }) {
  const root = useRef<HTMLElement>(null)
  const queryFilters: Filters = { ...filters, mediaType: 'video', libraryId: undefined, folderId: undefined }
  const [active, setActive] = useState<Media | null>(null)
  const [direction, setDirection] = useState<'next' | 'previous'>('next')
  const [muted, setMuted] = useState(true)
  const [autoScroll, setAutoScroll] = useState(false)
  const [tags, setTags] = useState(false)
  const first = useQuery({ queryKey: ['reels-first', queryFilters], queryFn: ({ signal }) => request<MediaPage>(`/api/media?${queryString({ ...queryFilters, limit: 1 })}`, signal), gcTime: 0 })
  const base = active ?? first.data?.items[0]
  const detail = useQuery({ queryKey: ['detail', base?.id], queryFn: ({ signal }) => request<Media>(`/api/media/${base!.id}`, signal), enabled: !!base, gcTime: 0, refetchInterval: query => query.state.data?.preview.status === 'ready' ? false : 3000 })
  const item = detail.data ?? base
  const neighbors = useQuery({ queryKey: ['reels-neighbors', queryFilters, item?.id], queryFn: ({ signal }) => request<Neighbors>(`/api/media/${item!.id}/neighbors?${queryString(queryFilters)}`, signal), enabled: !!item, gcTime: 0 })
  const next = neighbors.data?.next
  useEffect(() => {
    if (next?.preview.status !== 'ready') return
    const preload = new Image()
    preload.src = next.preview.url
    return () => preload.removeAttribute('src')
  }, [next?.preview.status, next?.preview.url])
  function navigate(direction: 'next' | 'previous') { const target = neighbors.data?.[direction]; if (target) { setDirection(direction); setActive(target) } }
  useEffect(() => { if (!autoScroll || !item || item.mediaType === 'video' || !next) return; const timer = window.setTimeout(() => { setDirection('next'); setActive(next) }, autoScrollSeconds * 1000); return () => window.clearTimeout(timer) }, [autoScroll, item, next])
  useEffect(() => { function key(event: KeyboardEvent) { if (event.target instanceof HTMLElement && event.target.closest('input,select,textarea,video,button')) return; if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const move = event.key === 'ArrowDown' ? 'next' : 'previous'; const target = neighbors.data?.[move]; if (target) { setDirection(move); setActive(target) } } }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key) }, [neighbors.data])
  if (first.isError) return <p role="alert" className="p-5 text-danger">{errorMessage(first.error)}</p>
  if (!item) return <p role="status" className="p-5 text-muted">{first.isPending ? 'Loading reels...' : 'No videos match these filters.'}</p>
  return <section ref={root} aria-label="Reels" className="relative flex min-h-0 flex-1 flex-col bg-black">
    <div key={item.id} data-axis="vertical" data-direction={direction} className="motion-media flex min-h-0 flex-1"><MediaStage key={item.id} item={item} reels muted={muted} fullscreenRoot={root} onOpenViewer={onOpenViewer} onNavigate={navigate} onEnded={() => { if (autoScroll && next) { setDirection('next'); setActive(next) } }} /></div>
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-3 sm:p-5">
      <p className="pointer-events-auto rounded-full bg-canvas/80 px-3 py-1 text-lg font-semibold tracking-tight">luma<span className="text-accent">.</span><Clapperboard className="ml-1 inline size-3 align-super text-accent" aria-hidden="true" /><span className="sr-only"> reels</span></p>
      <div className="pointer-events-auto flex flex-col gap-2">
        <IconButton label="Filters" className="border-transparent bg-canvas/85" onClick={onFilters}><SlidersHorizontal className="size-4" /></IconButton>
        <IconButton label={muted ? 'Unmute' : 'Mute'} className="border-transparent bg-canvas/85" aria-pressed={muted} onClick={() => setMuted(!muted)}>{muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}</IconButton>
        <IconButton label="Auto-scroll" className="border-transparent bg-canvas/85" aria-pressed={autoScroll} onClick={() => setAutoScroll(value => !value)}><Timer className={`size-4 ${autoScroll ? 'text-accent' : ''}`} /></IconButton>
        <IconButton label="Tags" className="border-transparent bg-canvas/85" aria-pressed={tags} onClick={() => setTags(!tags)}><Tag className="size-4" /></IconButton>
        <IconButton label="Previous" className="border-transparent bg-canvas/85" disabled={!neighbors.data?.previous} onClick={() => navigate('previous')}><ArrowUp className="size-4" /></IconButton>
        <IconButton label="Next" className="border-transparent bg-canvas/85" disabled={!next} onClick={() => navigate('next')}><ArrowDown className="size-4" /></IconButton>
      </div>
    </div>
    {tags && <div className="absolute inset-x-0 bottom-16 z-20 max-h-96 overflow-auto rounded-t-3xl border-t border-line bg-canvas/95 p-5 md:bottom-0"><TagEditor key={item.id} mediaIds={[item.id]} tags={item.tags} /></div>}
    {neighbors.isError && <p role="alert" className="absolute bottom-20 z-10 rounded-full bg-canvas px-4 py-2 text-sm text-danger">{errorMessage(neighbors.error)}</p>}
  </section>
}
