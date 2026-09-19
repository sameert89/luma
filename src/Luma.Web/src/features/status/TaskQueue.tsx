import { useQuery, useIsMutating, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { QuietButton } from '../../components/ui/Controls'
import { errorMessage, request, type IndexingStatus } from '../browse/api'
import type { components } from '../../lib/api/generated'

type Task = components['schemas']['BackgroundTask']

const kindLabels: Record<string, string> = { indexing: 'Indexing', import: 'Tag import', xmp: 'XMP export', dislikes: 'Disliked paths export' }
const stateLabels: Record<string, string> = { queued: 'Queued', running: 'Running', completed: 'Completed', cancelled: 'Cancelled', failed: 'Failed', interrupted: 'Interrupted', expired: 'Expired' }
const stateTones: Record<string, string> = { running: 'text-accent', completed: 'text-positive', failed: 'text-danger', interrupted: 'text-danger' }

const isActive = (task: Task) => task.state === 'queued' || task.state === 'running'
// Work that stopped before finishing can be run again (as a new task); finished work is only cleared.
const canQueueAgain = (task: Task) => ['cancelled', 'failed', 'interrupted'].includes(task.state)
const label = (task: Task) => kindLabels[task.kind] ?? task.kind

function progress(task: Task) {
  const failed = task.failed ? ` · ${task.failed.toLocaleString()} failed` : ''
  if (task.kind === 'indexing')
    return `${task.processed.toLocaleString()} found${task.pending ? ` · ${task.pending.toLocaleString()} previews to prepare` : ''}${failed}`
  if (task.kind === 'import') return `${task.processed.toLocaleString()} checked${failed}`
  return `${task.processed.toLocaleString()} exported${failed}`
}

const refresh = (client: QueryClient) => Promise.all(['tasks', 'indexing', 'scan', 'media', 'folders', 'libraries', 'metadata-job']
  .map(key => client.invalidateQueries({ queryKey: [key] })))

/**
 * Background work: what is running now, what stopped and can be run again, and what finished.
 * Active tasks can be cancelled; anything no longer active can be cleared from the list.
 */
export function TaskQueue() {
  const client = useQueryClient()
  // Operations started elsewhere (a rescan, an import) show here until the server accepts them.
  const starting = useIsMutating({ predicate: mutation => mutation.options.mutationKey?.[0] === 'background-task' })
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: ({ signal }) => request<Task[]>('/api/tasks', signal), refetchInterval: query => starting || query.state.data?.some(isActive) ? 2000 : 10000 })
  const clear = useMutation({ mutationFn: () => request('/api/tasks/clear-finished', undefined, 'POST'), onSuccess: () => client.invalidateQueries({ queryKey: ['tasks'] }) })
  const indexing = useQuery({ queryKey: ['indexing'], queryFn: ({ signal }) => request<IndexingStatus>('/api/indexing', signal), refetchInterval: 10000 })
  const finished = tasks.data?.filter(task => !isActive(task)).length ?? 0
  const running = (tasks.data?.length ?? 0) - finished
  return <section aria-label="Task queue" className="space-y-3">
    <div className="flex items-center justify-between gap-3 py-2">
      <p className="text-sm font-semibold">Jobs{running > 0 && <span className="font-normal text-muted"> · {running} active</span>}</p>
      <QuietButton disabled={!finished || clear.isPending} onClick={() => clear.mutate()}>{clear.isPending ? 'Clearing…' : 'Clear finished'}</QuietButton>
    </div>
    {indexing.data?.cachePressure && <p role="status" className="text-sm text-danger">Preview storage is full, so preview preparation is paused.</p>}
    {clear.isError && <p role="alert" className="text-sm text-danger">{errorMessage(clear.error)}</p>}
    {!!starting && <p role="status" className="text-sm text-muted">Starting operation…</p>}
    {tasks.isPending && <p role="status" className="text-sm text-muted">Loading tasks…</p>}
    {tasks.isError && <p role="alert" className="text-sm text-danger">{errorMessage(tasks.error)}</p>}
    {tasks.data?.map(task => <TaskRow key={task.id} task={task} />)}
    {tasks.isSuccess && !tasks.data.length && <p className="text-sm text-muted">No background tasks.</p>}
  </section>
}

function TaskRow({ task }: { task: Task }) {
  const client = useQueryClient()
  const action = useMutation({ mutationKey: ['task-action', task.id], mutationFn: (operation: 'cancel' | 'queue' | 'clear') => request(`/api/tasks/${task.id}/${operation}`, undefined, 'POST'), onSuccess: () => refresh(client) })
  const name = label(task)
  const busy = action.isPending
  // Stopping indexing changes what gets indexed later, so it says so before it happens.
  const [confirming, setConfirming] = useState(false)
  return <article aria-label={`${name}, ${stateLabels[task.state] ?? task.state}`} className="rounded-lg border border-line p-3">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-semibold">{name}</p>
        {task.scope && <p className="truncate text-sm text-muted" title={task.scope}>{task.scope}</p>}
      </div>
      <p className={`shrink-0 text-sm font-medium ${stateTones[task.state] ?? 'text-muted'}`}>{stateLabels[task.state] ?? task.state}</p>
    </div>
    <p className="mt-1 text-sm text-muted">{progress(task)}</p>
    <div className="mt-2 flex flex-wrap gap-2">
      {isActive(task)
        ? confirming ? <div className="space-y-2">
          <p className="text-sm leading-relaxed">Files found so far stay in your library, and their previews are made as you view them. Each folder you open is finished then, including its tags if the library imports tags.</p>
          <div className="flex flex-wrap gap-2">
            <QuietButton disabled={busy} onClick={() => action.mutate('cancel')}>{busy ? 'Stopping…' : 'Stop indexing'}</QuietButton>
            <QuietButton disabled={busy} onClick={() => setConfirming(false)}>Keep running</QuietButton>
          </div>
        </div>
        : <QuietButton aria-label={`Cancel ${name}`} disabled={busy} onClick={() => task.kind === 'indexing' ? setConfirming(true) : action.mutate('cancel')}>{busy ? 'Cancelling…' : 'Cancel'}</QuietButton>
        : <>
          {canQueueAgain(task) && <QuietButton aria-label={`Queue ${name} again`} disabled={busy} onClick={() => action.mutate('queue')}>Queue again</QuietButton>}
          <QuietButton aria-label={`Clear ${name}`} disabled={busy} onClick={() => action.mutate('clear')}>Clear</QuietButton>
        </>}
    </div>
    {action.isError && <p role="alert" className="mt-2 text-sm text-danger">{errorMessage(action.error)}</p>}
  </article>
}
