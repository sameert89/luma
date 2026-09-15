import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Heart, ThumbsDown } from 'lucide-react'
import { useEffect } from 'react'
import { CachedImage } from '../../components/ui/CachedImage'
import { IconButton, QuietButton } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { TagEditor } from '../tags/TagEditor'
import { errorMessage, queryString, request, type Filters, type Media, type Neighbors } from './api'

export function Viewer({ active, filters, onChange, onClose, restoreFocus }: { active: Media; filters: Filters; onChange: (item: Media) => void; onClose: () => void; restoreFocus: () => void }) {
  const client = useQueryClient()
  const detail = useQuery({ queryKey: ['detail', active.id], queryFn: ({ signal }) => request<Media>(`/api/media/${active.id}`, signal), gcTime: 0 })
  const item = detail.data ?? active
  const neighbors = useQuery({ queryKey: ['neighbors', filters, active.id], queryFn: ({ signal }) => request<Neighbors>(`/api/media/${active.id}/neighbors?${queryString(filters)}`, signal), gcTime: 0 })
  const previous = neighbors.data?.previous
  const next = neighbors.data?.next
  const preference = useMutation({ mutationFn: (value: string) => request(`/api/media/${active.id}/preference`, undefined, 'PUT', { preference: value }), onSuccess: async () => {
    await Promise.all([client.invalidateQueries({ queryKey: ['detail', active.id] }), client.invalidateQueries({ queryKey: ['media'] }), client.invalidateQueries({ queryKey: ['neighbors'] })])
  } })
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (event.target instanceof HTMLElement && (event.target.closest('input,select,textarea,[contenteditable="true"]') || event.ctrlKey || event.metaKey || event.altKey)) return
      if (event.key === 'ArrowLeft' && previous) { event.preventDefault(); onChange(previous) }
      if (event.key === 'ArrowRight' && next) { event.preventDefault(); onChange(next) }
      if (event.key.toLowerCase() === 't') { event.preventDefault(); document.querySelector<HTMLInputElement>('[role="dialog"] input[name="tag"]')?.focus() }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [previous, next, onChange])
  return <Modal open onOpenChange={open => { if (!open) onClose() }} title={item.fileName} description="Cached media preview. Use Left and Right arrows to navigate, T to edit tags, and Escape to close." wide restoreFocus={restoreFocus}>
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <section className="relative flex min-h-0 flex-1 flex-col bg-black/30" aria-label="Media preview">
        <div className="flex min-h-0 flex-1 items-center justify-center p-3"><CachedImage key={item.preview.url} url={item.preview.url} alt={item.fileName} preview className="h-full max-h-full w-full object-contain" /></div>
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
          <IconButton label="Previous item" disabled={!previous || preference.isPending} onClick={() => previous && onChange(previous)}><ArrowLeft className="size-5" /></IconButton>
          <p className="text-center text-xs text-muted">{item.mediaType === 'video' ? 'Video poster preview' : item.width && item.height ? `${item.width} × ${item.height}` : 'Image preview'}</p>
          <IconButton label="Next item" disabled={!next || preference.isPending} onClick={() => next && onChange(next)}><ArrowRight className="size-5" /></IconButton>
        </div>
        {neighbors.isError && <p role="alert" className="px-4 pb-3 text-sm text-danger">{errorMessage(neighbors.error)}</p>}
      </section>
      <aside className="max-h-64 shrink-0 space-y-6 overflow-auto border-t border-line p-5 md:max-h-none md:w-80 md:border-l md:border-t-0" aria-label="Media details and tags">
        <div className="flex gap-2">
          <QuietButton aria-pressed={item.preference === 'liked'} disabled={preference.isPending} onClick={() => preference.mutate(item.preference === 'liked' ? 'neutral' : 'liked')}><Heart className={`size-4 ${item.preference === 'liked' ? 'fill-accent text-accent' : ''}`} />Like</QuietButton>
          <QuietButton aria-pressed={item.preference === 'disliked'} disabled={preference.isPending} onClick={() => preference.mutate(item.preference === 'disliked' ? 'neutral' : 'disliked')}><ThumbsDown className={`size-4 ${item.preference === 'disliked' ? 'fill-danger text-danger' : ''}`} />Dislike</QuietButton>
        </div>
        {preference.isError && <p role="alert" className="text-sm text-danger">{errorMessage(preference.error)}</p>}
        <div><h2 className="mb-3 text-sm font-semibold">Tags</h2><TagEditor key={item.id} mediaIds={[item.id]} tags={item.tags} /></div>
        <dl className="space-y-3 text-sm"><div><dt className="text-muted">Modified</dt><dd>{new Date(item.modifiedAt).toLocaleString()}</dd></div><div><dt className="text-muted">File size</dt><dd>{(item.sizeBytes / 1024 / 1024).toFixed(2)} MB</dd></div><div><dt className="text-muted">Original availability</dt><dd className="capitalize">{item.availability}</dd></div></dl>
        {detail.isError && <p role="alert" className="text-sm text-danger">{errorMessage(detail.error)}</p>}
      </aside>
    </div>
  </Modal>
}
