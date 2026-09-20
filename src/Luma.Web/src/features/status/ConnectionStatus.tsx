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
        Connection
      </h2>
      <p role="status" className="mt-2 text-sm text-muted">
        {query.isPending
          ? 'Connecting to Luma…'
          : query.isError
            ? 'Luma is unavailable. Check that the server is running.'
            : 'Luma is connected and ready.'}
      </p>
      {query.isError && (
        <Button className="mt-4" disabled={query.isFetching} onClick={() => void query.refetch()}>
          Try again
        </Button>
      )}
    </section>
  )
}
