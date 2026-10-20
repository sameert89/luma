import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Modal } from '../../components/ui/Modal'
import { Checkbox, Field, Input, QuietButton } from '../../components/ui/Controls'
import { request, errorMessage } from '../browse/api'
import type { components } from '../../lib/api/generated'

type Evidence = components['schemas']['FileRecoveryEvidence']
const labels: Record<string, string> = {
  retry: 'Retry from saved checkpoint',
  restart: 'Continue with this source',
  confirmPublished: 'Confirm destination and finish',
  cancel: 'Cancel untouched operation',
}
export function FileRecoveryDialog({
  id,
  onClose,
  onResolved,
}: {
  id: string
  onClose: () => void
  onResolved: () => void
}) {
  const reviewId = useId()
  const evidence = useQuery({
    queryKey: ['file-recovery', id],
    queryFn: ({ signal }) => request<Evidence>(`/api/files/operations/${id}/recovery`, signal),
    staleTime: 0,
  })
  const capabilities = useQuery({
    queryKey: ['file-capabilities'],
    queryFn: ({ signal }) => request<components['schemas']['FileCapabilities']>('/api/files/capabilities', signal),
  })
  const [confirmed, setConfirmed] = useState(false),
    [destination, setDestination] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const row = evidence.data?.operation
  const blocked = capabilities.data?.libraries?.some(item => item.libraryId === row?.libraryId && !item.writable)
  const alternative =
    row?.recoveryState === 'reserved' && ['copy', 'move', 'restore', 'upload'].includes(row.kind ?? '')
  const actions = [...(evidence.data?.actions ?? [])]
  if (alternative && destination.trim() && !actions.includes('retry')) actions.unshift('retry')
  async function resolve(action: string) {
    if (blocked) return
    setBusy(true)
    setError('')
    try {
      await request(`/api/files/operations/${id}/recover`, undefined, 'POST', {
        action,
        confirmed,
        expectedFailureCode: row?.failureCode ?? null,
        ...(action === 'retry' && destination.trim() ? { destination: destination.trim() } : {}),
      })
      onResolved()
      onClose()
    } catch (error) {
      setError(errorMessage(error))
      setConfirmed(false)
      void evidence.refetch()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      onOpenChange={open => {
        if (!open) onClose()
      }}
      title="Review file operation"
      description="Review the interrupted operation before continuing. Files are never overwritten during recovery."
      sheet
    >
      <div className="space-y-4 p-5">
        {evidence.isPending && <p role="status">Loading operation evidence…</p>}
        {evidence.isError && (
          <p role="alert" className="text-danger">
            {errorMessage(evidence.error)}
          </p>
        )}
        {evidence.data && row && (
          <>
            <p className="font-semibold">
              {row.kind} · {row.state}
            </p>
            <dl className="space-y-3 break-words text-sm">
              <div>
                <dt className="font-semibold">Source</dt>
                <dd>{row.source}</dd>
                <dd className="text-muted">
                  {evidence.data.sourceExists
                    ? evidence.data.sourceMatches
                      ? 'Present, matches recorded size, timestamp and type'
                      : 'Present, differs from the recorded source'
                    : 'Absent'}
                </dd>
              </div>
              <div>
                <dt className="font-semibold">Reserved content</dt>
                <dd>{evidence.data.stagingPath}</dd>
                <dd className="text-muted">{evidence.data.stagingExists ? 'Present' : 'Absent'}</dd>
              </div>
              {(row.destination || row.kind === 'mkdir') && (
                <div>
                  <dt className="font-semibold">Destination</dt>
                  <dd>{row.destination ?? row.source}</dd>
                  <dd className="text-muted">
                    {evidence.data.destinationExists
                      ? evidence.data.destinationMatches
                        ? 'Present, matches recorded evidence'
                        : 'Present, differs from recorded evidence'
                      : 'Absent'}
                  </dd>
                </div>
              )}
            </dl>
            <p className="text-sm text-muted">
              {row.failureCode}. Size and timestamps do not prove file contents. Confirm the intended source or
              destination before continuing.
            </p>
            {alternative && (
              <Field label="Alternative destination (optional)">
                <Input
                  value={destination}
                  onChange={event => {
                    setDestination(event.target.value)
                    setConfirmed(false)
                  }}
                  placeholder="Unused path relative to this library"
                />
              </Field>
            )}
            {!actions.length && (
              <p className="text-sm">
                Resolve the filesystem conflict, then reload the evidence to see available actions.
              </p>
            )}
            {actions.includes('restart') && (
              <p className="text-sm">Continuing renews the original {row.kind} request for the current source.</p>
            )}
            {actions.includes('confirmPublished') && (
              <p className="text-sm">
                Confirming the destination preserves it and finishes the library metadata update.
              </p>
            )}
            {!!actions.length && (
              <label htmlFor={reviewId} className="flex items-center gap-2 text-sm">
                <Checkbox
                  id={reviewId}
                  checked={confirmed}
                  disabled={busy}
                  onChange={event => setConfirmed(event.target.checked)}
                />
                I reviewed these paths and the recovery action.
              </label>
            )}
            {blocked && (
              <p role="status" className="text-sm text-muted">
                File changes disabled. Correct the media mount or permissions and use Check media mounts in Settings
                before recovery.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {actions.map(action => (
                <QuietButton key={action} disabled={!confirmed || busy || blocked} onClick={() => void resolve(action)}>
                  {labels[action] ?? action}
                </QuietButton>
              ))}
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <QuietButton
          disabled={busy}
          onClick={() => {
            setConfirmed(false)
            void evidence.refetch()
          }}
        >
          Reload evidence
        </QuietButton>
      </div>
    </Modal>
  )
}
