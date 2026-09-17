import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { Reels } from './Reels'
import type { Media } from './api'

it('retains only current query data and one nearby preview during sequential browsing', async () => {
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  const items = Array.from({ length: 12 }, (_, index) => ({ id: index + 1, fileName: `item-${index}.mp4`, mediaType: 'video', width: 640, height: 480, preview: { url: `/cache/${index}.jpg`, status: 'ready' }, tags: [] }) as unknown as Media)
  const preloads: HTMLImageElement[] = []
  vi.stubGlobal('Image', function () { const image = document.createElement('img'); preloads.push(image); return image })
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    const id = Number(url.match(/media\/(\d+)/)?.[1] ?? 1)
    const data = url.includes('/neighbors?') ? { previous: items[id - 2] ?? null, next: items[id] ?? null } : /media\/\d+$/.test(url) ? items[id - 1] : { items: [items[0]] }
    return Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }))
  }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  try {
    const { unmount } = render(<QueryClientProvider client={client}><Reels filters={{ q: 'item', order: 'asc', mediaType: 'video', libraryId: 1, folderId: 2 }} onFilters={vi.fn()} onOpenViewer={vi.fn()} /></QueryClientProvider>)
    const next = await screen.findByRole('button', { name: /^Next$/ })
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('mediaType=video') && String(url).includes('folderId=2'))).toBe(true))
    for (let index = 0; index < 10; index++) {
      await waitFor(() => expect(next).toBeEnabled())
      await userEvent.click(next)
      await waitFor(() => expect(screen.getByLabelText(items[index + 1].fileName)).toBeVisible())
      expect(document.querySelectorAll('video')).toHaveLength(1)
    }
    await waitFor(() => expect(client.getQueryCache().getAll().length).toBeLessThanOrEqual(3))
    expect(preloads.filter(image => image.hasAttribute('src'))).toHaveLength(1)
    unmount()
    expect(preloads.filter(image => image.hasAttribute('src'))).toHaveLength(0)
    expect(play).toHaveBeenCalled()
  } finally {
    vi.restoreAllMocks()
    client.clear()
  }
})
