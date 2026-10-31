import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, useState, type PropsWithChildren } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useReadingSession } from './useReadingSession'
import { request } from '../browse/api'
vi.mock('../browse/api', () => ({ request: vi.fn(), errorMessage: (error: Error) => error.message }))
const send = vi.mocked(request)
const updates = () =>
  send.mock.calls.map(call => call[3] as { pageIndex: number; sequence: number; activeSeconds: number })
function ReadingTestProvider({ children }: PropsWithChildren) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }))
  return createElement(QueryClientProvider, { client }, children)
}
async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('reading checkpoints', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    send.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })
  it('saves page changes and drains a final page after an in-flight request', async () => {
    let finish!: () => void
    send.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finish = resolve
        }),
    )
    const reader = renderHook(({ page }) => useReadingSession(1, page, 'rtl', { mode: 'single' }), {
      wrapper: ReadingTestProvider,
      initialProps: { page: 0 },
    })
    reader.rerender({ page: 7 })
    reader.unmount()
    finish()
    await settle()
    expect(updates().at(-1)?.pageIndex).toBe(7)
    expect(updates().at(-1)?.sequence).toBeGreaterThan(1)
  })
  it('retries the same checkpoint after a dropped response, then saves the current page', async () => {
    send.mockRejectedValueOnce(new Error('offline'))
    const reader = renderHook(({ page }) => useReadingSession(1, page, 'ltr', {}), {
      wrapper: ReadingTestProvider,
      initialProps: { page: 0 },
    })
    await settle()
    const checkpoint = send.mock.calls[0][3]
    reader.rerender({ page: 2 })
    await settle()
    expect(send.mock.calls[1][3]).toEqual(checkpoint)
    expect(updates().at(-1)?.pageIndex).toBe(2)
  })
  it('saves on HTTP hosts where randomUUID is unavailable', async () => {
    const random = crypto.getRandomValues.bind(crypto)
    vi.stubGlobal('crypto', { getRandomValues: random })
    const reader = renderHook(() => useReadingSession(7, 4, 'ltr', {}), { wrapper: ReadingTestProvider })
    await settle()
    await act(async () => {
      await reader.result.current.flush()
    })
    expect(send.mock.calls[0][3]).toMatchObject({
      pageIndex: 4,
      sessionId: expect.stringMatching(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/),
    })
    reader.unmount()
    vi.unstubAllGlobals()
  })
  it('aborts a stalled save, retries the same sequence and drains the latest page', async () => {
    let signal!: AbortSignal
    send.mockImplementationOnce((_path, requestSignal) => {
      signal = requestSignal!
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    const reader = renderHook(({ page }) => useReadingSession(1, page, 'ltr', {}), {
      wrapper: ReadingTestProvider,
      initialProps: { page: 0 },
    })
    reader.rerender({ page: 30 })
    const checkpoint = send.mock.calls[0][3]
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000)
    })
    expect(signal.aborted).toBe(true)
    expect(reader.result.current.error).not.toBe('')
    expect(localStorage.getItem('luma-panels-checkpoint-1')).toContain('"pageIndex":30')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(send.mock.calls[1][3]).toEqual(checkpoint)
    expect(updates().at(-1)?.pageIndex).toBe(30)
    expect(reader.result.current.error).toBe('')
    expect(localStorage.getItem('luma-panels-checkpoint-1')).toBeNull()
  })
  it('retries a failed save without another page turn or heartbeat', async () => {
    send.mockRejectedValueOnce(new Error('offline'))
    const reader = renderHook(() => useReadingSession(1, 20, 'ltr', {}), { wrapper: ReadingTestProvider })
    await settle()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(updates().at(-1)?.pageIndex).toBe(20)
    expect(reader.result.current.error).toBe('')
  })
  it.each(['focus', 'online'])('retries immediately on %s', async event => {
    send.mockRejectedValueOnce(new Error('offline'))
    const reader = renderHook(() => useReadingSession(1, 20, 'ltr', {}), { wrapper: ReadingTestProvider })
    await settle()
    act(() => {
      window.dispatchEvent(new Event(event))
    })
    await settle()
    expect(reader.result.current.error).toBe('')
    expect(updates().at(-1)?.pageIndex).toBe(20)
  })
  it('retains the latest local position when the final server save fails', async () => {
    send.mockRejectedValue(new Error('offline'))
    const reader = renderHook(({ page }) => useReadingSession(1, page, 'ltr', {}), {
      wrapper: ReadingTestProvider,
      initialProps: { page: 0 },
    })
    await settle()
    reader.rerender({ page: 30 })
    await settle()
    reader.unmount()
    await settle()
    expect(JSON.parse(localStorage.getItem('luma-panels-checkpoint-1')!)).toMatchObject({ pageIndex: 30 })
    const calls = send.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000)
    })
    expect(send).toHaveBeenCalledTimes(calls)
  })
  it('does not clear a newer local position when an older save completes', async () => {
    let finish!: () => void
    send.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          finish = resolve
        }),
    )
    const reader = renderHook(({ page }) => useReadingSession(1, page, 'ltr', {}), {
      wrapper: ReadingTestProvider,
      initialProps: { page: 0 },
    })
    reader.rerender({ page: 30 })
    finish()
    await settle()
    expect(updates().at(-1)?.pageIndex).toBe(30)
    expect(JSON.parse(localStorage.getItem('luma-panels-checkpoint-1')!)).toMatchObject({ pageIndex: 30 })
    finish()
    await settle()
    expect(localStorage.getItem('luma-panels-checkpoint-1')).toBeNull()
    send.mockResolvedValue(undefined)
  })
  it('continues saving to the server when local storage is unavailable', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('disabled')
    })
    try {
      renderHook(() => useReadingSession(1, 30, 'ltr', {}), { wrapper: ReadingTestProvider })
      await settle()
      expect(updates().at(-1)?.pageIndex).toBe(30)
    } finally {
      storage.mockRestore()
    }
  })
  it('counts visible time, excludes hidden intervals and stops after inactivity', async () => {
    renderHook(() => useReadingSession(1, 0, 'ltr', {}), { wrapper: ReadingTestProvider })
    await settle()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await settle()
    expect(updates().at(-1)?.activeSeconds).toBe(5)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000)
    })
    expect(updates().at(-1)?.activeSeconds).toBe(0)
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150000)
    })
    expect(updates().at(-1)?.activeSeconds).toBe(0)
    const total = updates().reduce((sum, update) => sum + update.activeSeconds, 0)
    expect(total).toBeLessThanOrEqual(105)
  })
})
