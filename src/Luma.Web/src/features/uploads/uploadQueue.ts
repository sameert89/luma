import { t } from '../../lib/i18n'
import { conflictBatch, withFileConflict, waitForFileSlot } from '../files/fileConflicts'
import type { components } from '../../lib/api/generated'
import { request } from '../browse/api'
import { waitForOperation, type OperationAccepted } from '../files/operations'
import { ApiError } from '../../lib/api/client'

type Session = Required<components['schemas']['UploadSession']>
export type QueuedUpload = {
  key: string
  libraryId: number
  target: string
  size: number
  lastModified: number
  id?: string
  requestId?: string
  batch?: string
  replaceExisting?: boolean
  file?: File
  offset: number
  state: string
  error?: string
  speed?: number
  controller?: AbortController
}
const storageKey = 'luma-upload-sessions-v1'
const listeners = new Set<() => void>()
let queue: QueuedUpload[] = []
let workers = 0
const active = new Set<string>()
let sequence = 0
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as QueuedUpload[]
  queue = saved
    .filter(
      item =>
        (typeof item.id === 'string' || typeof item.requestId === 'string') &&
        typeof item.target === 'string' &&
        Number.isSafeInteger(item.size),
    )
    .map(item => ({ ...item, target: item.target.split('/').filter(Boolean).join('/'), state: 'reselect' }))
} catch {
  /* Server sessions remain authoritative if browser state is corrupt. */
}
export const subscribeUploads = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export const uploadSnapshot = () => queue
function update(key: string, value: Partial<QueuedUpload>) {
  queue = queue.map(item => (item.key === key ? { ...item, ...value } : item))
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify(
        queue
          .filter(item => (item.id || item.requestId) && !['completed', 'cancelled', 'skipped'].includes(item.state))
          .map(({ key, libraryId, target, size, lastModified, id, requestId, offset, batch, replaceExisting }) => ({
            key,
            libraryId,
            target,
            size,
            lastModified,
            id,
            requestId,
            offset,
            batch,
            replaceExisting,
          })),
      ),
    )
  } catch {
    /* Storage limits must not interrupt an in-memory transfer. */
  }
  for (const listener of listeners) listener()
}
const writeUnavailable = (error: unknown) =>
  error instanceof ApiError && ['media_not_writable', 'read_only_library'].includes(error.problem?.code ?? '')
const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))
function uploadDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}
const targetPath = (destination: string, file: File) =>
  [destination, file.webkitRelativePath || file.name].join('/').split('/').filter(Boolean).join('/')
const unfinished = (item: QueuedUpload) => !['completed', 'cancelled', 'skipped'].includes(item.state)
const sameFile = (item: QueuedUpload, file: File) => item.size === file.size && item.lastModified === file.lastModified

export function resumeUpload(key: string, file: File) {
  const item = queue.find(item => item.key === key)
  if (!item || !unfinished(item)) return
  if (file.name !== item.target.split('/').at(-1) || !sameFile(item, file))
    throw new Error(t('uploads:uploadQueue.chooseOriginalFile', { name: item.target }))
  // Repeated selection must never launch a second transfer for a live session.
  update(key, { file, ...(!active.has(key) ? { state: 'queued', error: undefined } : {}) })
  pump()
}

// Older clients could persist another request for an already reserved path. Resolve
// ambiguous entries against the server before choosing which checkpoint to resume.
async function previousUpload(libraryId: number, target: string) {
  const candidates = queue.filter(item => item.libraryId === libraryId && item.target === target && unfinished(item))
  if (candidates.length < 2) return candidates[0]
  const running = candidates.find(item => active.has(item.key))
  if (running) return running
  const found: { item: QueuedUpload; session: Session }[] = []
  for (const item of candidates) {
    try {
      const session = await waitForFileSlot(() => request<Session>(`/api/files/uploads/${item.id ?? item.requestId}`))
      found.push({ item, session })
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error
    }
  }
  const live = found.filter(({ session }) => !['completed', 'cancelled'].includes(session.state))
  if (new Set(live.map(({ session }) => session.id)).size > 1)
    throw new Error(t('uploads:uploadQueue.unfinishedUpload', { name: target }))
  const chosen = live[0] ?? found.find(({ session }) => session.state === 'completed')
  const primary = chosen?.item ?? candidates[0]
  for (const item of candidates) {
    if (item.key !== primary.key) update(item.key, { state: 'cancelled', file: undefined })
  }
  if (chosen) update(primary.key, { id: chosen.session.id, offset: chosen.session.committedOffset })
  else update(primary.key, { id: undefined })
  return queue.find(item => item.key === primary.key)!
}

export async function addUploads(files: File[], libraryId: number, destination: string) {
  if (files.length > 10000) throw new Error(t('uploads:uploadQueue.chooseAtMost10000FilesAtOnce'))
  const resumed = new Set<File>()
  const batch = conflictBatch()
  for (const file of files) {
    const target = targetPath(destination, file)
    const previous = await previousUpload(libraryId, target)
    if (previous) {
      if (!sameFile(previous, file)) throw new Error(t('uploads:uploadQueue.unfinishedUpload', { name: target }))
      resumeUpload(previous.key, file)
      resumed.add(file)
    }
  }
  const folders = new Set<string>()
  for (const file of files.filter(file => !resumed.has(file))) {
    const parts = (file.webkitRelativePath || file.name).split('/')
    parts.pop()
    if (parts.length > 127) throw new Error(t('uploads:uploadQueue.folderUploadExceedsTheDepthLimit'))
    for (let depth = 1; depth <= parts.length; depth++)
      folders.add([destination, ...parts.slice(0, depth)].filter(Boolean).join('/'))
  }
  const skippedFolders = new Set<string>()
  for (const source of folders) {
    if ([...skippedFolders].some(folder => source === folder || source.startsWith(folder + '/'))) continue
    for (let attempt = 0; ; attempt++) {
      try {
        const operation = await withFileConflict(
          replaceExisting =>
            request<OperationAccepted>('/api/files/operations', undefined, 'POST', {
              libraryId,
              kind: 'mkdir',
              source,
              ...(replaceExisting ? { replaceExisting: true } : {}),
            }),
          { batch, target: source },
        )
        if (operation) await waitForOperation(operation.id)
        else skippedFolders.add(source)
        break
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          if (error.problem?.code === 'directory_exists') break
          if (error.problem?.code === 'library_busy' && attempt < 29) {
            await sleep(1000)
            continue
          }
        }
        throw error
      }
    }
  }
  let skipped = 0
  for (const file of files.filter(file => !resumed.has(file))) {
    const target = targetPath(destination, file)
    if ([...skippedFolders].some(folder => target.startsWith(folder + '/'))) {
      skipped++
      continue
    }
    const existing = queue.find(item => item.libraryId === libraryId && item.target === target && unfinished(item))
    if (existing) {
      if (!sameFile(existing, file)) throw new Error(t('uploads:uploadQueue.unfinishedUpload', { name: target }))
      resumeUpload(existing.key, file)
      continue
    }
    const key = `upload-${Date.now()}-${++sequence}`
    queue = [
      ...queue,
      {
        key,
        libraryId,
        target: targetPath(destination, file),
        file,
        size: file.size,
        lastModified: file.lastModified,
        offset: 0,
        state: 'queued',
        batch,
        requestId: crypto.randomUUID().replaceAll('-', ''),
      },
    ]
    update(key, {})
  }
  pump()
  return { queued: files.length - skipped, skipped }
}
function pump() {
  while (workers < 2) {
    const item = queue.find(item => item.state === 'queued' && item.file && !active.has(item.key))
    if (!item) break
    workers++
    active.add(item.key)
    update(item.key, { state: 'uploading' })
    void transfer(item).finally(() => {
      workers--
      active.delete(item.key)
      pump()
    })
  }
}
async function transfer(item: QueuedUpload) {
  const controller = new AbortController()
  update(item.key, { controller })
  try {
    const requestId = item.requestId ?? crypto.randomUUID().replaceAll('-', '')
    update(item.key, { requestId })
    const batch = item.batch ?? conflictBatch()
    let replacing = item.replaceExisting ?? false
    const options = {
      batch,
      target: item.target,
      signal: controller.signal,
      waiting: () => update(item.key, { state: 'waiting' }),
      conflicting: () => update(item.key, { state: 'conflict' }),
    }
    const sessionRequest = (path: string, method = 'GET') =>
      waitForFileSlot(() => request<Session>(path, controller.signal, method), controller.signal, options.waiting)
    const admitted: Session | null = item.id
      ? await sessionRequest(`/api/files/uploads/${item.id}`)
      : await withFileConflict(async replaceExisting => {
          replacing ||= replaceExisting
          if (replacing) update(item.key, { replaceExisting: true })
          update(item.key, { state: 'uploading' })
          const created = await request<Session>('/api/files/uploads', controller.signal, 'POST', {
            libraryId: item.libraryId,
            target: item.target,
            sizeBytes: item.size,
            requestId,
            ...(replacing ? { replaceExisting: true } : {}),
          })
          update(item.key, { state: 'uploading' })
          return created
        }, options)
    if (!admitted) {
      update(item.key, { state: 'skipped', controller: undefined, file: undefined })
      return
    }
    let session: Session = admitted
    update(item.key, { id: session.id, offset: session.committedOffset })
    if (session.state === 'paused') session = await sessionRequest(`/api/files/uploads/${session.id}/resume`, 'POST')
    if (session.state === 'cancelled')
      throw new Error(t('uploads:uploadQueue.thisServerUploadWasCancelledStartANewUpload'))
    let offset = session.committedOffset
    let failures = 0
    let delays = 0
    const start = performance.now(),
      initial = offset
    while (offset < item.size && !['completed', 'finalizing'].includes(session.state)) {
      controller.signal.throwIfAborted()
      try {
        const response = await fetch(`/api/files/uploads/${session.id}?offset=${offset}`, {
          method: 'PATCH',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/octet-stream',
            Accept: 'application/json',
          },
          body: item.file!.slice(offset, Math.min(offset + 8 * 1024 * 1024, item.size)),
        })
        if (!response.ok) {
          const problem = (await response.json().catch(() => ({}))) as components['schemas']['ApiProblem']
          throw new ApiError(response.status, {
            ...problem,
            title: problem.title ?? t('uploads:uploadQueue.uploadFailed', { value1: response.status }),
          })
        }
        session = (await response.json()) as Session
        update(item.key, { state: 'uploading' })
        offset = session.committedOffset
        failures = 0
        delays = 0
        update(item.key, { offset, speed: (offset - initial) / Math.max((performance.now() - start) / 1000, 0.1) })
      } catch (error) {
        controller.signal.throwIfAborted()
        const transient =
          error instanceof ApiError && ([429, 503].includes(error.status) || error.problem?.code === 'database_busy')
        if (writeUnavailable(error) || (!transient && ++failures > 4)) throw error
        update(item.key, { state: 'waiting' })
        await uploadDelay(Math.min(5000, 500 * 2 ** Math.min(delays++, 4)), controller.signal)
        session = await sessionRequest(`/api/files/uploads/${session.id}`)
        offset = session.committedOffset
      }
    }
    for (let attempt = 0; session.state !== 'completed'; attempt++) {
      controller.signal.throwIfAborted()
      try {
        if (session.state !== 'finalizing') {
          const id: string = session.id
          const finalized: Session | null = await withFileConflict<Session>(async replaceExisting => {
            replacing ||= replaceExisting
            if (replacing) update(item.key, { replaceExisting: true })
            return request<Session>(
              `/api/files/uploads/${id}/finalize${replacing ? '?replaceExisting=true' : ''}`,
              controller.signal,
              'POST',
            )
          }, options)
          if (!finalized) {
            await request(`/api/files/uploads/${id}/cancel`, controller.signal, 'POST')
            update(item.key, { state: 'skipped', controller: undefined, file: undefined })
            return
          }
          session = finalized
        }
        update(item.key, { state: 'finalizing' })
        await waitForOperation(session.operationId!, controller.signal)
        break
      } catch (error) {
        if (writeUnavailable(error) || (error instanceof ApiError && error.status === 409) || attempt >= 4) throw error
        await uploadDelay(1000 * 2 ** attempt, controller.signal)
        session = await sessionRequest(`/api/files/uploads/${session.id}`)
      }
    }
    update(item.key, { state: 'completed', offset: item.size, controller: undefined, file: undefined })
  } catch (error) {
    if (
      !controller.signal.aborted &&
      !['paused', 'cancelled', 'cancelling'].includes(queue.find(entry => entry.key === item.key)?.state ?? '')
    )
      update(item.key, {
        state: 'failed',
        controller: undefined,
        error: error instanceof Error ? error.message : t('uploads:uploadQueue.uploadInterrupted'),
      })
  }
}
export async function uploadAction(key: string, action: 'pause' | 'resume' | 'cancel') {
  const item = queue.find(item => item.key === key)
  if (!item) return
  if (action === 'resume') {
    if (active.has(key) && !item.controller?.signal.aborted) return
    if (!item.file) {
      update(key, { state: 'reselect' })
      return
    }
    // transfer() queries authoritative state and resumes only a paused session.
    update(key, { state: 'queued', error: undefined })
    pump()
    return
  }
  update(key, { state: action === 'pause' ? 'paused' : 'cancelling' })
  item.controller?.abort()
  try {
    let id = item.id
    if (!id && item.requestId) {
      // Resolve a lost creation response by its stable ID. If admission is still
      // in flight, the idempotent creation request serializes behind it before cancellation.
      try {
        id = (await request<Session>(`/api/files/uploads/${item.requestId}`)).id
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error
        if (['uploading', 'failed'].includes(item.state)) {
          try {
            id = (
              await request<Session>('/api/files/uploads', undefined, 'POST', {
                libraryId: item.libraryId,
                target: item.target,
                sizeBytes: item.size,
                requestId: item.requestId,
                ...(item.replaceExisting ? { replaceExisting: true } : {}),
              })
            ).id
          } catch (admission) {
            if (
              !(admission instanceof ApiError) ||
              !['path_busy', 'destination_exists', 'upload_capacity'].includes(admission.problem?.code ?? '')
            )
              throw admission
          }
        }
      }
    }
    if (id) await request(`/api/files/uploads/${id}/${action}`, undefined, 'POST')
    update(key, { id, state: action === 'pause' ? 'paused' : 'cancelled', controller: undefined })
  } catch (error) {
    update(key, {
      state: 'failed',
      controller: undefined,
      error: error instanceof Error ? error.message : t('uploads:uploadQueue.couldNotUpdateUpload'),
    })
    throw error
  }
}
