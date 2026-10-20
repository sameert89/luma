import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Checkbox, IconButton, QuietButton } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { errorMessage, request, type Media } from '../browse/api'
import type { components } from '../../lib/api/generated'
import type { OperationAccepted } from './operations'

type Target = Pick<Media, 'id' | 'libraryId' | 'fileName' | 'availability'>

export function DeleteMediaAction({
  item,
  className,
  onOpenChange,
  onQueued,
}: {
  item: Target
  className?: string
  onOpenChange: (open: boolean) => void
  onQueued: () => void
}) {
  const capabilities = useQuery({
    queryKey: ['file-capabilities'],
    queryFn: ({ signal }) => request<components['schemas']['FileCapabilities']>('/api/files/capabilities', signal),
  }).data
  const [target, setTarget] = useState<Target | null>(null)
  const [permanent, setPermanent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const queued = useRef(false)
  const permanentId = useId()
  const client = useQueryClient()
  const writable = capabilities?.libraries?.some(library => library.libraryId === item.libraryId && library.writable)
  function close() {
    setTarget(null)
  }
  async function remove() {
    if (!target || busy) return
    setBusy(true)
    setError('')
    try {
      await request<OperationAccepted>('/api/files/items', undefined, 'POST', {
        libraryId: target.libraryId,
        mediaId: target.id,
        kind: permanent ? 'delete' : 'recycle',
      })
      void client.invalidateQueries({ queryKey: ['tasks'] })
      queued.current = true
      close()
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  if (!capabilities?.accessConfigured) return null
  return (
    <>
      <IconButton
        label="Delete file"
        className={className}
        disabled={!writable || item.availability === 'missing'}
        title={writable ? 'Delete file' : 'This library is read-only'}
        onClick={() => {
          setTarget(item)
          setPermanent(false)
          setError('')
          onOpenChange(true)
        }}
      >
        <Trash2 className="size-4 text-danger" />
      </IconButton>
      <Modal
        open={target !== null}
        onOpenChange={open => {
          if (!open && !busy) close()
        }}
        onHistoryClosed={() => {
          onOpenChange(false)
          if (queued.current) {
            queued.current = false
            onQueued()
          }
        }}
        title="Delete file"
        description={target?.fileName ?? ''}
      >
        <div className="space-y-4 p-5">
          <p className="break-words text-sm">
            {target?.fileName} will be moved to the recycle bin unless permanent deletion is selected.
          </p>
          <label htmlFor={permanentId} className="flex items-center gap-2 text-sm">
            <Checkbox
              id={permanentId}
              checked={permanent}
              disabled={busy}
              onChange={event => setPermanent(event.target.checked)}
            />
            Permanently delete. This cannot be undone.
          </label>
          <div className="flex flex-wrap gap-2">
            <QuietButton disabled={busy} onClick={() => void remove()}>
              {busy ? 'Queuing…' : permanent ? 'Delete permanently' : 'Move to recycle bin'}
            </QuietButton>
            <QuietButton disabled={busy} onClick={close}>
              Cancel
            </QuietButton>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      </Modal>
    </>
  )
}
