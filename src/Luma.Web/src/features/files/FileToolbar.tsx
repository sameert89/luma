import { Button } from '../../components/ui/Button'
import { waitForOperation } from './operations'
import { t } from '../../lib/i18n'
import { conflictBatch, withFileConflict } from './fileConflicts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { ClipboardPaste, Copy, FolderCog, FolderPlus, Scissors, Trash2, Upload, X, LoaderCircle } from 'lucide-react'
import { RenameFileAction } from './RenameFileAction'
import { Modal } from '../../components/ui/Modal'
import { Checkbox, Field, IconButton, Input, QuietButton, Select } from '../../components/ui/Controls'
import { request, errorMessage, type Library } from '../browse/api'
import type { components } from '../../lib/api/generated'
import type { OperationAccepted, FileOperation } from './operations'
import { UploadPicker } from '../uploads/UploadPicker'
import {
  clipboardSnapshot,
  setClipboard,
  subscribeClipboard,
  pasteSnapshot,
  beginPaste,
  finishPaste,
} from './clipboard'

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
      label={t('files:fileToolbar.fileManagement')}
      aria-pressed={active && writable}
      disabled={!writable}
      title={writable ? t('files:fileToolbar.fileManagement') : t('files:fileToolbar.thisLibraryIsReadOnly')}
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
  compact = false,
}: {
  libraryId?: number
  folderId?: number
  selected?: Set<number>
  selectedFolders?: Set<number>
  onQueued?: () => void
  onClipboard?: () => void
  compact?: boolean
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
  const activePaste = useSyncExternalStore(subscribeClipboard, pasteSnapshot)
  const [waiting, setWaiting] = useState(false)
  const working = busy || !!activePaste
  const pasteMutation = useMutation({ mutationKey: ['background-task'], mutationFn: () => execute('paste') })
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
      throw new Error(t('files:fileToolbar.theSelectionIncludesAReadOnlyLibrary'))
    return entries
  }
  async function capture(kind: 'move' | 'copy') {
    if (working) return
    setBusy(true)
    setError('')
    try {
      const entries = await selection()
      setClipboard({ kind, entries })
      setMessage(
        t(kind === 'move' ? 'files:fileToolbar.clipboardMove' : 'files:fileToolbar.clipboardCopy', {
          count: entries.length,
        }),
      )
      onClipboard?.()
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  async function execute(kind: 'mkdir' | 'delete' | 'paste') {
    if (working || (kind !== 'delete' && !location.data)) return
    const controller = kind === 'paste' && clipboard ? beginPaste(clipboard) : null
    if (kind === 'paste' && !controller) return
    setWaiting(false)
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
          throw new Error(t('files:fileToolbar.enterAFolderNameNotAPath'))
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
              { batch, target: destination, signal: controller?.signal, waiting: () => setWaiting(true) },
            )
            setWaiting(false)
            if (result) {
              queued++
              // Accepted work must appear even if a later item is waiting or conflicting.
              void client.invalidateQueries({ queryKey: ['tasks'] })
            } else {
              skipped++
              failed.push(item)
            }
          } catch (error) {
            failed.push(item)
            if (!controller?.signal.aborted) setError(errorMessage(error))
          }
        }
        if (clipboard.kind === 'move' && clipboardSnapshot() === clipboard)
          setClipboard(failed.length ? { ...clipboard, entries: failed } : null)
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
          t('files:fileToolbar.operationsQueued', {
            count: queued,
            skipped: skipped ? t('common:counts.skipped', { count: skipped }) : '',
          }),
        )
      if (controller) finishPaste(controller)
      setWaiting(false)
      void client.invalidateQueries({ queryKey: ['tasks'] })
      setBusy(false)
    }
  }
  useEffect(() => {
    if (!writable || dialog || compact) return
    function shortcuts(event: KeyboardEvent) {
      if (
        working ||
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
          pasteMutation.mutate()
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
        aria-label={t('files:fileToolbar.fileActions')}
        className="flex flex-wrap items-center gap-1 border-t border-line pt-2"
      >
        <QuietButton disabled={working || !count} onClick={() => void capture('move')}>
          <Scissors className="size-4" />
          {t('files:fileToolbar.cut')}
        </QuietButton>
        <QuietButton disabled={working || !count} onClick={() => void capture('copy')}>
          <Copy className="size-4" />
          {t('files:fileToolbar.copy')}
        </QuietButton>
        {!compact && (
          <QuietButton disabled={working || !canPaste || !location.data} onClick={() => pasteMutation.mutate()}>
            {activePaste ? (
              <LoaderCircle className="size-4 motion-safe:animate-spin" />
            ) : (
              <ClipboardPaste className="size-4" />
            )}
            {t(activePaste ? 'files:fileToolbar.pasting' : 'files:fileToolbar.paste')}
            {clipboard ? ` (${clipboard.entries.length})` : ''}
          </QuietButton>
        )}
        <RenameFileAction
          libraryId={libraryId}
          mediaIds={[...selected]}
          folderIds={[...selectedFolders]}
          disabled={working}
          onQueued={() => {
            onQueued?.()
            setMessage(t('files:fileToolbar.renameQueuedFollowProgressInBackgroundJobs'))
          }}
        />
        <QuietButton
          disabled={working || !count}
          onClick={() => {
            setPermanent(false)
            setDialog('delete')
          }}
        >
          <Trash2 className="size-4" />
          {t('files:fileToolbar.delete')}
        </QuietButton>
        {!compact && (
          <>
            <QuietButton disabled={working || !location.data} onClick={() => setDialog('mkdir')}>
              <FolderPlus className="size-4" />
              {t('files:fileToolbar.newFolder')}
            </QuietButton>
            <QuietButton disabled={working || !location.data} onClick={() => setDialog('upload')}>
              <Upload className="size-4" />
              {t('files:fileToolbar.upload')}
            </QuietButton>
          </>
        )}
        {!compact && activePaste && (
          <QuietButton onClick={() => activePaste?.abort()}>{t('files:fileToolbar.cancelRemaining')}</QuietButton>
        )}
        {!compact && clipboard && (
          <IconButton
            disabled={working}
            label={t('files:fileToolbar.clearFileClipboard')}
            onClick={() => setClipboard(null)}
          >
            <X className="size-4" />
          </IconButton>
        )}
      </div>
      {!compact && !location.data && (
        <p className="text-sm text-muted">{t('files:fileToolbar.openAFolderToPasteUploadOrCreateA')}</p>
      )}
      {!compact && clipboard && !canPaste && (
        <p className="text-sm text-muted">{t('files:fileToolbar.openAFolderInTheSourceLibraryToPaste')}</p>
      )}
      {(message || activePaste) && !compact && (
        <p role="status" className="text-sm text-muted">
          {activePaste ? t(waiting ? 'files:fileToolbar.waitingToPaste' : 'files:fileToolbar.addingToJobs') : message}
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
        title={
          dialog === 'mkdir'
            ? t('files:fileToolbar.newFolder')
            : dialog === 'delete'
              ? t('files:fileToolbar.deleteSelectedItems')
              : t('files:fileToolbar.upload')
        }
        description={
          dialog === 'delete'
            ? t('files:fileToolbar.selectedForDeletion', { count })
            : t('files:fileToolbar.in', { value1: location.data?.relativePath || '/' })
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
              <Field label={t('files:fileToolbar.folderName')}>
                <Input value={name} onChange={event => setName(event.target.value)} />
              </Field>
              <QuietButton type="submit" disabled={working || !name.trim()}>
                {t('files:fileToolbar.createFolder')}
              </QuietButton>
            </form>
          )}
          {dialog === 'delete' && (
            <>
              <label htmlFor={permanentId} className="flex items-center gap-2 text-sm">
                <Checkbox id={permanentId} checked={permanent} onChange={event => setPermanent(event.target.checked)} />
                {t('files:fileToolbar.permanentlyDeleteThisCannotBeUndone')}
              </label>
              <QuietButton disabled={working} onClick={() => void execute('delete')}>
                {busy
                  ? t('files:fileToolbar.queuing')
                  : permanent
                    ? t('files:fileToolbar.deletePermanently')
                    : t('files:fileToolbar.moveToRecycleBin')}
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
        {t('files:fileToolbar.recycleBin')}
      </QuietButton>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t('files:fileToolbar.recycleBin')}
        description={t('files:fileToolbar.restoreDeletedContentOrPermanentlyRemoveIt')}
      >
        <div className="p-5">
          <Field label={t('files:fileToolbar.library')}>
            <Select value={libraryId ?? ''} onChange={event => setChosen(Number(event.target.value))}>
              {available.map(item => (
                <option key={item.libraryId} value={item.libraryId}>
                  {libraries?.find(library => library.id === item.libraryId)?.name ??
                    t('files:fileToolbar.library2', { value1: item.libraryId })}
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

export function RecycleBin({ libraryId }: { libraryId: number }) {
  const [queued, setQueued] = useState(false)
  const [before, setBefore] = useState<string>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [purging, setPurging] = useState<FileOperation | 'all' | null>(null)
  const running = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const client = useQueryClient()
  const url = `/api/files/trash?libraryId=${libraryId}`
  const trash = useQuery({
    queryKey: ['trash', libraryId, before],
    queryFn: ({ signal }) =>
      request<FileOperation[]>(`${url}${before ? `&before=${encodeURIComponent(before)}` : ''}`, signal),
  })
  async function run(kind: 'restore' | 'purge', item?: FileOperation) {
    if (running.current) return
    running.current = true
    const abort = new AbortController()
    controller.current = abort
    setBusy(true)
    setError('')
    setPurging(null)
    try {
      // Re-read the first page after each bounded batch. Accepted entries are excluded
      // by the server, so bulk actions include older pages without retaining the bin.
      do {
        const page = item ? [item] : await request<FileOperation[]>(url, abort.signal)
        if (!page.length) break
        for (const entry of page) {
          abort.signal.throwIfAborted()
          const result = await request<OperationAccepted>('/api/files/operations', abort.signal, 'POST', {
            libraryId,
            kind,
            source: entry.source,
            recycleId: entry.id,
          })
          setQueued(true)
          // Remove admitted rows immediately; they cannot be submitted a second time.
          client.setQueriesData<FileOperation[]>({ queryKey: ['trash', libraryId] }, old =>
            old?.filter(row => row.id !== entry.id),
          )
          void client.invalidateQueries({ queryKey: ['tasks'] })
          // Bulk work stays bounded even for a bin larger than the operation queue.
          if (!item) await waitForOperation(result.id, abort.signal)
        }
      } while (!item)
    } catch (error) {
      if (!abort.signal.aborted) setError(errorMessage(error))
    } finally {
      for (const key of ['trash', 'media', 'folders', 'tasks']) void client.invalidateQueries({ queryKey: [key] })
      controller.current = null
      running.current = false
      setBusy(false)
    }
  }
  useEffect(() => () => controller.current?.abort(), [])
  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap gap-2">
        <QuietButton disabled={busy || !trash.data?.length} onClick={() => void run('restore')}>
          {t('files:fileToolbar.restoreAll')}
        </QuietButton>
        <QuietButton className="text-danger" disabled={busy || !trash.data?.length} onClick={() => setPurging('all')}>
          <Trash2 className="size-4" />
          {t('files:fileToolbar.emptyBin')}
        </QuietButton>
        {busy && (
          <QuietButton onClick={() => controller.current?.abort()}>
            {t('files:fileToolbar.cancelRemaining')}
          </QuietButton>
        )}
      </div>
      {queued && <p role="status">{t('files:fileToolbar.queuedFollowProgressInBackgroundJobs')}</p>}
      {trash.isPending && <p role="status">{t('files:fileToolbar.loading')}</p>}
      {(trash.error || error) && (
        <p role="alert" className="text-sm text-danger">
          {error || errorMessage(trash.error)}
        </p>
      )}
      {trash.data?.map(item => (
        <article key={item.id} className="space-y-2 rounded-lg border border-line p-3">
          <p className="break-all font-medium">{item.source}</p>
          <p className="text-sm text-muted">
            {t('files:fileToolbar.deleted', { date: new Date(item.createdAt).toLocaleString() })}
          </p>
          <div className="flex flex-wrap gap-2">
            <QuietButton disabled={busy} onClick={() => void run('restore', item)}>
              {t('files:fileToolbar.restore')}
            </QuietButton>
            <QuietButton className="text-danger" disabled={busy} onClick={() => setPurging(item)}>
              <Trash2 className="size-4" />
              {t('files:fileToolbar.permanentlyDelete')}
            </QuietButton>
          </div>
        </article>
      ))}
      {trash.data?.length === 0 && <p className="text-sm text-muted">{t('files:fileToolbar.recycleBinIsEmpty')}</p>}
      <div className="flex gap-2">
        {before && (
          <QuietButton disabled={busy} onClick={() => setBefore(undefined)}>
            {t('files:fileToolbar.newest')}
          </QuietButton>
        )}
        {trash.data?.length === 100 && (
          <QuietButton
            disabled={busy}
            onClick={() => {
              const last = trash.data?.at(-1)
              if (last) setBefore(`${last.createdAt}|${last.id}`)
            }}
          >
            {t('files:fileToolbar.olderItems')}
          </QuietButton>
        )}
      </div>
      <Modal
        open={purging !== null}
        onOpenChange={open => {
          if (!open) setPurging(null)
        }}
        title={t(purging === 'all' ? 'files:fileToolbar.emptyBin' : 'files:fileToolbar.permanentlyDelete')}
        description={t(purging === 'all' ? 'files:fileToolbar.emptyBinPrompt' : 'files:fileToolbar.purgePrompt', {
          name: purging && purging !== 'all' ? purging.source : '',
        })}
      >
        <div className="flex flex-wrap gap-2 p-5">
          <Button
            className="bg-danger text-white"
            onClick={() => void run('purge', purging === 'all' || !purging ? undefined : purging)}
          >
            {t('files:fileToolbar.confirmPermanentDeletion')}
          </Button>
          <QuietButton onClick={() => setPurging(null)}>{t('files:fileToolbar.cancel')}</QuietButton>
        </div>
      </Modal>
    </div>
  )
}
