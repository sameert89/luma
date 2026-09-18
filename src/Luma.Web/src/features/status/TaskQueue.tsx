import { useQuery, useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { QuietButton } from '../../components/ui/Controls'
import { errorMessage, request } from '../browse/api'
import type { components } from '../../lib/api/generated'

// The queue lives in the existing indexing indicator's panel.
export function TaskQueue() {
  const client = useQueryClient()
  const starting = useIsMutating({ predicate: mutation => mutation.options.mutationKey?.[0] === 'background-task' })
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: ({ signal }) => request<components['schemas']['BackgroundTask'][]>('/api/tasks', signal), refetchInterval: query => starting || query.state.data?.some(task => ['queued', 'running'].includes(task.state)) ? 2000 : 10000 })
  const action = useMutation({ mutationKey: ['background-task'], mutationFn: ({ id, operation }: { id: string; operation: 'cancel' | 'queue' }) => request(`/api/tasks/${id}/${operation}`, undefined, 'POST'), onSuccess: async () => {
    await Promise.all(['tasks', 'indexing', 'scan', 'media', 'folders', 'libraries', 'metadata-job'].map(key => client.invalidateQueries({ queryKey: [key] })))
  } })
  const clear = useMutation({ mutationFn: () => request('/api/tasks/clear-finished', undefined, 'POST'), onSuccess: () => client.invalidateQueries({ queryKey: ['tasks'] }) })
  const hasFinished = tasks.data?.some(task => !['queued', 'running'].includes(task.state))
  return <section aria-label="Task queue" className="space-y-3">
    <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-canvas py-2"><p className="text-sm font-semibold">Queue</p><QuietButton disabled={!hasFinished || clear.isPending || action.isPending} onClick={() => clear.mutate()}>{clear.isPending ? 'Clearing…' : 'Clear finished'}</QuietButton></div>
    {clear.isError && <p role="alert">{errorMessage(clear.error)}</p>}
    {!!starting && <p role="status">Starting operation…</p>}
    {tasks.isPending && <p role="status">Loading tasks…</p>}
    {tasks.isError && <p role="alert">{errorMessage(tasks.error)}</p>}
    {action.isError && <p role="alert">{errorMessage(action.error)}</p>}
    {tasks.data?.map(task => <article key={task.id} className="rounded-lg border border-line p-3"><p className="font-semibold">{task.kind} · {task.state}</p>{task.scope && <p className="truncate text-sm text-muted" title={task.scope}>{task.scope}</p>}<p className="text-sm text-muted">{task.processed} processed · {task.pending} pending · {task.failed} failed</p><QuietButton className="mt-2" disabled={action.isPending || clear.isPending} onClick={() => action.mutate({ id: task.id, operation: ['queued', 'running'].includes(task.state) ? 'cancel' : 'queue' })}>{['queued', 'running'].includes(task.state) ? task.kind === 'indexing' ? 'Cancel scan' : 'Cancel' : 'Queue again'}</QuietButton></article>)}
    {tasks.isSuccess && !tasks.data.length && <p>No background tasks.</p>}
  </section>
}
