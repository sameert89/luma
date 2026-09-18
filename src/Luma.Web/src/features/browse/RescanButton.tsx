import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from '../../lib/api/generated'
import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { TaskQueue } from '../status/TaskQueue'
import { Button } from '../../components/ui/Button'
import { Field, Select, IconButton, QuietButton } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { errorMessage, request, type IndexingStatus, type Scan } from './api'

// `open`/`onOpenChange` let another control (Refresh collection) open the same confirmation;
// `showTrigger={false}` renders only that confirmation.
export function RescanButton({ libraryId, name = 'library', open: controlledOpen, onOpenChange, showTrigger = true }: { libraryId: number; name?: string; open?: boolean; onOpenChange?: (open: boolean) => void; showTrigger?: boolean }) {
  const [metadataMode, setMetadataMode] = useState('embedded')
  const [localOpen, setLocalOpen] = useState(false)
  const open = controlledOpen ?? localOpen
  const setOpen = onOpenChange ?? setLocalOpen
  const client = useQueryClient()
  const status = useQuery({ queryKey: ['indexing'], queryFn: ({ signal }) => request<IndexingStatus>('/api/indexing', signal), refetchInterval: 5000 })
  const id = status.data?.libraries.find(item => item.id === libraryId)?.latestScanId
  const progress = useQuery({ queryKey: ['scan', id], queryFn: ({ signal }) => request<Scan>(`/api/scans/${id}`, signal), enabled: !!id, refetchInterval: 3000, gcTime: 0 })
  const scan = progress.data
  const running = scan?.state === 'queued' || scan?.state === 'running'
  const preparing = scan?.state === 'completed' && scan.pending + scan.processing > 0
  const starting = useIsMutating({ predicate: mutation => mutation.options.mutationKey?.[0] === 'background-task' })
  const action = useMutation({ mutationKey: ['background-task'], mutationFn: () => request(`/api/libraries/${libraryId}/scans`, undefined, 'POST', { metadataMode }), onSuccess: async () => {
    await client.invalidateQueries({ queryKey: ['tasks'] }); await client.invalidateQueries({ queryKey: ['indexing'] })
    await client.invalidateQueries({ queryKey: ['scan'] })
    await client.invalidateQueries({ queryKey: ['libraries'] })
    setOpen(false)
  } })
  const queue = useQuery({ queryKey: ['tasks'], queryFn: ({ signal }) => request<components['schemas']['BackgroundTask'][]>('/api/tasks', signal), refetchInterval: 3000 })
  useEffect(() => { if (controlledOpen) { void status.refetch(); void queue.refetch() } }, [controlledOpen])
  const busy = running || preparing || action.isPending
  const queueBusy = queue.data?.some(task => ['queued', 'running'].includes(task.state))
  useEffect(() => {
    if (scan) {
      void client.invalidateQueries({ queryKey: ['media'] })
      void client.invalidateQueries({ queryKey: ['folders'] })
      void client.invalidateQueries({ queryKey: ['libraries'] })
    }
  }, [client, scan?.id, scan?.state, scan?.ready, scan?.discovered])
  return <>
    {showTrigger && <IconButton label={busy ? `View scan progress for ${name}` : `Rescan ${name}`} onClick={() => { setOpen(true); void status.refetch(); void queue.refetch() }}><RefreshCw className={`size-4 ${busy || queueBusy || starting ? 'motion-safe:animate-spin' : ''}`} /></IconButton>}
    <Modal open={open} onOpenChange={setOpen} title="Background tasks" description="Review the scan before starting it." sheet>
      <div className="space-y-4 overflow-auto p-5"><TaskQueue />
        {busy ? <div role="status"><p className="font-medium">{running ? 'Checking folders for changes' : 'Preparing media previews'}</p><p className="mt-2 text-sm text-muted">{scan?.discovered.toLocaleString() ?? 0} files found · {scan?.ready.toLocaleString() ?? 0} previews prepared</p><p className="mt-2 text-sm text-muted">You can keep browsing while this runs.</p></div> : <p className="text-sm leading-relaxed text-muted">Rescanning checks every folder in this library for new, changed or removed media. On a large library this can take a long time and use significant disk and CPU resources. Start a rescan now?</p>}
        {!busy && <Field label="Metadata during indexing"><Select value={metadataMode} onChange={event => setMetadataMode(event.target.value)}><option value="none">Index only</option><option value="embedded">Index + embedded metadata</option><option value="xmp">Index + embedded metadata + XMP</option></Select></Field>}
        <div className="flex gap-3">{busy ? null : <Button disabled={action.isPending || status.isFetching || status.isPending || !!id && progress.isPending} onClick={() => action.mutate()}>Start rescan</Button>}<QuietButton onClick={() => setOpen(false)}>{busy ? 'Keep browsing' : 'Not now'}</QuietButton></div>
        {action.isError && <p role="alert" className="text-sm text-danger">{errorMessage(action.error)}</p>}
      </div>
    </Modal>
  </>
}
