import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useReadingSession } from './useReadingSession'
import { request } from '../browse/api'
vi.mock('../browse/api', () => ({ request: vi.fn(), errorMessage: (error: Error) => error.message }))
const send = vi.mocked(request)
const updates = () =>
  send.mock.calls.map(call => call[3] as { pageIndex: number; sequence: number; activeSeconds: number })
async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('reading checkpoints', () => {
  beforeEach(() => {
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
    const reader = renderHook(({ page }) => useReadingSession(1, page, 'ltr', {}), { initialProps: { page: 0 } })
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
    const reader = renderHook(() => useReadingSession(7, 4, 'ltr', {}))
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
  it('counts visible time, excludes hidden intervals and stops after inactivity', async () => {
    renderHook(() => useReadingSession(1, 0, 'ltr', {}))
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
