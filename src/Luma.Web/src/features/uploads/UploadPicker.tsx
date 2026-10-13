import { useId, useState, useSyncExternalStore } from 'react'
import { QuietButton, Input } from '../../components/ui/Controls'
import { addUploads, subscribeUploads, uploadSnapshot, uploadAction } from './uploadQueue'
export function UploadPicker({ libraryId, destination }: { libraryId: number; destination: string }) {
  const fileId = useId()
  const [error, setError] = useState('')
  const queue = useSyncExternalStore(subscribeUploads, uploadSnapshot)
  async function choose(files: File[]) {
    setError('')
    try {
      await addUploads(files, libraryId, destination)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not start upload.')
    }
  }
  return (
    <section
      aria-label="Upload files"
      className="space-y-3 border-t border-line pt-4"
      onDragOver={event => event.preventDefault()}
      onDrop={event => {
        event.preventDefault()
        void choose([...event.dataTransfer.files])
      }}
    >
      <h2 className="font-semibold">Upload into {destination || '/'}</h2>
      <p className="text-sm text-muted">
        Choose or drop files. After refresh, unlock file management and reselect the same files or folder to resume.
      </p>
      <label htmlFor={fileId} className="block text-sm">
        Files
        <Input
          id={fileId}
          type="file"
          multiple
          onChange={event => {
            if (event.target.files) void choose([...event.target.files])
            event.target.value = ''
          }}
        />
      </label>
      <label className="block text-sm">
        Folder
        <input
          className="block min-h-11 w-full text-sm"
          type="file"
          multiple
          {...{ webkitdirectory: '' }}
          onChange={event => {
            if (event.target.files) void choose([...event.target.files])
            event.target.value = ''
          }}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <p className="text-sm text-muted">
        {queue.filter(item => !['completed', 'cancelled'].includes(item.state)).length} uploads in queue
      </p>
      {queue.slice(-100).map(item => (
        <article key={item.key} className="space-y-2 rounded-lg border border-line p-3">
          <p className="truncate text-sm font-medium" title={item.target}>
            {item.target}
          </p>
          <p className="text-sm text-muted">
            {item.state} · {item.size ? Math.round((item.offset / item.size) * 100) : 0}%
            {item.speed
              ? ` · ${(item.speed / 1024 / 1024).toFixed(1)} MiB/s · ${Math.ceil((item.size - item.offset) / item.speed)}s remaining`
              : ''}
          </p>
          {item.error && <p className="text-sm text-danger">{item.error}</p>}
          <div className="flex flex-wrap gap-2">
            {item.state === 'uploading' && (
              <QuietButton onClick={() => void uploadAction(item.key, 'pause').catch(error => setError(String(error)))}>
                Pause
              </QuietButton>
            )}
            {['paused', 'failed'].includes(item.state) && (
              <QuietButton
                onClick={() => void uploadAction(item.key, 'resume').catch(error => setError(String(error)))}
              >
                Resume / retry
              </QuietButton>
            )}
            {!['completed', 'cancelled', 'finalizing'].includes(item.state) && (
              <QuietButton
                onClick={() => void uploadAction(item.key, 'cancel').catch(error => setError(String(error)))}
              >
                Cancel
              </QuietButton>
            )}
          </div>
        </article>
      ))}
    </section>
  )
}
