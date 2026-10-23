import { t } from '../../lib/i18n'
import { useQuery, useIsMutating, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { QuietButton } from '../../components/ui/Controls'
import { errorMessage, request, type IndexingStatus } from '../browse/api'
import { FileRecoveryDialog } from '../files/FileRecoveryDialog'
import type { components } from '../../lib/api/generated'

type Task = components['schemas']['BackgroundTask']

const kindLabels: Record<string, string> = {
  indexing: t('status:taskQueue.indexing'),
  upload: t('status:taskQueue.upload'),
  comics: t('status:taskQueue.comicDiscovery'),
  mkdir: t('status:taskQueue.newFolder'),
  move: t('status:taskQueue.moveRename'),
  copy: t('status:taskQueue.copy'),
  recycle: t('status:taskQueue.recycle'),
  restore: t('status:taskQueue.restore'),
  delete: t('status:taskQueue.permanentDeletion'),
  purge: t('status:taskQueue.recycleBinDeletion'),
  import: t('status:taskQueue.tagImport'),
  xmp: t('status:taskQueue.xMPExport'),
  dislikes: t('status:taskQueue.dislikedPathsExport'),
}
const stateLabels: Record<string, string> = {
  queued: t('status:taskQueue.queued'),
  waitingForClient: t('status:taskQueue.waitingForUploadData'),
  paused: t('status:taskQueue.paused'),
  reserved: t('status:taskQueue.reserved'),
  published: t('status:taskQueue.published'),
  deleting: t('status:taskQueue.deleting'),
  finalizing: t('status:taskQueue.finalizing'),
  needsAttention: t('status:taskQueue.needsAttention'),
  running: t('status:taskQueue.running'),
  completed: t('status:taskQueue.completed'),
  cancelled: t('status:taskQueue.cancelled'),
  failed: t('status:taskQueue.failed'),
  interrupted: t('status:taskQueue.interrupted'),
  expired: t('status:taskQueue.expired'),
}
const stateTones: Record<string, string> = {
  running: 'text-accent',
  completed: 'text-positive',
  failed: 'text-danger',
  needsAttention: 'text-danger',
  interrupted: 'text-danger',
}

const isActive = (task: Task) =>
  ['queued', 'running', 'waitingForClient', 'paused', 'reserved', 'deleting', 'published', 'finalizing'].includes(
    task.state,
  )
// Work that stopped before finishing can be run again (as a new task); finished work is only cleared.
const canQueueAgain = (task: Task) => ['cancelled', 'failed', 'interrupted'].includes(task.state)
const label = (task: Task) => kindLabels[task.kind] ?? task.kind

function progress(task: Task) {
  if (task.kind === 'upload')
    return t('status:taskQueue.bytesUploadedBytesRemaining', {
      value1: task.processed.toLocaleString(),
      value2: task.pending.toLocaleString(),
    })
  if (['mkdir', 'copy', 'move', 'recycle', 'restore', 'delete', 'purge'].includes(task.kind))
    return task.state === 'completed'
      ? t('status:taskQueue.operationCompleted')
      : task.state === 'needsAttention'
        ? t('status:taskQueue.inspectOperationEvidenceBeforeContinuingThisLibraryIsProtected')
        : t('status:taskQueue.operationInProgress')
  const failed = task.failed ? t('status:taskQueue.failedCount', { count: task.failed }) : ''
  if (task.kind === 'indexing')
    return t('status:taskQueue.indexingProgress', {
      count: task.processed,
      pending: task.pending ? t('status:taskQueue.previewsToPrepare', { count: task.pending }) : '',
      failed,
    })
  return t(task.kind === 'import' ? 'status:taskQueue.importProgress' : 'status:taskQueue.exportProgress', {
    count: task.processed,
    failed,
  })
}

const refresh = (client: QueryClient) =>
  Promise.all(
    ['tasks', 'indexing', 'scan', 'media', 'folders', 'libraries', 'metadata-job'].map(key =>
      client.invalidateQueries({ queryKey: [key] }),
    ),
  )

/**
 * Background work: what is running now, what stopped and can be run again, and what finished.
 * Active tasks can be cancelled; anything no longer active can be cleared from the list.
 */
export function TaskQueue() {
  const client = useQueryClient()
  // Operations started elsewhere (a rescan, an import) show here until the server accepts them.
  const starting = useIsMutating({ predicate: mutation => mutation.options.mutationKey?.[0] === 'background-task' })
  const tasks = useQuery({
    queryKey: ['tasks'],
    queryFn: ({ signal }) => request<Task[]>('/api/tasks', signal),
    refetchInterval: query => (starting || query.state.data?.some(isActive) ? 2000 : 10000),
  })
  const clear = useMutation({
    mutationFn: () => request('/api/tasks/clear-finished', undefined, 'POST'),
    onSuccess: () => client.invalidateQueries({ queryKey: ['tasks'] }),
  })
  const indexing = useQuery({
    queryKey: ['indexing'],
    queryFn: ({ signal }) => request<IndexingStatus>('/api/indexing', signal),
    refetchInterval: 10000,
  })
  const finished = tasks.data?.filter(task => !isActive(task)).length ?? 0
  const running = (tasks.data?.length ?? 0) - finished
  return (
    <section aria-label={t('status:taskQueue.taskQueue')} className="space-y-3">
      <div className="flex items-center justify-between gap-3 py-2">
        <p className="text-sm font-semibold">
          {t('status:taskQueue.jobs')}
          {running > 0 && (
            <span className="font-normal text-muted">{t('status:taskQueue.active', { running: running })}</span>
          )}
        </p>
        <QuietButton disabled={!finished || clear.isPending} onClick={() => clear.mutate()}>
          {clear.isPending ? t('status:taskQueue.clearing') : t('status:taskQueue.clearFinished')}
        </QuietButton>
      </div>
      {indexing.data?.cachePressure && (
        <p role="status" className="text-sm text-danger">
          {t('status:taskQueue.previewStorageIsFullSoPreviewPreparationIsPaused')}
        </p>
      )}
      {clear.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(clear.error)}
        </p>
      )}
      {!!starting && (
        <p role="status" className="text-sm text-muted">
          {t('status:taskQueue.startingOperation')}
        </p>
      )}
      {tasks.isPending && (
        <p role="status" className="text-sm text-muted">
          {t('status:taskQueue.loadingTasks')}
        </p>
      )}
      {tasks.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(tasks.error)}
        </p>
      )}
      {tasks.data?.map(task => (
        <TaskRow key={task.id} task={task} />
      ))}
      {tasks.isSuccess && !tasks.data.length && (
        <p className="text-sm text-muted">{t('status:taskQueue.noBackgroundTasks')}</p>
      )}
    </section>
  )
}

function TaskRow({ task }: { task: Task }) {
  const client = useQueryClient()
  const action = useMutation({
    mutationKey: ['task-action', task.id],
    mutationFn: (operation: 'cancel' | 'queue' | 'clear') =>
      request(`/api/tasks/${task.id}/${operation}`, undefined, 'POST'),
    onSuccess: () => refresh(client),
  })
  const name = label(task)
  const busy = action.isPending
  // Stopping indexing changes what gets indexed later, so it says so before it happens.
  const [confirming, setConfirming] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  return (
    <article
      aria-label={`${name}, ${stateLabels[task.state] ?? task.state}`}
      className="rounded-lg border border-line p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{name}</p>
          {task.scope && (
            <p className="truncate text-sm text-muted" title={task.scope}>
              {task.scope}
            </p>
          )}
        </div>
        <p className={`shrink-0 text-sm font-medium ${stateTones[task.state] ?? 'text-muted'}`}>
          {stateLabels[task.state] ?? task.state}
        </p>
      </div>
      <p className="mt-1 text-sm text-muted">{progress(task)}</p>
      {reviewing && (
        <FileRecoveryDialog
          id={task.id.slice(5)}
          onClose={() => setReviewing(false)}
          onResolved={() => void refresh(client)}
        />
      )}
      {task.id.startsWith('file-') && task.state === 'needsAttention' && (
        <QuietButton className="mt-2" onClick={() => setReviewing(true)}>
          {t('status:taskQueue.reviewRecovery')}
        </QuietButton>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {isActive(task) ? (
          confirming ? (
            <div className="space-y-2">
              <p className="text-sm leading-relaxed">{t('status:taskQueue.filesFoundSoFarStayInYourLibraryAnd')}</p>
              <div className="flex flex-wrap gap-2">
                <QuietButton disabled={busy} onClick={() => action.mutate('cancel')}>
                  {busy ? t('status:taskQueue.stopping') : t('status:taskQueue.stopIndexing')}
                </QuietButton>
                <QuietButton disabled={busy} onClick={() => setConfirming(false)}>
                  {t('status:taskQueue.keepRunning')}
                </QuietButton>
              </div>
            </div>
          ) : (
            <QuietButton
              aria-label={t('status:taskQueue.cancel', { value1: name })}
              disabled={
                busy ||
                (task.id.startsWith('file-') && task.state !== 'queued') ||
                (task.id.startsWith('upload-') && task.state === 'finalizing')
              }
              onClick={() => (task.kind === 'indexing' ? setConfirming(true) : action.mutate('cancel'))}
            >
              {busy ? t('status:taskQueue.cancelling') : t('status:taskQueue.cancel2')}
            </QuietButton>
          )
        ) : (
          <>
            {canQueueAgain(task) && (
              <QuietButton
                aria-label={t('status:taskQueue.queueAgain', { value1: name })}
                disabled={busy}
                onClick={() => action.mutate('queue')}
              >
                {t('status:taskQueue.queueAgain2')}
              </QuietButton>
            )}
            <QuietButton
              aria-label={t('status:taskQueue.clear', { value1: name })}
              disabled={busy || task.state === 'needsAttention'}
              onClick={() => action.mutate('clear')}
            >
              {t('status:taskQueue.clear2')}
            </QuietButton>
          </>
        )}
      </div>
      {action.isError && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorMessage(action.error)}
        </p>
      )}
    </article>
  )
}
