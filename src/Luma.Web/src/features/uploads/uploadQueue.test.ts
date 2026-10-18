import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
const mocks = vi.hoisted(() => ({ request: vi.fn(), waitForOperation: vi.fn() }))
vi.mock('../browse/api', () => ({ request: mocks.request }))
vi.mock('../files/operations', () => ({ waitForOperation: mocks.waitForOperation }))

describe('upload recovery', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
    mocks.request.mockReset()
    mocks.waitForOperation.mockReset().mockResolvedValue(undefined)
  })
  it('persists a request ID before creation and recovers a lost response after refresh', async () => {
    let session: Record<string, unknown> | undefined
    let dropped = false
    mocks.request.mockImplementation(
      async (path: string, _signal: unknown, _method: string, body: Record<string, unknown>) => {
        if (path === '/api/files/uploads') {
          session ??= { id: body.requestId, state: 'waitingForClient', committedOffset: 0 }
          if (!dropped) {
            dropped = true
            throw new Error('response dropped')
          }
          return session
        }
        if (path.endsWith('/finalize')) return { ...session, state: 'finalizing', operationId: 'operation' }
        return session
      },
    )
    const file = new File([], 'empty.txt', { lastModified: 10 })
    let queue = await import('./uploadQueue')
    await queue.addUploads([file], 1, '')
    await waitFor(() => expect(queue.uploadSnapshot()[0].state).toBe('failed'))
    const saved = JSON.parse(localStorage.getItem('luma-upload-sessions-v1')!)[0]
    expect(saved.requestId).toBe(session!.id)
    expect(saved.id).toBeUndefined()
    vi.resetModules()
    queue = await import('./uploadQueue')
    expect(queue.uploadSnapshot()[0].state).toBe('reselect')
    await queue.addUploads([file], 1, '')
    await waitFor(() => expect(queue.uploadSnapshot()[0].state).toBe('completed'))
    const creations = mocks.request.mock.calls.filter(call => call[0] === '/api/files/uploads')
    expect(creations[1][3].requestId).toBe(creations[0][3].requestId)
  })
  it('resumes a finalizing session without issuing an invalid resume command', async () => {
    localStorage.setItem(
      'luma-upload-sessions-v1',
      JSON.stringify([
        { key: 'pending', id: 'session', libraryId: 1, target: 'empty.txt', size: 0, lastModified: 10, offset: 0 },
      ]),
    )
    mocks.request.mockResolvedValue({
      id: 'session',
      committedOffset: 0,
      state: 'finalizing',
      operationId: 'operation',
    })
    const queue = await import('./uploadQueue')
    await queue.addUploads([new File([], 'empty.txt', { lastModified: 10 })], 1, '')
    await waitFor(() => expect(queue.uploadSnapshot()[0].state).toBe('completed'))
    expect(mocks.request.mock.calls.some(call => String(call[0]).endsWith('/resume'))).toBe(false)
    expect(mocks.waitForOperation).toHaveBeenCalledWith('operation', expect.any(AbortSignal))
  })
  it('keeps a cancellation failure visible and persisted', async () => {
    localStorage.setItem(
      'luma-upload-sessions-v1',
      JSON.stringify([
        { key: 'pending', id: 'session', libraryId: 1, target: 'empty.txt', size: 3, lastModified: 10, offset: 3 },
      ]),
    )
    mocks.request.mockRejectedValue(new Error('staging unavailable'))
    const queue = await import('./uploadQueue')
    await expect(queue.uploadAction('pending', 'cancel')).rejects.toThrow('staging unavailable')
    expect(queue.uploadSnapshot()[0].state).toBe('failed')
    expect(JSON.parse(localStorage.getItem('luma-upload-sessions-v1')!)[0].id).toBe('session')
  })
})

it('stops immediately when upload finalization is disabled by a mount check', async () => {
  localStorage.clear()
  vi.resetModules()
  const { ApiError } = await import('../../lib/api/client')
  mocks.request.mockReset().mockImplementation(async (path: string) => {
    if (path.endsWith('/finalize'))
      throw new ApiError(409, { code: 'media_not_writable', title: 'File changes disabled', traceId: 'test' })
    return { id: 'session', state: 'waitingForClient', committedOffset: 0 }
  })
  const queue = await import('./uploadQueue')
  await queue.addUploads([new File([], 'empty.txt')], 1, '')
  await waitFor(() => expect(queue.uploadSnapshot()[0].state).toBe('failed'))
  expect(queue.uploadSnapshot()[0].error).toBe('File changes disabled')
  expect(mocks.request.mock.calls.filter(call => call[0].endsWith('/finalize'))).toHaveLength(1)
})
