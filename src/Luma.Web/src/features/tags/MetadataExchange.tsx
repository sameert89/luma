import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useState } from 'react'
import { Checkbox, QuietButton, QuietLink } from '../../components/ui/Controls'
import { errorMessage, request, type Filters } from '../browse/api'
import type { components } from '../../lib/api/generated'

export function MetadataExchange({ mediaIds, filters, dislikes = false }: { mediaIds?: number[]; filters?: Filters; dislikes?: boolean }) {
  const [jobId, setJobId] = useState<number>()
  const [afterMediaId, setAfterMediaId] = useState<number>()
  const [sidecars, setSidecars] = useState(false)
  const sidecarsId = useId()
  const client = useQueryClient()
  const start = useMutation({ mutationFn: (kind: 'tags' | 'xmp' | 'dislikes') => request<components['schemas']['JobAccepted']>(`/api/${kind === 'tags' ? 'imports' : 'exports'}/${kind}`, undefined, 'POST', { mediaIds, query: filters, includeSidecars: sidecars }), onSuccess: result => { setJobId(result.id); setAfterMediaId(undefined) } })
  const job = useQuery({ queryKey: ['metadata-job', jobId, afterMediaId], queryFn: ({ signal }) => request<components['schemas']['MetadataJobStatus']>(`/api/jobs/${jobId}${afterMediaId ? `?afterMediaId=${afterMediaId}` : ''}`, signal), enabled: !!jobId, gcTime: 0, placeholderData: previous => previous?.id === jobId ? previous : undefined, refetchInterval: query => ['queued', 'running'].includes(query.state.data?.state ?? 'queued') ? 1000 : false })
  const busy = start.isPending || ['queued', 'running'].includes(job.data?.state ?? '')
  const complete = job.data?.state === 'completed'
  useEffect(() => { if (complete && job.data?.kind === 'import') { for (const queryKey of [['detail'], ['media'], ['tags'], ['collection-tags']]) void client.invalidateQueries({ queryKey }) } }, [complete, job.data?.kind, client])
  return <section aria-label="Metadata exchange" className="space-y-3">
    <h2 className="text-sm font-semibold">Metadata exchange</h2><p className="text-sm text-muted">Imports merge tags into Luma. Exports are downloads; originals stay unchanged.</p>
    {mediaIds && <label htmlFor={sidecarsId} className="flex min-h-11 items-center gap-3 text-sm"><Checkbox id={sidecarsId} checked={sidecars} onChange={event => setSidecars(event.target.checked)} />Include adjacent XMP sidecars</label>}
    <div className="flex flex-wrap gap-2">{mediaIds && <QuietButton disabled={busy} onClick={() => start.mutate('tags')}>Import metadata tags</QuietButton>}<QuietButton disabled={busy} onClick={() => start.mutate('xmp')}>Export XMP</QuietButton>{dislikes && <QuietButton disabled={busy} onClick={() => start.mutate('dislikes')}>Export disliked paths</QuietButton>}</div>
    {job.data && <p role="status" className="text-sm">{job.data.state}: {job.data.processed} processed, {job.data.failed} with findings.{job.data.failureCode && ` ${job.data.failureCode}`}</p>}
    {job.data?.items.filter(item => item.code !== 'imported').map(item => <p key={item.mediaId} className="text-sm text-muted">Item {item.mediaId}: {item.code}</p>)}
    {(afterMediaId || job.data?.nextMediaId) && <div className="flex flex-wrap gap-2">{afterMediaId && <QuietButton disabled={job.isFetching} onClick={() => setAfterMediaId(undefined)}>First item results</QuietButton>}{job.data?.nextMediaId && <QuietButton disabled={job.isFetching} onClick={() => setAfterMediaId(job.data!.nextMediaId!)}>Next item results</QuietButton>}</div>}
    {job.data?.contentUrl && <QuietLink href={job.data.contentUrl}>Download export</QuietLink>}
    {(start.isError || job.isError) && <p role="alert" className="text-sm text-danger">{errorMessage(start.error ?? job.error)}</p>}
  </section>
}
