import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { FolderOpen, Heart, Tag } from 'lucide-react'
import { QuietButton } from '../../components/ui/Controls'
import { errorMessage, request, type Filters, type Library } from './api'
import type { components } from '../../lib/api/generated'

export function Collections({ libraries, onChoose }: { libraries: Library[]; onChoose: (filters: Filters, folders?: boolean) => void }) {
  const [cursor, setCursor] = useState<string>()
  const tags = useQuery({ queryKey: ['collection-tags', cursor], queryFn: ({ signal }) => request<components['schemas']['CollectionTagPage']>(`/api/collections/tags${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, signal), gcTime: 0 })
  return <div className="space-y-6 overflow-auto p-5">
    <section className="space-y-3"><h2 className="text-lg font-semibold">Favourites</h2><QuietButton onClick={() => onChoose({ preference: 'liked' })}><Heart className="size-4" />Open favourites</QuietButton></section>
    <section className="space-y-3"><h2 className="text-lg font-semibold">Folders and albums</h2><p className="text-sm text-muted">Your library folders are your albums.</p><div className="flex flex-wrap gap-3">{libraries.map(library => <QuietButton key={library.id} onClick={() => onChoose({ libraryId: library.id, folderId: library.rootFolderId ?? undefined }, true)}><FolderOpen className="size-4" />{library.name}</QuietButton>)}</div></section>
    <section className="space-y-3"><h2 className="text-lg font-semibold">Tags</h2>{tags.isPending && <p role="status">Loading tags…</p>}{tags.isError && <p role="alert" className="text-danger">{errorMessage(tags.error)}</p>}<div className="flex flex-wrap gap-2">{tags.data?.items.map(tag => <QuietButton key={tag.id} onClick={() => onChoose({ tag: [tag.name] })}><Tag className="size-4" />{tag.name}</QuietButton>)}</div>{tags.data?.items.length === 0 && <p className="text-sm text-muted">No tags yet. Add them from a media viewer.</p>}<nav aria-label="Tag pages" className="flex gap-3"><QuietButton disabled={!tags.data?.previousCursor} onClick={() => setCursor(tags.data?.previousCursor ?? undefined)}>Previous tags</QuietButton><QuietButton disabled={!tags.data?.nextCursor} onClick={() => setCursor(tags.data?.nextCursor ?? undefined)}>Next tags</QuietButton></nav></section>
  </div>
}
