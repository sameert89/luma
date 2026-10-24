import { useRef } from 'react'
import { QuietButton } from '../../components/ui/Controls'
import { t } from '../../lib/i18n'
import { resumeUpload, uploadAction, type QueuedUpload } from './uploadQueue'

export function ResumeUploadButton({ item, onError }: { item: QueuedUpload; onError: (message: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const needsFile = !item.file
  return (
    <>
      <QuietButton
        onClick={() => {
          if (needsFile) input.current?.click()
          else void uploadAction(item.key, 'resume').catch(error => onError(String(error)))
        }}
      >
        {t(needsFile ? 'uploads:uploadPicker.reselectFile' : 'uploads:uploadPicker.resumeRetry')}
      </QuietButton>
      <input
        ref={input}
        type="file"
        className="hidden"
        aria-label={t('uploads:uploadPicker.reselectUpload', { name: item.target })}
        onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          try {
            resumeUpload(item.key, file)
            onError('')
          } catch (error) {
            onError(String(error))
          }
        }}
      />
    </>
  )
}
