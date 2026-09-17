import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePreviewPriority } from './usePreviewPriority'
import type { Media } from './api'

const media = (id: number, status: string) => ({ id, thumbnail: { status }, preview: { status } } as Media)

function Probe({ items }: { items: Media[] }) { usePreviewPriority(items); return null }

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('requests preparation for pending previews in the order they are shown', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)
  const items = [media(9, 'ready'), media(4, 'pending'), media(1, 'pending'), media(7, 'pending')]
  const { rerender } = render(<Probe items={items} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(400) })

  expect(fetch).toHaveBeenCalledTimes(1)
  expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toEqual({ ids: [4, 1, 7] })

  // The same batch is not re-sent while nothing has changed.
  rerender(<Probe items={[...items]} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(400) })
  expect(fetch).toHaveBeenCalledTimes(1)

  // Scrolling re-orders the batch, and only the settled order is sent.
  rerender(<Probe items={[items[3], items[1], items[2]]} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(100) })
  rerender(<Probe items={[items[2], items[3], items[1]]} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(400) })
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(JSON.parse(String(fetch.mock.calls[1][1].body))).toEqual({ ids: [1, 7, 4] })
})

it('stays quiet when every preview is ready and retries a failed batch a bounded number of times', async () => {
  const fetch = vi.fn().mockRejectedValue(new Error('offline'))
  vi.stubGlobal('fetch', fetch)
  const { rerender } = render(<Probe items={[media(2, 'ready')]} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(400) })
  expect(fetch).not.toHaveBeenCalled()

  rerender(<Probe items={[media(2, 'pending')]} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(400) })
  expect(fetch).toHaveBeenCalledTimes(1)
  for (const expected of [2, 3, 4]) {
    await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
    expect(fetch).toHaveBeenCalledTimes(expected)
  }
  await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
  expect(fetch).toHaveBeenCalledTimes(4)
})
