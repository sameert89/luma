import { t } from '../../lib/i18n'
import { useIsMutating, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { IconButton } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { request, type IndexingStatus, type Scan } from '../browse/api'
import { scanCheckpoint } from '../browse/scanCheckpoint'
import type { components } from '../../lib/api/generated'
import { TaskQueue } from './TaskQueue'

export function BackgroundJobsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('status:backgroundJobs.backgroundJobs')}
      description={t('status:backgroundJobs.uploadsFileOperationsIndexingAndMetadataJobsRescanA')}
      sheet
    >
      <div className="p-5">
        <TaskQueue />
      </div>
    </Modal>
  )
}

/**
 * Opens Background jobs; the icon turns while any job runs. With a library open it also keeps the
 * gallery current as that library's latest scan finds media and prepares previews.
 */
export function BackgroundJobsButton({ libraryId, compact = false }: { libraryId?: number; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const starting = useIsMutating({ predicate: mutation => mutation.options.mutationKey?.[0] === 'background-task' })
  const tasks = useQuery({
    queryKey: ['tasks'],
    queryFn: ({ signal }) => request<components['schemas']['BackgroundTask'][]>('/api/tasks', signal),
    refetchInterval: 3000,
  })
  const client = useQueryClient()
  const previous = useRef<Map<string, string> | null>(null)
  useEffect(() => {
    if (!tasks.data) return
    const changed = tasks.data.some(
      task =>
        ['copy', 'move', 'mkdir', 'recycle', 'delete', 'restore', 'purge', 'upload'].includes(task.kind) &&
        task.state === 'completed' &&
        previous.current !== null &&
        previous.current.get(task.id) !== 'completed',
    )
    previous.current = new Map(tasks.data.map(task => [task.id, task.state]))
    if (changed)
      for (const key of ['media', 'folders', 'libraries', 'trash', 'detail', 'neighbors'])
        void client.invalidateQueries({ queryKey: [key] })
  }, [client, tasks.data])
  const busy =
    !!starting ||
    !!tasks.data?.some(task =>
      ['queued', 'running', 'reserved', 'deleting', 'published', 'finalizing'].includes(task.state),
    )
  const attention = tasks.data?.some(task => task.state === 'needsAttention')
  useScanRefresh(libraryId)
  const icon = (
    <RefreshCw
      className={`size-6 ${attention ? 'text-danger' : busy ? 'text-accent' : ''} ${busy ? 'motion-safe:animate-spin' : ''}`}
      aria-hidden="true"
    />
  )
  return (
    <>
      <IconButton
        size={compact ? 'default' : 'large'}
        className={compact ? 'bg-canvas' : 'bg-canvas shadow-lg'}
        label={
          attention
            ? t('status:backgroundJobs.backgroundJobsNeedsAttention')
            : busy
              ? t('status:backgroundJobs.backgroundJobsRunning')
              : t('status:backgroundJobs.backgroundJobs')
        }
        onClick={() => setOpen(true)}
      >
        {icon}
      </IconButton>
      <BackgroundJobsDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

function useScanRefresh(libraryId?: number) {
  const client = useQueryClient()
  const status = useQuery({
    queryKey: ['indexing'],
    queryFn: ({ signal }) => request<IndexingStatus>('/api/indexing', signal),
    refetchInterval: 5000,
    enabled: !!libraryId,
  })
  const id = status.data?.libraries.find(item => item.id === libraryId)?.latestScanId
  const scan = useQuery({
    queryKey: ['scan', id],
    queryFn: ({ signal }) => request<Scan>(`/api/scans/${id}`, signal),
    enabled: !!id,
    gcTime: 0,
    refetchInterval: query => {
      const data = query.state.data
      return !data || data.state === 'queued' || data.state === 'running' || data.pending + data.processing > 0
        ? 3000
        : false
    },
  }).data
  const checkpoint = scanCheckpoint(scan)
  useEffect(() => {
    if (!checkpoint) return
    for (const key of ['media', 'folders', 'libraries']) void client.invalidateQueries({ queryKey: [key] })
  }, [client, checkpoint])
}
