import { useRef, useSyncExternalStore } from 'react'
import { QuietButton } from '../../components/ui/Controls'
import { t } from '../../lib/i18n'
import { resumeUpload, uploadAction, subscribeUploads, uploadSelectionBlocked, type QueuedUpload } from './uploadQueue'

export function ResumeUploadButton({ item, onError }: { item: QueuedUpload; onError: (message: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const needsFile = !item.file
  const blocked = useSyncExternalStore(subscribeUploads, uploadSelectionBlocked) && needsFile
  return (
    <>
      <QuietButton
        disabled={blocked}
        title={blocked ? t('uploads:uploadPicker.finishCurrentBatch') : undefined}
        onClick={() => {
          if (needsFile) {
            if (uploadSelectionBlocked() || !input.current) return
            input.current.value = ''
            input.current.click()
          } else void uploadAction(item.key, 'resume').catch(error => onError(String(error)))
        }}
      >
        {t(needsFile ? 'uploads:uploadPicker.reselectFile' : 'uploads:uploadPicker.resumeRetry')}
      </QuietButton>
      <input
        ref={input}
        type="file"
        disabled={blocked}
        className="hidden"
        aria-label={t('uploads:uploadPicker.reselectUpload', { name: item.target })}
        onChange={event => {
          const file = event.target.files?.[0]
          if (!file) return
          void resumeUpload(item.key, file)
            .then(() => onError(''))
            .catch(error => onError(String(error)))
        }}
      />
    </>
  )
}
