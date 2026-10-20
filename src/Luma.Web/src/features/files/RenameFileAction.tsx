import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { Field, IconButton, Input, QuietButton } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { errorMessage, request } from '../browse/api'
import type { components } from '../../lib/api/generated'
import type { OperationAccepted } from './operations'

type Entry = components['schemas']['FileClipboardEntry']
export function RenameFileAction({
  mediaIds,
  libraryId,
  folderIds = [],
  iconOnly = false,
  disabled = false,
  className,
  onOpenChange,
  onQueued,
}: {
  libraryId?: number
  mediaIds: number[]
  folderIds?: number[]
  iconOnly?: boolean
  disabled?: boolean
  className?: string
  onOpenChange?: (open: boolean) => void
  onQueued?: () => void
}) {
  const capabilities = useQuery({
    queryKey: ['file-capabilities'],
    queryFn: ({ signal }) => request<components['schemas']['FileCapabilities']>('/api/files/capabilities', signal),
  }).data
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<Entry | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const queued = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open || !target) return
    const frame = requestAnimationFrame(() => {
      input.current?.focus()
      const name = target.relativePath.split('/').at(-1) ?? ''
      const dot = name.lastIndexOf('.')
      input.current?.setSelectionRange(0, target.mediaId != null && dot > 0 ? dot : name.length)
    })
    return () => cancelAnimationFrame(frame)
  }, [open, target])
  const original = target?.relativePath.split('/').at(-1) ?? ''
  async function begin() {
    setOpen(true)
    onOpenChange?.(true)
    setTarget(null)
    setName('')
    setError('')
    setBusy(true)
    try {
      const entries = await request<Entry[]>('/api/files/clipboard', undefined, 'POST', { mediaIds, folderIds })
      const entry = entries[0]
      if (entries.length !== 1 || !entry) throw new Error('Select one file or folder to rename.')
      if (!capabilities?.libraries?.some(library => library.libraryId === entry.libraryId && library.writable))
        throw new Error('This library is read-only.')
      setTarget(entry)
      setName(entry.relativePath.split('/').at(-1) ?? '')
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  async function rename() {
    if (!target || busy) return
    if (!name.trim() || name === '.' || name === '..' || /[/\\]/.test(name)) {
      setError('Enter a file or folder name, not a path.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const parent = target.relativePath.slice(0, target.relativePath.lastIndexOf('/') + 1)
      await request<OperationAccepted>('/api/files/items', undefined, 'POST', {
        libraryId: target.libraryId,
        ...(target.mediaId != null ? { mediaId: target.mediaId } : { folderId: target.folderId }),
        kind: 'move',
        destination: parent + name,
      })
      void client.invalidateQueries({ queryKey: ['tasks'] })
      queued.current = true
      setOpen(false)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  if (!capabilities?.accessConfigured) return null
  const unavailable =
    disabled ||
    mediaIds.length + folderIds.length !== 1 ||
    !capabilities.libraries?.some(l => (!libraryId || libraryId === l.libraryId) && l.writable)
  return (
    <>
      {iconOnly ? (
        <IconButton label="Rename file" className={className} disabled={unavailable} onClick={() => void begin()}>
          <Pencil className="size-4" />
        </IconButton>
      ) : (
        <QuietButton disabled={unavailable} onClick={() => void begin()}>
          <Pencil className="size-4" />
          Rename
        </QuietButton>
      )}
      <Modal
        open={open}
        onOpenChange={value => {
          if (!busy) setOpen(value)
        }}
        onHistoryClosed={() => {
          onOpenChange?.(false)
          if (queued.current) {
            queued.current = false
            onQueued?.()
          }
        }}
        title="Rename"
        description={original || 'Rename the selected file or folder in its current folder.'}
      >
        <form
          className="space-y-4 p-5"
          onSubmit={event => {
            event.preventDefault()
            void rename()
          }}
        >
          <Field label="Name">
            <Input
              ref={input}
              value={name}
              disabled={busy || !target}
              onChange={event => setName(event.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <QuietButton type="submit" disabled={busy || !target || !name.trim() || name === original}>
              {busy ? 'Working…' : 'Rename'}
            </QuietButton>
            <QuietButton disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </QuietButton>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </form>
      </Modal>
    </>
  )
}
