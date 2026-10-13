import type { components } from '../../lib/api/generated'
import { mutationHeaders } from '../../lib/api/mutationAccess'
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
let sequence = 0
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as QueuedUpload[]
  queue = saved
    .filter(item => typeof item.id === 'string' && typeof item.target === 'string' && Number.isSafeInteger(item.size))
    .map(item => ({ ...item, state: 'reselect' }))
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
          .filter(item => item.id && !['completed', 'cancelled'].includes(item.state))
          .map(({ key, libraryId, target, size, lastModified, id, offset }) => ({
            key,
            libraryId,
            target,
            size,
            lastModified,
            id,
            offset,
          })),
      ),
    )
  } catch {
    /* Storage limits must not interrupt an in-memory transfer. */
  }
  for (const listener of listeners) listener()
}
const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))
export async function addUploads(files: File[], libraryId: number, destination: string) {
  if (files.length > 10000) throw new Error('Choose at most 10,000 files at once.')
  const resumed = new Set<File>()
  for (const file of files) {
    const target = [destination, file.webkitRelativePath || file.name].filter(Boolean).join('/')
    const previous = queue.find(
      item =>
        item.libraryId === libraryId &&
        item.target === target &&
        item.size === file.size &&
        item.lastModified === file.lastModified &&
        !['completed', 'cancelled'].includes(item.state),
    )
    if (previous) {
      update(previous.key, { file, state: 'queued', error: undefined })
      resumed.add(file)
    }
  }
  const folders = new Set<string>()
  for (const file of files.filter(file => !resumed.has(file))) {
    const parts = (file.webkitRelativePath || file.name).split('/')
    parts.pop()
    if (parts.length > 127) throw new Error('Folder upload exceeds the depth limit.')
    for (let depth = 1; depth <= parts.length; depth++)
      folders.add([destination, ...parts.slice(0, depth)].filter(Boolean).join('/'))
  }
  for (const source of folders) {
    try {
      const operation = await request<OperationAccepted>('/api/files/operations', undefined, 'POST', {
        libraryId,
        kind: 'mkdir',
        source,
      })
      await waitForOperation(operation.id)
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409 || !error.message.includes('destination already exists'))
        throw error
    }
  }
  for (const file of files.filter(file => !resumed.has(file))) {
    const key = `upload-${Date.now()}-${++sequence}`
    queue = [
      ...queue,
      {
        key,
        libraryId,
        target: [destination, file.webkitRelativePath || file.name].filter(Boolean).join('/'),
        file,
        size: file.size,
        lastModified: file.lastModified,
        offset: 0,
        state: 'queued',
      },
    ]
    update(key, {})
  }
  pump()
}
function pump() {
  while (workers < 2) {
    const item = queue.find(item => item.state === 'queued' && item.file)
    if (!item) break
    workers++
    update(item.key, { state: 'uploading' })
    void transfer(item).finally(() => {
      workers--
      pump()
    })
  }
}
async function transfer(item: QueuedUpload) {
  const controller = new AbortController()
  update(item.key, { controller })
  try {
    let session = item.id
      ? await request<Session>(`/api/files/uploads/${item.id}`, controller.signal)
      : await request<Session>('/api/files/uploads', controller.signal, 'POST', {
          libraryId: item.libraryId,
          target: item.target,
          sizeBytes: item.size,
        })
    update(item.key, { id: session.id, offset: session.committedOffset })
    if (session.state === 'paused')
      session = await request<Session>(`/api/files/uploads/${session.id}/resume`, controller.signal, 'POST')
    if (session.state === 'cancelled') throw new Error('This server upload was cancelled. Start a new upload.')
    let offset = session.committedOffset
    let failures = 0
    const start = performance.now(),
      initial = offset
    while (offset < item.size && !['completed', 'finalizing'].includes(session.state)) {
      controller.signal.throwIfAborted()
      try {
        const response = await fetch(`/api/files/uploads/${session.id}?offset=${offset}`, {
          method: 'PATCH',
          signal: controller.signal,
          headers: {
            ...mutationHeaders('/api/files/uploads'),
            'Content-Type': 'application/octet-stream',
            Accept: 'application/json',
          },
          body: item.file!.slice(offset, Math.min(offset + 8 * 1024 * 1024, item.size)),
        })
        if (!response.ok) {
          const problem = (await response.json().catch(() => ({}))) as { title?: string }
          throw new Error(problem.title ?? `Upload failed (${response.status}).`)
        }
        session = (await response.json()) as Session
        offset = session.committedOffset
        failures = 0
        update(item.key, { offset, speed: (offset - initial) / Math.max((performance.now() - start) / 1000, 0.1) })
      } catch (error) {
        controller.signal.throwIfAborted()
        if (++failures > 4) throw error
        await sleep(1000 * 2 ** (failures - 1))
        session = await request<Session>(`/api/files/uploads/${session.id}`, controller.signal)
        offset = session.committedOffset
      }
    }
    for (let attempt = 0; session.state !== 'completed'; attempt++) {
      controller.signal.throwIfAborted()
      try {
        if (session.state !== 'finalizing')
          session = await request<Session>(`/api/files/uploads/${session.id}/finalize`, controller.signal, 'POST')
        update(item.key, { state: 'finalizing' })
        await waitForOperation(session.operationId!, controller.signal)
        break
      } catch (error) {
        if (attempt >= 4) throw error
        await sleep(1000 * 2 ** attempt)
        session = await request<Session>(`/api/files/uploads/${session.id}`, controller.signal)
      }
    }
    update(item.key, { state: 'completed', offset: item.size, controller: undefined, file: undefined })
  } catch (error) {
    if (!['paused', 'cancelled'].includes(queue.find(entry => entry.key === item.key)?.state ?? ''))
      update(item.key, {
        state: 'failed',
        controller: undefined,
        error: error instanceof Error ? error.message : 'Upload interrupted.',
      })
  }
}
export async function uploadAction(key: string, action: 'pause' | 'resume' | 'cancel') {
  const item = queue.find(item => item.key === key)
  if (!item) return
  if (action === 'resume') {
    if (!item.file) {
      update(key, { state: 'reselect' })
      return
    }
    if (item.id) await request(`/api/files/uploads/${item.id}/resume`, undefined, 'POST')
    update(key, { state: 'queued', error: undefined })
    pump()
    return
  }
  update(key, { state: action === 'pause' ? 'paused' : 'cancelled' })
  item.controller?.abort()
  if (item.id) await request(`/api/files/uploads/${item.id}/${action}`, undefined, 'POST')
}
