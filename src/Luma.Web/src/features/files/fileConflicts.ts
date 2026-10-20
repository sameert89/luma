import { ApiError } from '../../lib/api/client'

export type ConflictChoice = 'replace' | 'skip'
export type Conflict = { id: number; batch: string; target: string }
type Pending = Conflict & { resolve: (choice: ConflictChoice) => void; abort?: () => void }
const listeners = new Set<() => void>()
const policies = new Map<string, ConflictChoice>()
let pending: Pending[] = []
let snapshot: Conflict[] = []
let sequence = 0
export const conflictSnapshot = () => snapshot
export const subscribeConflicts = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function publish() {
  snapshot = pending.map(({ id, batch, target }) => ({ id, batch, target }))
  for (const listener of listeners) listener()
}
export const conflictBatch = () => `files-${Date.now()}-${++sequence}`
export function chooseConflict(choice: ConflictChoice, all: boolean) {
  const current = pending[0]
  if (!current) return
  if (all) {
    if (policies.size >= 128) policies.delete(policies.keys().next().value!)
    policies.set(current.batch, choice)
  }
  const resolved = pending.filter(item => item.id === current.id || (all && item.batch === current.batch))
  pending = pending.filter(item => !resolved.includes(item))
  for (const item of resolved) { item.abort?.(); item.resolve(choice) }
  publish()
}
function ask(batch: string, target: string, signal?: AbortSignal): Promise<ConflictChoice> {
  signal?.throwIfAborted()
  const policy = policies.get(batch)
  if (policy) return Promise.resolve(policy)
  return new Promise((resolve, reject) => {
    const id = ++sequence
    const abort = () => {
      pending = pending.filter(item => item.id !== id)
      publish()
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    pending = [...pending, { id, batch, target, resolve, abort: () => signal?.removeEventListener('abort', abort) }]
    publish()
  })
}
const temporary = new Set(['path_busy', 'queue_full', 'upload_capacity'])
export async function waitForFileSlot<T>(action: () => Promise<T>, signal?: AbortSignal, waiting?: () => void): Promise<T> {
  let attempts = 0
  while (true) {
    signal?.throwIfAborted()
    try { return await action() }
    catch (error) {
      if (!(error instanceof ApiError) || !temporary.has(error.problem?.code ?? '')) throw error
      waiting?.()
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')) }
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, Math.min(5000, 500 * 2 ** Math.min(attempts++, 4)))
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) abort()
      })
    }
  }
}
export async function withFileConflict<T>(
  action: (replaceExisting: boolean) => Promise<T>,
  options: { batch: string; target: string; signal?: AbortSignal; waiting?: () => void; conflicting?: () => void },
): Promise<T | null> {
  try { return await waitForFileSlot(() => action(false), options.signal, options.waiting) }
  catch (error) {
    if (!(error instanceof ApiError) || !['destination_exists', 'indexed_destination_exists'].includes(error.problem?.code ?? '')) throw error
    options.conflicting?.()
    if (await ask(options.batch, options.target, options.signal) === 'skip') return null
    return waitForFileSlot(() => action(true), options.signal, options.waiting)
  }
}
