import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Square } from 'lucide-react'
import { RescanButton } from './RescanButton'
import { QuietButton } from '../../components/ui/Controls'
import { errorMessage, request, type IndexingStatus, type Scan } from './api'

export function ScanControls({ libraryId }: { libraryId: number }) {
  const client = useQueryClient()
  const status = useQuery({ queryKey: ['indexing'], queryFn: ({ signal }) => request<IndexingStatus>('/api/indexing', signal), refetchInterval: 5000 })
  const id = status.data?.libraries.find(x => x.id === libraryId)?.latestScanId
  const progress = useQuery({ queryKey: ['scan', id], queryFn: ({ signal }) => request<Scan>(`/api/scans/${id}`, signal), enabled: !!id, refetchInterval: 3000, gcTime: 0 })
  const scan = progress.data
  const running = scan?.state === 'running' || scan?.state === 'queued'
  const action = useMutation({ mutationKey: ['background-task'], mutationFn: (cancel: boolean) => request(cancel ? `/api/scans/${id}/cancel` : `/api/libraries/${libraryId}/scans`, undefined, 'POST', cancel ? undefined : {}), onSuccess: async () => { await Promise.all([client.invalidateQueries({ queryKey: ['tasks'] }), client.invalidateQueries({ queryKey: ['indexing'] }), client.invalidateQueries({ queryKey: ['scan'] })]) } })
  useEffect(() => {
    if (scan) {
      void client.invalidateQueries({ queryKey: ['media'] })
      void client.invalidateQueries({ queryKey: ['folders'] })
      void client.invalidateQueries({ queryKey: ['libraries'] })
    }
  }, [client, scan?.id, scan?.state, scan?.ready, scan?.discovered])
  return <section className="space-y-3 py-4" aria-label="Library indexing">
    {scan && <div role="status" className="space-y-2 text-sm"><p className="font-medium">{running ? 'Finding photos and videos…' : scan.state === 'completed' ? 'All folders checked' : `Scan ${scan.state}`} <span className="text-muted">· {scan.discovered.toLocaleString()} files found</span></p><p className="text-muted">{scan.ready.toLocaleString()} previews prepared{scan.pending + scan.processing > 0 ? ` · ${(scan.pending + scan.processing).toLocaleString()} waiting` : ''}{scan.failed > 0 ? ` · ${scan.failed.toLocaleString()} failed` : ''}</p>{running && <p className="text-xs text-muted">Folders fill as they are discovered. Previews are prepared separately; you can browse while this runs.</p>}</div>}
    <details><summary className="cursor-pointer text-xs text-muted">Scan controls</summary><div className="mt-3 flex flex-wrap gap-2"><RescanButton libraryId={libraryId} />
    {(running || (scan?.state === 'completed' && scan.pending + scan.processing > 0)) && <QuietButton disabled={action.isPending} onClick={() => action.mutate(true)}><Square className="size-3" />{action.isPending ? 'Cancelling…' : 'Cancel scan'}</QuietButton>}</div><p className="mt-2 text-xs text-muted">Cancelling keeps prepared previews and tags. Start another scan to resume remaining work.</p></details>
    {status.data?.cachePressure && <p className="text-xs text-danger">Cache storage is full. Generation is paused.</p>}
    {scan?.failureCode && <p className="text-xs text-danger">{scan.failureCode.replaceAll('_', ' ')}</p>}
    {action.isError && <p role="alert" className="text-xs text-danger">{errorMessage(action.error)}</p>}
  </section>
}
