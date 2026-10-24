import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

it('skips an existing upload destination without creating a session or publishing bytes', async () => {
  localStorage.clear()
  vi.resetModules()
  const { ApiError } = await import('../../lib/api/client')
  mocks.request.mockReset().mockRejectedValue(new ApiError(409, { code: 'destination_exists', traceId: 'test' }))
  const queue = await import('./uploadQueue')
  const conflicts = await import('../files/fileConflicts')
  await queue.addUploads([new File([], 'existing.jpg')], 1, '')
  await waitFor(() => expect(conflicts.conflictSnapshot()).toHaveLength(1))
  conflicts.chooseConflict('skip', false)
  await waitFor(() => expect(queue.uploadSnapshot()[0].state).toBe('skipped'))
  expect(mocks.request).toHaveBeenCalledOnce()
  expect(JSON.parse(localStorage.getItem('luma-upload-sessions-v1')!)).toEqual([])
})

it('carries an explicit Replace choice from upload admission through finalization', async () => {
  localStorage.clear()
  vi.resetModules()
  const { ApiError } = await import('../../lib/api/client')
  mocks.waitForOperation.mockReset().mockResolvedValue(undefined)
  mocks.request.mockReset().mockImplementation(async (path: string, _signal, _method, body) => {
    if (path === '/api/files/uploads' && !body.replaceExisting)
      throw new ApiError(409, { code: 'destination_exists', traceId: 'test' })
    if (path.includes('/finalize'))
      return { id: 'session', state: 'finalizing', committedOffset: 0, operationId: 'publication' }
    return { id: 'session', state: 'waitingForClient', committedOffset: 0 }
  })
  const queue = await import('./uploadQueue')
  const conflicts = await import('../files/fileConflicts')
  await queue.addUploads([new File([], 'existing.jpg')], 1, '')
  await waitFor(() => expect(conflicts.conflictSnapshot()).toHaveLength(1))
  conflicts.chooseConflict('replace', true)
  await waitFor(() => expect(queue.uploadSnapshot()[0].state).toBe('completed'))
  expect(mocks.request.mock.calls.some(call => call[0] === '/api/files/uploads' && call[3]?.replaceExisting)).toBe(true)
  expect(
    mocks.request.mock.calls.some(call => call[0] === '/api/files/uploads/session/finalize?replaceExisting=true'),
  ).toBe(true)
})

describe('resuming batches and waiting for a busy server', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
    mocks.request.mockReset()
    mocks.waitForOperation.mockReset().mockResolvedValue(undefined)
  })
  afterEach(() => vi.useRealTimers())

  it('reattaches a closed browser batch to its existing session IDs without creating duplicates', async () => {
    const files = Array.from({ length: 12 }, (_, i) => new File([], `photo-${i}.jpg`, { lastModified: 123 }))
    localStorage.setItem(
      'luma-upload-sessions-v1',
      JSON.stringify(
        files.map((file, i) => ({
          key: `saved-${i}`,
          id: `session-${i}`,
          requestId: `session-${i}`,
          libraryId: 1,
          target: `photos/${file.name}`,
          size: 0,
          lastModified: 123,
          offset: 0,
        })),
      ),
    )
    mocks.request.mockImplementation(async (path: string) => ({
      id: path.split('/')[4],
      committedOffset: 0,
      state: path.endsWith('/finalize') ? 'finalizing' : 'waitingForClient',
      operationId: 'operation',
    }))
    const queue = await import('./uploadQueue')
    await queue.addUploads(files, 1, '/photos/')
    await waitFor(() => expect(queue.uploadSnapshot().every(item => item.state === 'completed')).toBe(true))
    expect(queue.uploadSnapshot()).toHaveLength(12)
    expect(mocks.request.mock.calls.some(call => call[0] === '/api/files/uploads')).toBe(false)
  })

  it('resumes a partial paused upload at the server checkpoint through the per-item file picker', async () => {
    localStorage.setItem(
      'luma-upload-sessions-v1',
      JSON.stringify([
        {
          key: 'saved',
          id: 'session',
          libraryId: 1,
          target: 'photos/original.jpg',
          size: 6,
          lastModified: 123,
          offset: 0,
        },
      ]),
    )
    mocks.request.mockImplementation(async (path: string) => ({
      id: 'session',
      committedOffset: path.endsWith('/finalize') ? 6 : 3,
      state: path.endsWith('/finalize') ? 'finalizing' : path.endsWith('/resume') ? 'waitingForClient' : 'paused',
      operationId: 'operation',
    }))
    const patch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'session', committedOffset: 6, state: 'waitingForClient' })))
    vi.stubGlobal('fetch', patch)
    const queue = await import('./uploadQueue')
    queue.resumeUpload('saved', new File(['abcdef'], 'original.jpg', { lastModified: 123 }))
    await waitFor(() => expect(queue.uploadSnapshot()[0].state).toBe('completed'))
    expect(patch).toHaveBeenCalledWith(
      '/api/files/uploads/session?offset=3',
      expect.objectContaining({ method: 'PATCH' }),
    )
    expect(patch.mock.calls[0][1].body.size).toBe(3)
    expect(mocks.request.mock.calls.some(call => call[0] === '/api/files/uploads')).toBe(false)
    expect(queue.uploadSnapshot()).toHaveLength(1)
  })

  it('rejects a different version rather than appending its bytes or creating a blocked duplicate', async () => {
    localStorage.setItem(
      'luma-upload-sessions-v1',
      JSON.stringify([
        { key: 'saved', id: 'session', libraryId: 1, target: 'original.jpg', size: 3, lastModified: 123, offset: 2 },
      ]),
    )
    const queue = await import('./uploadQueue')
    const changed = new File(['abc'], 'original.jpg', { lastModified: 456 })
    await expect(queue.resumeUpload('saved', changed)).rejects.toThrow('same size and modification date')
    await expect(queue.addUploads([changed], 1, '')).rejects.toThrow('unfinished upload')
    expect(queue.uploadSnapshot()).toHaveLength(1)
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('does not start another worker when the same active file is selected twice', async () => {
    let accept!: (value: unknown) => void
    mocks.request.mockImplementation((path: string) =>
      path === '/api/files/uploads'
        ? new Promise(resolve => {
            accept = resolve
          })
        : Promise.resolve({ id: 'session', committedOffset: 0, state: 'finalizing', operationId: 'operation' }),
    )
    const queue = await import('./uploadQueue')
    const file = new File([], 'same.jpg', { lastModified: 123 })
    await queue.addUploads([file], 1, '')
    await queue.addUploads([file], 1, '')
    expect(mocks.request).toHaveBeenCalledOnce()
    accept({ id: 'session', committedOffset: 0, state: 'waitingForClient' })
    await waitFor(() => expect(queue.uploadSnapshot()[0].state).toBe('completed'))
    expect(queue.uploadSnapshot()).toHaveLength(1)
  })

  it('automatically completes a 12-file batch when admission starts returning database busy after file seven', async () => {
    vi.useFakeTimers()
    const { ApiError } = await import('../../lib/api/client')
    const attempts = new Map<string, number>()
    mocks.request.mockImplementation(async (path: string, _signal, _method, body) => {
      if (path === '/api/files/uploads') {
        const count = (attempts.get(body.target) ?? 0) + 1
        attempts.set(body.target, count)
        if (Number(body.target.match(/\d+/)[0]) >= 7 && count <= 3)
          throw new ApiError(503, { code: 'database_busy', title: 'Luma is busy. Please try again.', traceId: 'test' })
        return { id: body.requestId, committedOffset: 0, state: 'waitingForClient' }
      }
      return { id: path.split('/')[4], committedOffset: 0, state: 'finalizing', operationId: 'operation' }
    })
    const queue = await import('./uploadQueue')
    await queue.addUploads(
      Array.from({ length: 12 }, (_, i) => new File([], `file-${i}.jpg`)),
      1,
      '',
    )
    await vi.advanceTimersByTimeAsync(30000)
    expect(queue.uploadSnapshot()).toHaveLength(12)
    expect(queue.uploadSnapshot().every(item => item.state === 'completed')).toBe(true)
    expect(attempts.get('file-11.jpg')).toBe(4)
  })
})

it('recovers the actual server session from an old duplicated queue and retires unadmitted aliases', async () => {
  localStorage.clear()
  vi.resetModules()
  const { ApiError } = await import('../../lib/api/client')
  localStorage.setItem(
    'luma-upload-sessions-v1',
    JSON.stringify([
      {
        key: 'duplicate',
        requestId: 'unadmitted',
        libraryId: 1,
        target: 'same.jpg',
        size: 0,
        lastModified: 123,
        offset: 0,
      },
      { key: 'original', id: 'actual', libraryId: 1, target: 'same.jpg', size: 0, lastModified: 123, offset: 0 },
    ]),
  )
  mocks.waitForOperation.mockResolvedValue(undefined)
  mocks.request.mockReset().mockImplementation(async (path: string) => {
    if (path.endsWith('/unadmitted')) throw new ApiError(404)
    return {
      id: 'actual',
      committedOffset: 0,
      state: path.endsWith('/finalize') ? 'finalizing' : 'waitingForClient',
      operationId: 'operation',
    }
  })
  const queue = await import('./uploadQueue')
  await queue.resumeUpload('duplicate', new File([], 'same.jpg', { lastModified: 123 }))
  await waitFor(() => expect(queue.uploadSnapshot().find(item => item.key === 'original')?.state).toBe('completed'))
  expect(queue.uploadSnapshot().find(item => item.key === 'duplicate')?.state).toBe('cancelled')
  expect(mocks.request.mock.calls.some(call => call[0] === '/api/files/uploads')).toBe(false)
})

it('re-queries the committed offset after a busy chunk response instead of resending saved bytes', async () => {
  localStorage.clear()
  vi.resetModules()
  vi.useFakeTimers()
  try {
    mocks.waitForOperation.mockResolvedValue(undefined)
    mocks.request.mockReset().mockImplementation(async (path: string, _signal, _method, body) => {
      if (path === '/api/files/uploads') return { id: body.requestId, committedOffset: 0, state: 'waitingForClient' }
      return {
        id: path.split('/')[4],
        committedOffset: 3,
        state: path.endsWith('/finalize') ? 'finalizing' : 'waitingForClient',
        operationId: 'operation',
      }
    })
    const patch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'database_busy', title: 'Luma is busy. Please try again.' }), {
        status: 503,
      }),
    )
    vi.stubGlobal('fetch', patch)
    const queue = await import('./uploadQueue')
    await queue.addUploads([new File(['abc'], 'original.jpg')], 1, '')
    await vi.advanceTimersByTimeAsync(10000)
    expect(queue.uploadSnapshot()[0].state).toBe('completed')
    expect(patch).toHaveBeenCalledOnce()
    expect(mocks.request.mock.calls.some(call => call[0].endsWith('/finalize'))).toBe(true)
  } finally {
    vi.useRealTimers()
  }
})
