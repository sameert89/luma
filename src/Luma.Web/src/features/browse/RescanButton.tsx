import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { IconButton, QuietButton } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { errorMessage, request, type IndexingStatus, type Scan } from './api'

export function RescanButton({ libraryId, name = 'library' }: { libraryId: number; name?: string }) {
  const [open, setOpen] = useState(false)
  const client = useQueryClient()
  const status = useQuery({ queryKey: ['indexing'], queryFn: ({ signal }) => request<IndexingStatus>('/api/indexing', signal), refetchInterval: 5000 })
  const id = status.data?.libraries.find(item => item.id === libraryId)?.latestScanId
  const progress = useQuery({ queryKey: ['scan', id], queryFn: ({ signal }) => request<Scan>(`/api/scans/${id}`, signal), enabled: !!id, refetchInterval: 3000, gcTime: 0 })
  const scan = progress.data
  const running = scan?.state === 'queued' || scan?.state === 'running'
  const preparing = scan?.state === 'completed' && scan.pending + scan.processing > 0
  const action = useMutation({ mutationFn: (cancel: boolean) => request(cancel ? `/api/scans/${id}/cancel` : `/api/libraries/${libraryId}/scans`, undefined, 'POST', cancel ? undefined : {}), onSuccess: async () => {
    await client.invalidateQueries({ queryKey: ['indexing'] })
    await client.invalidateQueries({ queryKey: ['scan'] })
    await client.invalidateQueries({ queryKey: ['libraries'] })
    setOpen(false)
  } })
  const busy = running || preparing || action.isPending
  useEffect(() => {
    if (scan) {
      void client.invalidateQueries({ queryKey: ['media'] })
      void client.invalidateQueries({ queryKey: ['folders'] })
      void client.invalidateQueries({ queryKey: ['libraries'] })
    }
  }, [client, scan?.id, scan?.state, scan?.ready, scan?.discovered])
  return <>
    <IconButton label={busy ? `View scan progress for ${name}` : `Rescan ${name}`} onClick={() => { setOpen(true); void status.refetch() }}><RefreshCw className={`size-4 ${busy ? 'motion-safe:animate-spin' : ''}`} /></IconButton>
    <Modal open={open} onOpenChange={setOpen} title={busy ? 'Library scan progress' : `Rescan ${name}?`} description="Review the scan before starting it." sheet>
      <div className="space-y-4 overflow-auto p-5">
        {busy ? <div role="status"><p className="font-medium">{running ? 'Checking folders for changes' : 'Preparing media previews'}</p><p className="mt-2 text-sm text-muted">{scan?.discovered.toLocaleString() ?? 0} files found · {scan?.ready.toLocaleString() ?? 0} previews prepared</p><p className="mt-2 text-sm text-muted">You can keep browsing while this runs.</p></div> : <p className="text-sm leading-relaxed text-muted">Rescanning checks every folder in this library for new, changed or removed media. On a large library this can take a long time and use significant disk and CPU resources. Start a rescan now?</p>}
        <div className="flex gap-3">{busy ? <Button disabled={action.isPending} onClick={() => action.mutate(true)}>{action.isPending && action.variables ? 'Cancelling…' : 'Cancel scan'}</Button> : <Button disabled={action.isPending || status.isFetching || status.isPending || !!id && progress.isPending} onClick={() => action.mutate(false)}>Start rescan</Button>}<QuietButton onClick={() => setOpen(false)}>{busy ? 'Keep browsing' : 'Not now'}</QuietButton></div>
        {action.isError && <p role="alert" className="text-sm text-danger">{errorMessage(action.error)}</p>}
      </div>
    </Modal>
  </>
}
