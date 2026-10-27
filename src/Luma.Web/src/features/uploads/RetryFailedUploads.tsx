import { useState, useSyncExternalStore } from 'react'
import { QuietButton } from '../../components/ui/Controls'
import { t } from '../../lib/i18n'
import { retryFailedUploads, subscribeUploads, uploadSnapshot } from './uploadQueue'

export function RetryFailedUploads() {
  const uploads = useSyncExternalStore(subscribeUploads, uploadSnapshot)
  const [needsFiles, setNeedsFiles] = useState(false)
  const failed = uploads.some(item => item.state === 'failed')
  const reselect = needsFiles && uploads.some(item => item.state === 'reselect')
  if (!failed && !reselect) return null
  return (
    <div className="space-y-2">
      {failed && (
        <QuietButton onClick={() => setNeedsFiles(retryFailedUploads() > 0)}>
          {t('uploads:uploadPicker.retryFailed')}
        </QuietButton>
      )}
      {reselect && (
        <p role="status" className="text-sm text-muted">
          {t('uploads:uploadPicker.reselectFailed')}
        </p>
      )}
    </div>
  )
}
