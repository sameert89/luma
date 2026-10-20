import { useRef, useState, useSyncExternalStore } from 'react'
import { QuietButton } from '../../components/ui/Controls'
import { FileUp, FolderUp, UploadCloud } from 'lucide-react'
import { droppedFiles } from './droppedFiles'
import { addUploads, subscribeUploads, uploadSnapshot, uploadAction } from './uploadQueue'
export function UploadPicker({ libraryId, destination }: { libraryId: number; destination: string }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const [preparing, setPreparing] = useState(false)
  const [message, setMessage] = useState('')
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const queue = useSyncExternalStore(subscribeUploads, uploadSnapshot)
  async function choose(files: File[]) {
    setError('')
    setPreparing(true)
    setMessage('Preparing uploads… You can close this dialog; uploads continue in Background jobs.')
    try {
      const result = await addUploads(files, libraryId, destination)
      setMessage(`${result.queued} files queued for upload.${result.skipped ? ` ${result.skipped} skipped.` : ''} Follow progress in Background jobs.`)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not start upload.')
    } finally {
      setPreparing(false)
    }
  }
  return (
    <section
      aria-label="Upload files"
      className="space-y-4"
      onDragOver={event => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={event => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))
          setDragging(false)
      }}
      onDrop={event => {
        event.preventDefault()
        setDragging(false)
        void droppedFiles(event.dataTransfer)
          .then(choose)
          .catch(error => setError(String(error)))
      }}
    >
      <div
        className={`flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center ${dragging ? 'border-accent bg-surface' : 'border-line'}`}
      >
        <UploadCloud className="size-10 text-accent" aria-hidden="true" />
        <p className="font-semibold">Drop files or folders here</p>
        <p className="text-sm text-muted">Upload into {destination || '/'}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <QuietButton disabled={preparing} onClick={() => fileInput.current?.click()}>
            <FileUp className="size-4" />
            Choose files
          </QuietButton>
          <QuietButton disabled={preparing} onClick={() => folderInput.current?.click()}>
            <FolderUp className="size-4" />
            Choose folder
          </QuietButton>
        </div>
      </div>
      <input
        ref={fileInput}
        aria-label="Choose upload files"
        className="hidden"
        type="file"
        multiple
        onChange={event => {
          if (event.target.files) void choose([...event.target.files])
          event.target.value = ''
        }}
      />
      <input
        ref={folderInput}
        aria-label="Choose upload folder"
        className="hidden"
        type="file"
        multiple
        {...{ webkitdirectory: '' }}
        onChange={event => {
          if (event.target.files) void choose([...event.target.files])
          event.target.value = ''
        }}
      />
      <p className="text-sm text-muted">
        Uploads continue when this dialog closes. After refreshing, reselect the same files or folder to resume.
      </p>
      {message && (
        <p role="status" className="text-sm text-muted">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <p className="text-sm text-muted">
        {queue.filter(item => !['completed', 'cancelled', 'skipped'].includes(item.state)).length} uploads in queue
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
            {!['completed', 'cancelled', 'skipped', 'finalizing'].includes(item.state) && (
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
