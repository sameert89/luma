import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePreviewPriority } from './usePreviewPriority'
import type { Media } from './api'

const media = (id: number, status: string, preview = status) => ({ id, mediaType: 'image', thumbnail: { status }, preview: { status: preview } } as Media)

function Probe({ items, previews = false }: { items: Media[]; previews?: boolean }) { usePreviewPriority(items, previews); return null }

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('requests preparation for pending previews in the order they are shown', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)
  const items = [media(9, 'ready'), media(4, 'pending'), media(1, 'pending'), media(7, 'pending')]
  const { rerender } = render(<Probe items={items} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(400) })

  expect(fetch).toHaveBeenCalledTimes(1)
  expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toEqual({ ids: [4, 1, 7], previews: false })

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
  expect(JSON.parse(String(fetch.mock.calls[1][1].body))).toEqual({ ids: [1, 7, 4], previews: false })
})

it('sends an item once when grouping shows it under several headings', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)
  // Tag grouping lists an item under each of its tags, so the visible window can repeat it.
  render(<Probe items={[media(4, 'pending'), media(1, 'pending'), media(4, 'pending')]} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(400) })
  expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toEqual({ ids: [4, 1], previews: false })
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

it('leaves previews to the viewer: the gallery asks only for thumbnails', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)
  // Indexed photos have thumbnails; their preview is prepared only once opened.
  const indexed = [media(3, 'ready', 'pending'), media(5, 'ready', 'evicted'), media(6, 'ready', 'failed')]
  const { rerender } = render(<Probe items={indexed} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(400) })
  expect(fetch).not.toHaveBeenCalled()

  rerender(<Probe items={indexed} previews />)
  await act(async () => { await vi.advanceTimersByTimeAsync(400) })
  expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toEqual({ ids: [3, 5], previews: true })
})
