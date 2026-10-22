import { t } from '../../lib/i18n'
import { useQuery } from '@tanstack/react-query'
import { Button } from '../../components/ui/Button'
import { getStatus } from '../../lib/api/client'

export function ConnectionStatus() {
  const query = useQuery({
    queryKey: ['status'],
    queryFn: ({ signal }) => getStatus(signal),
    staleTime: 30_000,
    retry: false,
  })
  return (
    <section aria-labelledby="connection-heading" className="rounded-lg border border-line bg-surface p-5">
      <h2 id="connection-heading" className="text-sm font-semibold">
        {t('status:connectionStatus.connection')}
      </h2>
      <p role="status" className="mt-2 text-sm text-muted">
        {query.isPending
          ? t('status:connectionStatus.connectingToLuma')
          : query.isError
            ? t('status:connectionStatus.lumaIsUnavailableCheckThatTheServerIsRunning')
            : t('status:connectionStatus.lumaIsConnectedAndReady')}
      </p>
      {query.isError && (
        <Button className="mt-4" disabled={query.isFetching} onClick={() => void query.refetch()}>
          {t('status:connectionStatus.tryAgain')}
        </Button>
      )}
    </section>
  )
}
