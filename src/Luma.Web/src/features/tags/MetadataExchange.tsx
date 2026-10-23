import { t, stateLabel } from '../../lib/i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useState } from 'react'
import { Checkbox, QuietButton, QuietLink } from '../../components/ui/Controls'
import { errorMessage, request, type Filters } from '../browse/api'
import type { components } from '../../lib/api/generated'

export function MetadataExchange({
  mediaIds,
  filters,
  dislikes = false,
  imports = true,
  exports = true,
  heading = true,
}: {
  mediaIds?: number[]
  filters?: Filters
  dislikes?: boolean
  imports?: boolean
  exports?: boolean
  heading?: boolean
}) {
  const [jobId, setJobId] = useState<number>()
  const [afterMediaId, setAfterMediaId] = useState<number>()
  const [resultPages, setResultPages] = useState<(number | undefined)[]>([])
  const [sidecars, setSidecars] = useState(false)
  const sidecarsId = useId()
  const client = useQueryClient()
  const start = useMutation({
    mutationKey: ['background-task'],
    mutationFn: (kind: 'tags' | 'xmp' | 'dislikes') =>
      request<components['schemas']['JobAccepted']>(
        `/api/${kind === 'tags' ? 'imports' : 'exports'}/${kind}`,
        undefined,
        'POST',
        { mediaIds, query: filters, includeSidecars: sidecars },
      ),
    onSuccess: result => {
      setJobId(result.id)
      setAfterMediaId(undefined)
      setResultPages([])
      void client.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
  const job = useQuery({
    queryKey: ['metadata-job', jobId, afterMediaId],
    queryFn: ({ signal }) =>
      request<components['schemas']['MetadataJobStatus']>(
        `/api/jobs/${jobId}${afterMediaId ? `?afterMediaId=${afterMediaId}` : ''}`,
        signal,
      ),
    enabled: !!jobId,
    gcTime: 0,
    placeholderData: previous => (previous?.id === jobId ? previous : undefined),
    refetchInterval: query => (['queued', 'running'].includes(query.state.data?.state ?? 'queued') ? 1000 : false),
  })
  const busy = start.isPending || ['queued', 'running'].includes(job.data?.state ?? '')
  const complete = job.data?.state === 'completed'
  const canImport = imports && (!!mediaIds || !!filters?.folderId)
  useEffect(() => {
    if (complete && job.data?.kind === 'import') {
      for (const queryKey of [['detail'], ['media'], ['tags'], ['collection-tags']])
        void client.invalidateQueries({ queryKey })
    }
  }, [complete, job.data?.kind, client])
  return (
    <section aria-label={t('tags:metadataExchange.metadataExchange')} className="space-y-3">
      {heading && <h2 className="text-sm font-semibold">{t('tags:metadataExchange.metadataExchange')}</h2>}
      <p className="text-sm text-muted">
        {canImport ? t('tags:metadataExchange.importsMergeEXIFXMPTagsIntoLuma') : ''}
        {exports
          ? t('tags:metadataExchange.exportsAreDownloadsOriginalsStayUnchanged')
          : t('tags:metadataExchange.originalsStayUnchanged')}
      </p>
      {canImport && (
        <label htmlFor={sidecarsId} className="flex min-h-11 items-center gap-3 text-sm">
          <Checkbox
            id={sidecarsId}
            checked={sidecars}
            disabled={busy}
            onChange={event => setSidecars(event.target.checked)}
          />
          {t('tags:metadataExchange.includeAdjacentXMPSidecars')}
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        {canImport && (
          <QuietButton disabled={busy} onClick={() => start.mutate('tags')}>
            {mediaIds
              ? t('tags:metadataExchange.importMetadataTags')
              : t('tags:metadataExchange.importFolderMetadataTags')}
          </QuietButton>
        )}
        {exports && (
          <QuietButton disabled={busy} onClick={() => start.mutate('xmp')}>
            {t('tags:metadataExchange.exportXMP')}
          </QuietButton>
        )}
        {dislikes && (
          <QuietButton disabled={busy} onClick={() => start.mutate('dislikes')}>
            {t('tags:metadataExchange.exportDislikedPaths')}
          </QuietButton>
        )}
      </div>
      {job.data && (
        <p role="status" className="text-sm">
          {t('tags:metadataExchange.processedWithMetadataImportedUpdatedSkippedFailed', {
            state: stateLabel(job.data.state),
            processed: job.data.processed,
            found: job.data.found ?? 0,
            updated: job.data.updated ?? 0,
            skipped: job.data.skipped ?? 0,
            failed: job.data.failed,
            failure: job.data.failureCode && ` ${job.data.failureCode}`,
          })}
        </p>
      )}
      {job.data?.items
        .filter(item => item.code !== 'imported')
        .map(item => (
          <p key={item.mediaId} className="text-sm text-muted">
            {t('tags:metadataExchange.item', { id: item.mediaId, code: item.code })}
          </p>
        ))}
      {(afterMediaId || job.data?.nextMediaId) && (
        <div className="flex flex-wrap gap-2">
          {afterMediaId && (
            <QuietButton
              disabled={job.isFetching}
              onClick={() => {
                setAfterMediaId(resultPages.at(-1))
                setResultPages(pages => pages.slice(0, -1))
              }}
            >
              {t('tags:metadataExchange.previousItemResults')}
            </QuietButton>
          )}
          {job.data?.nextMediaId && (
            <QuietButton
              disabled={job.isFetching}
              onClick={() => {
                setResultPages(pages => [...pages, afterMediaId])
                setAfterMediaId(job.data!.nextMediaId!)
              }}
            >
              {t('tags:metadataExchange.nextItemResults')}
            </QuietButton>
          )}
        </div>
      )}
      {job.data?.contentUrl && (
        <QuietLink href={job.data.contentUrl}>{t('tags:metadataExchange.downloadExport')}</QuietLink>
      )}
      {(start.isError || job.isError) && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(start.error ?? job.error)}
        </p>
      )}
    </section>
  )
}
