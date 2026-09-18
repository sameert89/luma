import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff } from 'lucide-react'
import { QuietButton } from '../../components/ui/Controls'
import { errorMessage, request } from './api'
import type { components } from '../../lib/api/generated'

type HiddenFolder = components['schemas']['HiddenFolderSummary']

export const hiddenFolderQueries = [['folders'], ['media'], ['libraries'], ['hidden-folders'], ['reels-first'], ['reels-neighbors'], ['neighbors']]

export function HiddenFolders() {
  const client = useQueryClient()
  const hidden = useQuery({ queryKey: ['hidden-folders'], queryFn: ({ signal }) => request<HiddenFolder[]>('/api/folders/hidden', signal) })
  const show = useMutation({ mutationFn: (id: number) => request(`/api/folders/${id}/hidden`, undefined, 'PUT', { hidden: false }),
    onSuccess: () => { for (const queryKey of hiddenFolderQueries) void client.invalidateQueries({ queryKey }) } })
  return <section aria-labelledby="hidden-folders-title" className="mx-auto max-w-5xl space-y-3 px-5 pb-5">
    <div className="rounded-3xl border border-line bg-surface p-5">
      <h2 id="hidden-folders-title" className="flex items-center gap-2 text-lg font-semibold"><EyeOff className="size-5 text-accent" aria-hidden="true" />Hidden folders</h2>
      <p className="mt-1 text-sm text-muted">Hidden folders and everything inside them are left out of the library, search, reels, slideshows and indexing. Hide a folder from its folder actions.</p>
      {hidden.isPending && <p role="status" className="mt-4 text-sm text-muted">Loading hidden folders…</p>}
      {hidden.isError && <p role="alert" className="mt-4 text-sm text-danger">{errorMessage(hidden.error)}</p>}
      {hidden.data?.length === 0 && <p className="mt-4 text-sm text-muted">No folders are hidden.</p>}
      {!!hidden.data?.length && <ul className="mt-4 divide-y divide-line">{hidden.data.map(folder => <li key={folder.id} className="flex items-center gap-3 py-2">
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium" title={folder.path}>{folder.path}</p><p className="truncate text-xs text-muted">{folder.libraryName}</p></div>
        <QuietButton aria-label={`Show ${folder.path}`} disabled={show.isPending} onClick={() => show.mutate(folder.id)}><Eye className="size-4" />Show</QuietButton>
      </li>)}</ul>}
      {show.isError && <p role="alert" className="mt-2 text-sm text-danger">{errorMessage(show.error)}</p>}
    </div>
  </section>
}
