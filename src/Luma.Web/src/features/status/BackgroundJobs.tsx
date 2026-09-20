import { useIsMutating, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { IconButton } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { request, type IndexingStatus, type Scan } from '../browse/api'
import type { components } from '../../lib/api/generated'
import { TaskQueue } from './TaskQueue'

export function BackgroundJobsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Background jobs"
      description="Indexing, metadata imports and exports. Rescan a folder or library from its ⋯ menu."
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
export function BackgroundJobsButton({ libraryId }: { libraryId?: number }) {
  const [open, setOpen] = useState(false)
  const starting = useIsMutating({ predicate: mutation => mutation.options.mutationKey?.[0] === 'background-task' })
  const tasks = useQuery({
    queryKey: ['tasks'],
    queryFn: ({ signal }) => request<components['schemas']['BackgroundTask'][]>('/api/tasks', signal),
    refetchInterval: 3000,
  })
  const busy = !!starting || !!tasks.data?.some(task => task.state === 'queued' || task.state === 'running')
  useScanRefresh(libraryId)
  const icon = (
    <RefreshCw className={`size-6 ${busy ? 'text-accent motion-safe:animate-spin' : ''}`} aria-hidden="true" />
  )
  return (
    <>
      <IconButton
        size="large"
        className="bg-canvas shadow-lg"
        label={busy ? 'Background jobs, running' : 'Background jobs'}
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
  useEffect(() => {
    if (!scan) return
    for (const key of ['media', 'folders', 'libraries']) void client.invalidateQueries({ queryKey: [key] })
  }, [client, scan?.id, scan?.state, scan?.ready, scan?.discovered])
}
