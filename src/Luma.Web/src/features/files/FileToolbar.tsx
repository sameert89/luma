import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { FolderCog, Trash2 } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { Checkbox, Field, Input, QuietButton, Select } from '../../components/ui/Controls'
import { request, errorMessage } from '../browse/api'
import type { components } from '../../lib/api/generated'
import { waitForOperation, type OperationAccepted, type FileOperation } from './operations'
import { UploadPicker } from '../uploads/UploadPicker'

type Location = components['schemas']['FileLocation']
type Capabilities = components['schemas']['FileCapabilities']
export function FileToolbar({
  libraryId,
  folderId,
  selected = new Set<number>(),
}: {
  libraryId: number
  folderId: number
  selected?: Set<number>
}) {
  const capabilities = useQuery({
    queryKey: ['file-capabilities'],
    queryFn: ({ signal }) => request<Capabilities>('/api/files/capabilities', signal),
  })
  const [open, setOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  if (!capabilities.data?.accessConfigured || !capabilities.data.libraries.some(item => item.libraryId === libraryId))
    return null
  const writable = capabilities.data.libraries.some(item => item.libraryId === libraryId && item.writable)
  return (
    <>
      <QuietButton disabled={!writable} onClick={() => setOpen(true)}>
        <FolderCog className="size-4" aria-hidden="true" />
        Manage files
      </QuietButton>
      <QuietButton disabled={!writable} onClick={() => setTrashOpen(true)}>
        <Trash2 className="size-4" aria-hidden="true" />
        Recycle bin
      </QuietButton>
      {!writable && (
        <p className="text-sm text-muted">
          File changes disabled. Check Writable, the :rw mount and permissions in Settings → File management.
        </p>
      )}
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Manage files"
        description="Operations apply to this library. Destructive changes are confirmed before starting."
        sheet
      >
        {open && writable && <FileActions libraryId={libraryId} folderId={folderId} selected={selected} />}
      </Modal>
      <Modal
        open={trashOpen}
        onOpenChange={setTrashOpen}
        title="Recycle bin"
        description="Restore deleted content without overwriting existing files."
        sheet
      >
        {trashOpen && writable && <RecycleBin libraryId={libraryId} />}
      </Modal>
    </>
  )
}

function FileActions({
  libraryId,
  folderId,
  selected,
}: {
  libraryId: number
  folderId: number
  selected: Set<number>
}) {
  const location = useQuery({
    queryKey: ['file-location', folderId],
    queryFn: ({ signal }) => request<Location>(`/api/files/location?folderId=${folderId}`, signal),
  })
  const [action, setAction] = useState('mkdir')
  const [name, setName] = useState('')
  const [permanent, setPermanent] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const client = useQueryClient()
  const permanentId = useId()
  const destructive = action === 'delete'
  const count = selected.size || 1
  async function execute() {
    if (!location.data) return
    setBusy(true)
    setMessage('')
    try {
      if (action === 'mkdir') {
        const accepted = await request<OperationAccepted>('/api/files/operations', undefined, 'POST', {
          libraryId,
          kind: 'mkdir',
          source: [location.data.relativePath, name].filter(Boolean).join('/'),
        })
        await waitForOperation(accepted.id)
      } else {
        const ids = selected.size ? [...selected].map(mediaId => ({ mediaId })) : [{ folderId }]
        for (const item of ids) {
          const accepted = await request<OperationAccepted>('/api/files/items', undefined, 'POST', {
            libraryId,
            ...item,
            kind: destructive ? (permanent ? 'delete' : 'recycle') : 'move',
            ...(destructive ? {} : { destination: name }),
          })
          await waitForOperation(accepted.id)
        }
      }
      setMessage('Completed.')
      setConfirmed(false)
      setName('')
      for (const key of ['media', 'folders', 'libraries', 'tasks']) void client.invalidateQueries({ queryKey: [key] })
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-4 p-5">
      {location.isError && (
        <p role="alert" className="text-danger">
          {errorMessage(location.error)} Enable file management in Settings.
        </p>
      )}
      <p className="text-sm text-muted">
        Current folder: {location.data?.relativePath || '/'} ·{' '}
        {selected.size ? `${selected.size} selected media` : 'Folder actions'}
      </p>
      <Field label="Operation">
        <Select
          value={action}
          disabled={busy}
          onChange={event => {
            setAction(event.target.value)
            setConfirmed(false)
          }}
        >
          <option value="mkdir">New folder</option>
          <option value="move" disabled={selected.size > 1}>
            Rename or move one selected item / current folder
          </option>
          <option value="delete">Delete selected media / current folder</option>
        </Select>
      </Field>
      {!destructive && (
        <Field label={action === 'mkdir' ? 'New folder name' : 'Destination path relative to library'}>
          <Input value={name} disabled={busy} onChange={event => setName(event.target.value)} />
        </Field>
      )}
      {destructive && (
        <label htmlFor={permanentId} className="flex items-center gap-2 text-sm">
          <Checkbox
            id={permanentId}
            checked={permanent}
            disabled={busy}
            onChange={event => {
              setPermanent(event.target.checked)
              setConfirmed(false)
            }}
          />
          Permanently delete. This cannot be undone.
        </label>
      )}
      {destructive && confirmed && (
        <p role="alert" className="text-sm text-danger">
          Delete {count} selected item{count === 1 ? '' : 's'}?{' '}
          {permanent ? 'These files will be permanently deleted.' : 'These files will move to the recycle bin.'}
        </p>
      )}
      <div className="flex gap-2">
        <QuietButton
          disabled={busy || !location.data || (!destructive && !name.trim())}
          onClick={() => (destructive && !confirmed ? setConfirmed(true) : void execute())}
        >
          {busy ? 'Working…' : destructive ? (confirmed ? 'Confirm delete' : 'Review deletion') : 'Start operation'}
        </QuietButton>
        {confirmed && (
          <QuietButton disabled={busy} onClick={() => setConfirmed(false)}>
            Cancel
          </QuietButton>
        )}
      </div>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {location.data && <UploadPicker libraryId={libraryId} destination={location.data.relativePath} />}
    </div>
  )
}

function RecycleBin({ libraryId }: { libraryId: number }) {
  const [before, setBefore] = useState<string>()
  const [alternate, setAlternate] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [purging, setPurging] = useState<string | null>(null)
  const client = useQueryClient()
  const trash = useQuery({
    queryKey: ['trash', libraryId, before],
    queryFn: ({ signal }) =>
      request<FileOperation[]>(
        `/api/files/trash?libraryId=${libraryId}${before ? `&before=${encodeURIComponent(before)}` : ''}`,
        signal,
      ),
  })
  async function run(item: FileOperation, kind: string) {
    setBusy(true)
    setError('')
    try {
      const result = await request<OperationAccepted>('/api/files/operations', undefined, 'POST', {
        libraryId,
        kind,
        source: item.source,
        recycleId: item.id,
        ...(kind === 'restore' && alternate ? { destination: alternate } : {}),
      })
      await waitForOperation(result.id)
      setPurging(null)
      for (const key of ['trash', 'media', 'folders', 'tasks']) void client.invalidateQueries({ queryKey: [key] })
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-4 p-5">
      <Field label="Alternative restore path (optional; relative to library)">
        <Input value={alternate} onChange={event => setAlternate(event.target.value)} />
      </Field>
      {(trash.error || error) && (
        <p role="alert" className="text-sm text-danger">
          {error || errorMessage(trash.error)}
        </p>
      )}
      {trash.data?.map(item => (
        <article key={item.id} className="space-y-2 rounded-lg border border-line p-3">
          <p className="break-all font-medium">{item.source}</p>
          <p className="text-sm text-muted">Deleted {new Date(item.createdAt).toLocaleString()}</p>
          <div className="flex flex-wrap gap-2">
            <QuietButton disabled={busy} onClick={() => void run(item, 'restore')}>
              Restore
            </QuietButton>
            <QuietButton
              disabled={busy}
              onClick={() => (purging === item.id ? void run(item, 'purge') : setPurging(item.id))}
            >
              {purging === item.id ? 'Confirm permanent deletion' : 'Permanently delete'}
            </QuietButton>
            {purging === item.id && <QuietButton onClick={() => setPurging(null)}>Cancel</QuietButton>}
          </div>
        </article>
      ))}
      {trash.data?.length === 0 && <p className="text-sm text-muted">Recycle bin is empty.</p>}
      <div className="flex gap-2">
        {before && <QuietButton onClick={() => setBefore(undefined)}>Newest</QuietButton>}
        {trash.data?.length === 100 && (
          <QuietButton onClick={() => setBefore(trash.data?.at(-1)?.createdAt)}>Older items</QuietButton>
        )}
      </div>
    </div>
  )
}
