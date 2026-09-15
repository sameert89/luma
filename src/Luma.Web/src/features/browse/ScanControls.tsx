import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { RefreshCw, Square } from 'lucide-react'
import { QuietButton } from '../../components/ui/Controls'
import { errorMessage, request, type IndexingStatus, type Scan } from './api'

export function ScanControls({ libraryId }: { libraryId: number }) {
  const client = useQueryClient()
  const status = useQuery({ queryKey: ['indexing'], queryFn: ({ signal }) => request<IndexingStatus>('/api/indexing', signal), refetchInterval: 5000 })
  const id = status.data?.libraries.find(x => x.id === libraryId)?.latestScanId
  const progress = useQuery({ queryKey: ['scan', id], queryFn: ({ signal }) => request<Scan>(`/api/scans/${id}`, signal), enabled: !!id, refetchInterval: 3000, gcTime: 0 })
  const scan = progress.data
  const running = scan?.state === 'running' || scan?.state === 'queued'
  const action = useMutation({ mutationFn: (cancel: boolean) => request(cancel ? `/api/scans/${id}/cancel` : `/api/libraries/${libraryId}/scans`, undefined, 'POST', cancel ? undefined : {}), onSuccess: () => client.invalidateQueries({ queryKey: ['indexing'] }) })
  useEffect(() => {
    if (scan) {
      void client.invalidateQueries({ queryKey: ['media'] })
      void client.invalidateQueries({ queryKey: ['folders'] })
      void client.invalidateQueries({ queryKey: ['libraries'] })
    }
  }, [client, scan?.id, scan?.state, scan?.ready]) // Refresh as durable indexing advances, not on every status poll.
  return <section className="space-y-3 border-t border-line pt-4" aria-label="Library indexing">
    <p className="text-xs font-semibold uppercase tracking-wider text-muted">Indexing</p>
    <QuietButton className="w-full" disabled={action.isPending || running} onClick={() => action.mutate(false)}><RefreshCw className="size-4" />Scan library</QuietButton>
    {scan && <p role="status" className="text-xs leading-relaxed text-muted">{running ? 'Scanning' : scan.state === 'completed' ? 'Scan complete' : scan.state} · {scan.discovered} found · {scan.ready} ready{scan.failed > 0 ? ` · ${scan.failed} failed` : ''}</p>}
    {(running || (scan && scan.pending + scan.processing > 0)) && <QuietButton className="w-full" disabled={action.isPending} onClick={() => action.mutate(true)}><Square className="size-3" />Cancel scan</QuietButton>}
    {status.data?.cachePressure && <p className="text-xs text-danger">Cache storage is full. Generation is paused.</p>}
    {scan?.failureCode && <p className="text-xs text-danger">{scan.failureCode.replaceAll('_', ' ')}</p>}
    {action.isError && <p role="alert" className="text-xs text-danger">{errorMessage(action.error)}</p>}
  </section>
}
