import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { ApiError } from '../../lib/api/client'
import { request, type Scan } from './api'
import type { operations } from '../../lib/api/generated'

type Accepted = operations['IndexFolder']['responses'][202]['content']['application/json']

export function useFolderIndexing(folderId?: number) {
  const client = useQueryClient()
  const start = useQuery({ queryKey: ['folder-indexing', folderId], enabled: !!folderId, gcTime: 0,
    queryFn: async ({ signal }) => await request<Accepted | undefined>(`/api/folders/${folderId}/index`, signal, 'POST') ?? null,
    retry: (count, error) => (error instanceof ApiError && error.status === 409) || count < 2,
    retryDelay: 3000, refetchOnWindowFocus: false })
  const scan = useQuery({ queryKey: ['scan', start.data?.id], enabled: !!start.data?.id, gcTime: 0,
    queryFn: ({ signal }) => request<Scan>(`/api/scans/${start.data!.id}`, signal),
    refetchInterval: query => !query.state.data || ['queued', 'running'].includes(query.state.data.state) || query.state.data.state === 'completed' && query.state.data.pending + query.state.data.processing > 0 ? 3000 : false })
  useEffect(() => {
    if (!scan.data) return
    void client.invalidateQueries({ queryKey: ['media'] })
    void client.invalidateQueries({ queryKey: ['folders'] })
    void client.invalidateQueries({ queryKey: ['libraries'] })
    void client.invalidateQueries({ queryKey: ['indexing'] })
  }, [client, scan.data?.id, scan.data?.state, scan.data?.discovered, scan.data?.ready])
  return { waiting: start.isPending && !!folderId || scan.data?.state === 'queued' || scan.data?.state === 'running', error: start.error ?? (scan.data?.state === 'failed' ? new Error('This folder could not be indexed. Check that its media source is available.') : scan.error) }
}
