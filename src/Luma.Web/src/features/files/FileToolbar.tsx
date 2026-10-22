import { conflictBatch, withFileConflict } from './fileConflicts'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { ClipboardPaste, Copy, FolderCog, FolderPlus, Scissors, Trash2, Upload, X } from 'lucide-react'
import { RenameFileAction } from './RenameFileAction'
import { Modal } from '../../components/ui/Modal'
import { Checkbox, Field, IconButton, Input, QuietButton, Select } from '../../components/ui/Controls'
import { request, errorMessage, type Library } from '../browse/api'
import type { components } from '../../lib/api/generated'
import type { OperationAccepted, FileOperation } from './operations'
import { UploadPicker } from '../uploads/UploadPicker'
import { clipboardSnapshot, setClipboard, subscribeClipboard } from './clipboard'

type Location = components['schemas']['FileLocation']
type Capabilities = components['schemas']['FileCapabilities']
function useCapabilities() {
  return useQuery({
    queryKey: ['file-capabilities'],
    queryFn: ({ signal }) => request<Capabilities>('/api/files/capabilities', signal),
  })
}
export function FileManagementButton({
  libraryId,
  active,
  onToggle,
}: {
  libraryId?: number
  active: boolean
  onToggle: () => void
}) {
  const capabilities = useCapabilities().data
  if (!capabilities?.accessConfigured) return null
  const writable = capabilities.libraries?.some(item => (!libraryId || item.libraryId === libraryId) && item.writable)
  return (
    <IconButton
      label="File management"
      aria-pressed={active && writable}
      disabled={!writable}
      title={writable ? 'File management' : 'This library is read-only'}
      onClick={onToggle}
    >
      <FolderCog className="size-4" />
    </IconButton>
  )
}
export function FileToolbar({
  libraryId,
  folderId,
  selected = new Set<number>(),
  selectedFolders = new Set<number>(),
  onQueued,
  onClipboard,
}: {
  libraryId?: number
  folderId?: number
  selected?: Set<number>
  selectedFolders?: Set<number>
  onQueued?: () => void
  onClipboard?: () => void
}) {
  const capabilities = useCapabilities().data
  const clipboard = useSyncExternalStore(subscribeClipboard, clipboardSnapshot)
  const location = useQuery({
    queryKey: ['file-location', folderId],
    enabled: folderId !== undefined,
    queryFn: ({ signal }) => request<Location>(`/api/files/location?folderId=${folderId}`, signal),
  })
  const [dialog, setDialog] = useState<'mkdir' | 'delete' | 'upload' | null>(null)
  const [name, setName] = useState('')
  const permanentId = useId()
  const [permanent, setPermanent] = useState(false)
  const [busy, setBusy] = useState(false)
  const pasteController = useRef<AbortController | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const client = useQueryClient()
  const count = selected.size + selectedFolders.size
  const writable =
    capabilities?.accessConfigured &&
    capabilities.libraries?.some(item => (!libraryId || item.libraryId === libraryId) && item.writable)
  // Source entries keep their original location while browsing to the destination.
  const canPaste =
    !!location.data && !!clipboard && clipboard.entries.every(item => item.libraryId === location.data.libraryId)
  async function selection() {
    const entries = await request<components['schemas']['FileClipboardEntry'][]>(
      '/api/files/clipboard',
      undefined,
      'POST',
      { mediaIds: [...selected], folderIds: [...selectedFolders] },
    )
    if (
      entries.some(
        entry => !capabilities?.libraries?.some(library => library.libraryId === entry.libraryId && library.writable),
      )
    )
      throw new Error('The selection includes a read-only library.')
    return entries
  }
  async function capture(kind: 'move' | 'copy') {
    setBusy(true)
    setError('')
    try {
      const entries = await selection()
      setClipboard({ kind, entries })
      setMessage(
        `${entries.length} items ready to ${kind === 'move' ? 'move' : 'copy'}. Open a destination folder and choose Paste.`,
      )
      onClipboard?.()
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  async function execute(kind: 'mkdir' | 'delete' | 'paste') {
    if (kind !== 'delete' && !location.data) return
    const controller = kind === 'paste' ? new AbortController() : null
    pasteController.current = controller
    const batch = conflictBatch()
    setBusy(true)
    setError('')
    setMessage('')
    let queued = 0
    let skipped = 0
    const failed: NonNullable<typeof clipboard>['entries'] = []
    try {
      if (kind === 'mkdir' && location.data) {
        if (!name.trim() || /[/\\]/.test(name) || name === '.' || name === '..')
          throw new Error('Enter a folder name, not a path.')
        await request<OperationAccepted>('/api/files/operations', undefined, 'POST', {
          libraryId: location.data.libraryId,
          kind: 'mkdir',
          source: [location.data.relativePath, name].filter(Boolean).join('/'),
        })
        queued++
      } else if (kind === 'delete') {
        const entries = await selection()
        for (const item of entries) {
          await request<OperationAccepted>('/api/files/items', undefined, 'POST', {
            libraryId: item.libraryId,
            ...(item.mediaId != null ? { mediaId: item.mediaId } : { folderId: item.folderId }),
            kind: permanent ? 'delete' : 'recycle',
          })
          queued++
        }
      } else if (clipboard && location.data) {
        for (const [index, item] of clipboard.entries.entries()) {
          if (controller?.signal.aborted) {
            failed.push(...clipboard.entries.slice(index))
            break
          }
          try {
            const destination = [location.data.relativePath, item.relativePath.split('/').at(-1)]
              .filter(Boolean)
              .join('/')
            const result = await withFileConflict(
              replaceExisting =>
                request<OperationAccepted>('/api/files/items', controller?.signal, 'POST', {
                  libraryId: location.data!.libraryId,
                  kind: clipboard.kind,
                  ...(item.mediaId != null ? { mediaId: item.mediaId } : { folderId: item.folderId }),
                  destination,
                  ...(replaceExisting ? { replaceExisting: true } : {}),
                }),
              { batch, target: destination, signal: controller?.signal },
            )
            if (result) queued++
            else {
              skipped++
              failed.push(item)
            }
          } catch (error) {
            failed.push(item)
            if (!controller?.signal.aborted) setError(errorMessage(error))
          }
        }
        if (clipboard.kind === 'move') setClipboard(failed.length ? { ...clipboard, entries: failed } : null)
      }
      if (queued) {
        setDialog(null)
        setName('')
        onQueued?.()
      }
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      if (queued || skipped)
        setMessage(
          `${queued} operation${queued === 1 ? '' : 's'} queued.${skipped ? ` ${skipped} skipped.` : ''} Follow progress in Background jobs.`,
        )
      pasteController.current = null
      void client.invalidateQueries({ queryKey: ['tasks'] })
      setBusy(false)
    }
  }
  useEffect(() => {
    if (!writable || dialog) return
    function shortcuts(event: KeyboardEvent) {
      if (
        busy ||
        event.repeat ||
        event.altKey ||
        (event.target instanceof Element &&
          event.target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) ||
        window.getSelection()?.toString()
      )
        return
      const key = event.key.toLowerCase()
      if (event.ctrlKey || event.metaKey) {
        if ((key === 'c' || key === 'x') && count) {
          event.preventDefault()
          void capture(key === 'x' ? 'move' : 'copy')
        } else if (key === 'v' && canPaste) {
          event.preventDefault()
          void execute('paste')
        }
      } else if (event.key === 'Delete' && count) {
        event.preventDefault()
        setPermanent(false)
        setDialog('delete')
      }
    }
    document.addEventListener('keydown', shortcuts)
    return () => document.removeEventListener('keydown', shortcuts)
  })
  if (!writable) return null
  return (
    <>
      <div
        role="group"
        aria-label="File actions"
        className="flex flex-wrap items-center gap-1 border-t border-line pt-2"
      >
        <QuietButton disabled={busy || !count} onClick={() => void capture('move')}>
          <Scissors className="size-4" />
          Cut
        </QuietButton>
        <QuietButton disabled={busy || !count} onClick={() => void capture('copy')}>
          <Copy className="size-4" />
          Copy
        </QuietButton>
        <QuietButton disabled={busy || !canPaste || !location.data} onClick={() => void execute('paste')}>
          <ClipboardPaste className="size-4" />
          Paste{clipboard ? ` (${clipboard.entries.length})` : ''}
        </QuietButton>
        <RenameFileAction
          libraryId={libraryId}
          mediaIds={[...selected]}
          folderIds={[...selectedFolders]}
          disabled={busy}
          onQueued={() => {
            onQueued?.()
            setMessage('Rename queued. Follow progress in Background jobs.')
          }}
        />
        <QuietButton
          disabled={busy || !count}
          onClick={() => {
            setPermanent(false)
            setDialog('delete')
          }}
        >
          <Trash2 className="size-4" />
          Delete
        </QuietButton>
        <QuietButton disabled={busy || !location.data} onClick={() => setDialog('mkdir')}>
          <FolderPlus className="size-4" />
          New folder
        </QuietButton>
        <QuietButton disabled={busy || !location.data} onClick={() => setDialog('upload')}>
          <Upload className="size-4" />
          Upload
        </QuietButton>
        {busy && pasteController.current && (
          <QuietButton onClick={() => pasteController.current?.abort()}>Cancel remaining</QuietButton>
        )}
        {clipboard && (
          <IconButton label="Clear file clipboard" onClick={() => setClipboard(null)}>
            <X className="size-4" />
          </IconButton>
        )}
      </div>
      {!location.data && <p className="text-sm text-muted">Open a folder to paste, upload, or create a folder.</p>}
      {clipboard && !canPaste && (
        <p className="text-sm text-muted">Open a folder in the source library to paste these items.</p>
      )}
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
      <Modal
        open={dialog !== null}
        onOpenChange={open => {
          if (!open) setDialog(null)
        }}
        title={dialog === 'mkdir' ? 'New folder' : dialog === 'delete' ? 'Delete selected items' : 'Upload'}
        description={
          dialog === 'delete'
            ? `${count} selected items will be queued for deletion.`
            : `In ${location.data?.relativePath || '/'}`
        }
      >
        <div className="space-y-4 p-5">
          {dialog === 'mkdir' && (
            <form
              onSubmit={event => {
                event.preventDefault()
                void execute('mkdir')
              }}
              className="space-y-3"
            >
              <Field label="Folder name">
                <Input value={name} onChange={event => setName(event.target.value)} />
              </Field>
              <QuietButton type="submit" disabled={busy || !name.trim()}>
                Create folder
              </QuietButton>
            </form>
          )}
          {dialog === 'delete' && (
            <>
              <label htmlFor={permanentId} className="flex items-center gap-2 text-sm">
                <Checkbox id={permanentId} checked={permanent} onChange={event => setPermanent(event.target.checked)} />
                Permanently delete. This cannot be undone.
              </label>
              <QuietButton disabled={busy} onClick={() => void execute('delete')}>
                {busy ? 'Queuing…' : permanent ? 'Delete permanently' : 'Move to recycle bin'}
              </QuietButton>
            </>
          )}
          {dialog === 'upload' && location.data && (
            <UploadPicker libraryId={location.data.libraryId} destination={location.data.relativePath} />
          )}
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

export function RecycleBinSettings() {
  const capabilities = useCapabilities().data
  const libraries = useQuery({
    queryKey: ['libraries'],
    queryFn: ({ signal }) => request<Library[]>('/api/libraries', signal),
  }).data
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<number>()
  const available = capabilities?.libraries?.filter(item => item.writable) ?? []
  const libraryId = chosen ?? available[0]?.libraryId
  return (
    <>
      <QuietButton disabled={!capabilities?.accessConfigured || !available.length} onClick={() => setOpen(true)}>
        <Trash2 className="size-4" />
        Recycle bin
      </QuietButton>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Recycle bin"
        description="Restore deleted content or permanently remove it."
      >
        <div className="p-5">
          <Field label="Library">
            <Select value={libraryId ?? ''} onChange={event => setChosen(Number(event.target.value))}>
              {available.map(item => (
                <option key={item.libraryId} value={item.libraryId}>
                  {libraries?.find(library => library.id === item.libraryId)?.name ?? `Library ${item.libraryId}`}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {open && libraryId && <RecycleBin key={libraryId} libraryId={libraryId} />}
      </Modal>
    </>
  )
}

function RecycleBin({ libraryId }: { libraryId: number }) {
  const [queued, setQueued] = useState(false)
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
      void result
      setQueued(true)
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
      {queued && <p role="status">Queued. Follow progress in Background jobs.</p>}
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
