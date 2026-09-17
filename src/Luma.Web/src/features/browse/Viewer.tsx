import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Heart, Info, Tag, ThumbsDown, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { MediaStage } from './MediaStage'
import { IconButton, QuietButton } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { MetadataExchange } from '../tags/MetadataExchange'
import { TagEditor } from '../tags/TagEditor'
import { usePreviewPriority } from './usePreviewPriority'
import { errorMessage, queryString, request, type Filters, type Media, type Neighbors, type Library } from './api'

export function Viewer({ active, filters, onChange, onClose, restoreFocus }: { active: Media; filters: Filters; onChange: (item: Media) => void; onClose: () => void; restoreFocus: () => void }) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [open, setOpen] = useState(true)
  const [direction, setDirection] = useState<'next' | 'previous'>('next')
  const navigate = useCallback((media: Media, direction: 'next' | 'previous') => { setDirection(direction); onChange(media) }, [onChange])
  const client = useQueryClient()
  const detail = useQuery({ queryKey: ['detail', active.id], queryFn: ({ signal }) => request<Media>(`/api/media/${active.id}`, signal), gcTime: 0, refetchInterval: query => query.state.data?.preview.status === 'ready' ? false : 3000 })
  const item = detail.data ?? active
  const neighbors = useQuery({ queryKey: ['neighbors', filters, active.id], queryFn: ({ signal }) => request<Neighbors>(`/api/media/${active.id}/neighbors?${queryString(filters)}`, signal), gcTime: 0 })
  const previous = neighbors.data?.previous
  const next = neighbors.data?.next
  usePreviewPriority([item, next, previous])
  const libraries = useQuery({ queryKey: ['libraries'], queryFn: ({ signal }) => request<Library[]>('/api/libraries', signal) })
  const rootFolder = libraries.data?.find(library => library.id === item.libraryId)?.rootFolderId
  const coverFolder = filters.folderId ?? item.folderId
  const cover = useMutation({ mutationFn: ({ folder, mediaId }: { folder: number; mediaId: number }) => request(`/api/folders/${folder}/cover`, undefined, 'PUT', { mediaId }), onSuccess: async () => { await Promise.all([client.invalidateQueries({ queryKey: ['libraries'] }), client.invalidateQueries({ queryKey: ['folders'] })]) } })
  const preference = useMutation({ mutationFn: (value: string) => request(`/api/media/${active.id}/preference`, undefined, 'PUT', { preference: value }), onSuccess: async () => {
    await Promise.all([client.invalidateQueries({ queryKey: ['detail', active.id] }), client.invalidateQueries({ queryKey: ['media'] }), client.invalidateQueries({ queryKey: ['neighbors'] })])
  } })
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (!open || detailsOpen) return
      if (event.target instanceof HTMLElement && (event.target.closest('input,select,textarea,video,[contenteditable="true"]') || event.ctrlKey || event.metaKey || event.altKey)) return
      if (event.key === 'ArrowLeft' && previous) { event.preventDefault(); navigate(previous, 'previous') }
      if (event.key === 'ArrowRight' && next) { event.preventDefault(); navigate(next, 'next') }
      if (event.key.toLowerCase() === 'i') { event.preventDefault(); setDetailsOpen(true) }
      if (event.key.toLowerCase() === 't') { event.preventDefault(); setDetailsOpen(true); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[role="dialog"] input[name="tag"]')?.focus()) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [previous, next, navigate, open, detailsOpen])
  return <>
    <Modal open={open} onOpenChange={setOpen} onClosed={onClose} title={item.fileName} description="Media viewer. Use Left and Right arrows to navigate, I for details, and Escape to close." wide hideHeader restoreFocus={restoreFocus}>
      <section className="relative flex min-h-0 flex-1 items-center justify-center bg-black" aria-label="Media preview">
        <div className="flex h-full w-full items-center justify-center overflow-hidden"><MediaStage item={item} direction={direction} onNavigate={direction => { const target = direction === 'next' ? next : previous; if (target) navigate(target, direction) }} /></div>
        <header className="absolute inset-x-0 top-0 flex items-center justify-between p-3 sm:p-5">
          <div className="min-w-0 flex-1 space-y-2 pr-3"><div className="w-fit rounded-full bg-canvas/85 px-4 py-2 text-sm font-medium text-ink"><span className="block max-w-52 truncate sm:max-w-md">{item.fileName}</span></div>
            <section aria-label="Gallery covers" className="flex flex-wrap items-center gap-2"><QuietButton className="border-transparent bg-canvas/85 px-3 text-xs" disabled={cover.isPending || item.availability === 'missing'} onClick={() => cover.mutate({ folder: coverFolder, mediaId: item.id })}>Use as folder cover</QuietButton>{rootFolder && <QuietButton className="border-transparent bg-canvas/85 px-3 text-xs" disabled={cover.isPending || item.availability === 'missing'} onClick={() => cover.mutate({ folder: rootFolder, mediaId: item.id })}>Use as library cover</QuietButton>}{cover.isSuccess && <p role="status" className="rounded-full bg-canvas/85 px-3 py-2 text-xs text-ink">Cover saved.</p>}{cover.isError && <p role="alert" className="rounded-md bg-canvas/85 px-3 py-2 text-sm text-danger">{errorMessage(cover.error)}</p>}</section>
          </div>
          <IconButton label="Close viewer" className="border-transparent bg-canvas/85" onClick={() => setOpen(false)}><X className="size-5" /></IconButton>
        </header>
        <div className={`pointer-events-none absolute inset-x-0 ${item.mediaType === 'video' ? 'bottom-20' : 'bottom-16'} flex items-end justify-between p-3 sm:p-5 [&_button]:pointer-events-auto`}>
          <IconButton label="Previous item" className="border-transparent bg-canvas/85" disabled={!previous || preference.isPending} onClick={() => previous && navigate(previous, 'previous')}><ArrowLeft className="size-5" /></IconButton>
          <div className="flex items-center gap-2"><QuietButton className="border-transparent bg-canvas/85 px-3" aria-pressed={item.preference === 'liked'} disabled={preference.isPending} onClick={() => preference.mutate(item.preference === 'liked' ? 'neutral' : 'liked')}><Heart className={`size-4 ${item.preference === 'liked' ? 'fill-accent text-accent' : ''}`} /><span className="sr-only sm:not-sr-only">Like</span></QuietButton><IconButton label="Media details" className="border-transparent bg-canvas/85" onClick={() => setDetailsOpen(true)}><Info className="size-5" /></IconButton></div>
          <IconButton label="Next item" className="border-transparent bg-canvas/85" disabled={!next || preference.isPending} onClick={() => next && navigate(next, 'next')}><ArrowRight className="size-5" /></IconButton>
        </div>
        {neighbors.isError && <p role="alert" className="absolute bottom-20 rounded-full bg-canvas px-4 py-2 text-sm text-danger">{errorMessage(neighbors.error)}</p>}
      </section>
    </Modal>
    <Modal open={detailsOpen} onOpenChange={setDetailsOpen} title="Media details" description="Tags and file information." sheet>
      <div className="space-y-6 overflow-auto p-5"><div className="flex gap-2"><QuietButton aria-pressed={item.preference === 'liked'} disabled={preference.isPending} onClick={() => preference.mutate(item.preference === 'liked' ? 'neutral' : 'liked')}><Heart className={`size-4 ${item.preference === 'liked' ? 'fill-accent text-accent' : ''}`} />Like</QuietButton><QuietButton aria-pressed={item.preference === 'disliked'} disabled={preference.isPending} onClick={() => preference.mutate(item.preference === 'disliked' ? 'neutral' : 'disliked')}><ThumbsDown className={`size-4 ${item.preference === 'disliked' ? 'fill-danger text-danger' : ''}`} />Dislike</QuietButton></div>
        <div><h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Tag className="size-4 text-accent" />Tags</h2><TagEditor key={item.id} mediaIds={[item.id]} tags={item.tags} /></div>
        <MetadataExchange key={item.id} mediaIds={[item.id]} imports={false} />
        <dl className="grid grid-cols-2 gap-4 text-sm"><div><dt className="text-muted">Modified</dt><dd>{new Date(item.modifiedAt).toLocaleString()}</dd></div><div><dt className="text-muted">File size</dt><dd>{(item.sizeBytes / 1024 / 1024).toFixed(2)} MB</dd></div>{item.width && item.height && <div><dt className="text-muted">Dimensions</dt><dd>{item.width} × {item.height}</dd></div>}{item.mediaType === 'video' && <div><dt className="text-muted">Video</dt><dd>{item.durationMs ? `${(item.durationMs / 1000).toFixed(1)} seconds` : 'Duration unknown'}</dd></div>}</dl>
        {preference.isError && <p role="alert" className="text-sm text-danger">{errorMessage(preference.error)}</p>}{detail.isError && <p role="alert" className="text-sm text-danger">{errorMessage(detail.error)}</p>}</div>
    </Modal>
  </>
}
