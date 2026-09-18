import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { QuietButton } from '../../components/ui/Controls'
import { errorMessage, queryString, request, type Filters } from './api'
import type { components } from '../../lib/api/generated'

export function TagGroups({ filters, onChoose }: { filters: Filters; onChoose: (value: Filters) => void }) {
  const [afterId, setAfterId] = useState<number>()
  const page = useQuery({ queryKey: ['tag-groups', filters, afterId], queryFn: ({ signal }) => request<components['schemas']['TagGroupPage']>(`/api/collections/tag-groups?${queryString({ ...filters, groupBy: 'none' })}${afterId ? `&afterId=${afterId}` : ''}`, signal), gcTime: 0 })
  return <div className="min-h-0 flex-1 overflow-auto p-5">
    {page.isPending && <p role="status">Loading tag collections…</p>}
    {page.isError && <p role="alert">{errorMessage(page.error)}</p>}
    {page.isSuccess && !page.data.items.length && <p role="status">No tagged media match these filters.</p>}
    <div className="grid gap-3 sm:grid-cols-3">{page.data?.items.map(tag => <section key={tag.id} className="rounded-lg border border-line bg-surface p-4"><h2 className="mb-3 font-semibold">{tag.name}</h2><QuietButton onClick={() => onChoose({ ...filters, groupBy: 'none', collectionTag: tag.name })}>Browse {tag.name}</QuietButton></section>)}</div>
    <div className="mt-4 flex gap-3">{afterId && <QuietButton onClick={() => setAfterId(undefined)}>First tag collections</QuietButton>}{page.data?.nextId && <QuietButton onClick={() => setAfterId(page.data!.nextId!)}>Next tag collections</QuietButton>}</div>
  </div>
}
