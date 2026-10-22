import { t } from '../../lib/i18n'
import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Modal } from '../../components/ui/Modal'
import { Checkbox, Field, Input, QuietButton } from '../../components/ui/Controls'
import { request, errorMessage } from '../browse/api'
import type { components } from '../../lib/api/generated'

type Evidence = components['schemas']['FileRecoveryEvidence']
const labels: Record<string, string> = {
  retry: t('files:fileRecoveryDialog.retryFromSavedCheckpoint'),
  restart: t('files:fileRecoveryDialog.continueWithThisSource'),
  confirmPublished: t('files:fileRecoveryDialog.confirmDestinationAndFinish'),
  cancel: t('files:fileRecoveryDialog.cancelUntouchedOperation'),
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
      title={t('files:fileRecoveryDialog.reviewFileOperation')}
      description={t('files:fileRecoveryDialog.reviewTheInterruptedOperationBeforeContinuingFilesAreNever')}
      sheet
    >
      <div className="space-y-4 p-5">
        {evidence.isPending && <p role="status">{t('files:fileRecoveryDialog.loadingOperationEvidence')}</p>}
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
                <dt className="font-semibold">{t('files:fileRecoveryDialog.source')}</dt>
                <dd>{row.source}</dd>
                <dd className="text-muted">
                  {evidence.data.sourceExists
                    ? evidence.data.sourceMatches
                      ? t('files:fileRecoveryDialog.presentMatchesRecordedSizeTimestampAndType')
                      : t('files:fileRecoveryDialog.presentDiffersFromTheRecordedSource')
                    : t('files:fileRecoveryDialog.absent')}
                </dd>
              </div>
              <div>
                <dt className="font-semibold">{t('files:fileRecoveryDialog.reservedContent')}</dt>
                <dd>{evidence.data.stagingPath}</dd>
                <dd className="text-muted">
                  {evidence.data.stagingExists
                    ? t('files:fileRecoveryDialog.present')
                    : t('files:fileRecoveryDialog.absent')}
                </dd>
              </div>
              {(row.destination || row.kind === 'mkdir') && (
                <div>
                  <dt className="font-semibold">{t('files:fileRecoveryDialog.destination')}</dt>
                  <dd>{row.destination ?? row.source}</dd>
                  <dd className="text-muted">
                    {evidence.data.destinationExists
                      ? evidence.data.destinationMatches
                        ? t('files:fileRecoveryDialog.presentMatchesRecordedEvidence')
                        : t('files:fileRecoveryDialog.presentDiffersFromRecordedEvidence')
                      : t('files:fileRecoveryDialog.absent')}
                  </dd>
                </div>
              )}
            </dl>
            <p className="text-sm text-muted">
              {t('files:fileRecoveryDialog.sizeAndTimestampsDoNotProveFileContentsConfirm', {
                rowFailureCode: row.failureCode,
              })}
            </p>
            {alternative && (
              <Field label={t('files:fileRecoveryDialog.alternativeDestinationOptional')}>
                <Input
                  value={destination}
                  onChange={event => {
                    setDestination(event.target.value)
                    setConfirmed(false)
                  }}
                  placeholder={t('files:fileRecoveryDialog.unusedPathRelativeToThisLibrary')}
                />
              </Field>
            )}
            {!actions.length && (
              <p className="text-sm">
                {t('files:fileRecoveryDialog.resolveTheFilesystemConflictThenReloadTheEvidenceTo')}
              </p>
            )}
            {actions.includes('restart') && (
              <p className="text-sm">
                {t('files:fileRecoveryDialog.continuingRenewsTheOriginalRequestForTheCurrentSource', {
                  rowKind: row.kind,
                })}
              </p>
            )}
            {actions.includes('confirmPublished') && (
              <p className="text-sm">
                {t('files:fileRecoveryDialog.confirmingTheDestinationPreservesItAndFinishesTheLibrary')}
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
                {t('files:fileRecoveryDialog.iReviewedThesePathsAndTheRecoveryAction')}
              </label>
            )}
            {blocked && (
              <p role="status" className="text-sm text-muted">
                {t('files:fileRecoveryDialog.fileChangesDisabledCorrectTheMediaMountOrPermissions')}
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
          {t('files:fileRecoveryDialog.reloadEvidence')}
        </QuietButton>
      </div>
    </Modal>
  )
}
