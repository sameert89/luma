import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { Viewer } from './Viewer'
import type { Media } from './api'

vi.mock('./MediaStage', () => ({ MediaStage: () => <div /> }))

it('offers only the two explicit cover actions only inside media details', async () => {
  window.history.replaceState(null, '', '/')
  const media: Media = { id: 7, libraryId: 1, folderId: 3, fileName: 'photo.jpg', mediaType: 'image', extension: '.jpg', availability: 'present', preference: 'neutral',
    modifiedAt: '2026-01-01T00:00:00Z', effectiveDate: '2026-01-01T00:00:00Z', capturedAt: null, width: null, height: null, durationMs: null,
    sizeBytes: 100, tags: [], thumbnail: { status: 'ready', url: '/thumb', width: null, height: null }, preview: { status: 'ready', url: '/preview', width: null, height: null } }
  const fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') return Promise.resolve(new Response(null, { status: 204 }))
    const data = url === '/api/libraries' ? [{ id: 1, name: 'Photos', rootFolderId: 10 }]
      : url.includes('/neighbors?') ? { previous: null, next: null } : media
    return Promise.resolve(new Response(JSON.stringify(url === '/api/tasks' ? [] : data), { headers: { 'Content-Type': 'application/json' } }))
  })
  vi.stubGlobal('fetch', fetch)
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
    <Viewer active={media} filters={{ libraryId: 1, folderId: 2, recursive: true }} onChange={vi.fn()} onClose={vi.fn()} restoreFocus={vi.fn()} />
  </QueryClientProvider>)

  expect(screen.queryByRole('button', { name: /Use as .* cover/ })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Media details' }))
  expect(screen.getByRole('dialog', { name: 'Media details' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Dislike' }).querySelector('svg')).toHaveClass('lucide-heart-crack')

  const folder = screen.getByRole('button', { name: 'Use as folder cover' })
  const library = await screen.findByRole('button', { name: 'Use as library cover' })
  expect(folder).toBeVisible()
  expect(library).toBeVisible()
  expect(screen.getAllByRole('button', { name: /Use as .* cover/ })).toHaveLength(2)
  expect(screen.queryByRole('button', { name: /Automatic .* cover/ })).not.toBeInTheDocument()

  await userEvent.click(folder)
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/folders/2/cover', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ mediaId: 7 }) })))
  await waitFor(() => expect(library).toBeEnabled())
  await userEvent.click(library)
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/folders/10/cover', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ mediaId: 7 }) })))
})

it('runs a slideshow at the chosen pace, preloads the next slide and stops at the end', async () => {
  window.history.replaceState(null, '', '/')
  localStorage.setItem('luma-slideshow-seconds', '3')
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const photo = (id: number): Media => ({ id, libraryId: 1, folderId: 3, fileName: `${id}.jpg`, mediaType: 'image', extension: '.jpg', availability: 'present', preference: 'neutral',
    modifiedAt: '2026-01-01T00:00:00Z', effectiveDate: '2026-01-01T00:00:00Z', capturedAt: null, width: null, height: null, durationMs: null,
    sizeBytes: 100, tags: [], thumbnail: { status: 'ready', url: `/thumb-${id}`, width: null, height: null }, preview: { status: 'ready', url: `/preview-${id}`, width: null, height: null } })
  const items = [photo(1), photo(2)]
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    const id = Number(url.match(/media\/(\d+)/)?.[1] ?? 1)
    const data = url === '/api/tasks' || url === '/api/libraries' ? [] : url.includes('/neighbors?') ? { previous: items[id - 2] ?? null, next: items[id] ?? null } : items[id - 1]
    return Promise.resolve(new Response(JSON.stringify(url === '/api/tasks' ? [] : data), { headers: { 'Content-Type': 'application/json' } }))
  }))
  const preloads: HTMLImageElement[] = []
  vi.stubGlobal('Image', function () { const image = document.createElement('img'); preloads.push(image); return image })
  const onChange = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  try {
    const view = render(<QueryClientProvider client={client}><Viewer active={items[0]} filters={{}} startSlideshow onChange={onChange} onClose={vi.fn()} restoreFocus={vi.fn()} /></QueryClientProvider>)
    expect(screen.getByRole('button', { name: 'Slideshow' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Slide duration, 3 seconds' })).toBeVisible()
    await waitFor(() => expect(preloads.some(image => image.getAttribute('src') === '/preview-2')).toBe(true))
    expect(screen.queryByRole('button', { name: 'Watch on Reels' })).not.toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(onChange).toHaveBeenCalledWith(items[1])

    view.rerender(<QueryClientProvider client={client}><Viewer active={items[1]} filters={{}} startSlideshow onChange={onChange} onClose={vi.fn()} restoreFocus={vi.fn()} /></QueryClientProvider>)
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith('/api/media/2/neighbors'))).toBe(true))
    await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Slideshow' })).toHaveAttribute('aria-pressed', 'false'))
    expect(onChange).toHaveBeenCalledTimes(1)
  } finally { vi.useRealTimers(); client.clear() }
})

it('offers Watch on Reels for videos and GIFs', async () => {
  window.history.replaceState(null, '', '/')
  const gif = { id: 9, libraryId: 1, folderId: 3, fileName: 'loop.gif', mediaType: 'image', extension: '.gif', availability: 'present', preference: 'neutral',
    modifiedAt: '2026-01-01T00:00:00Z', effectiveDate: '2026-01-01T00:00:00Z', capturedAt: null, width: null, height: null, durationMs: null,
    sizeBytes: 100, tags: [], thumbnail: { status: 'ready', url: '/thumb', width: null, height: null }, preview: { status: 'ready', url: '/preview', width: null, height: null } } as Media
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(url === '/api/tasks' || url === '/api/libraries' ? [] : url.includes('/neighbors?') ? { previous: null, next: null } : gif), { headers: { 'Content-Type': 'application/json' } }))))
  const onWatchReels = vi.fn()
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
    <Viewer active={gif} filters={{}} onChange={vi.fn()} onClose={vi.fn()} onWatchReels={onWatchReels} restoreFocus={vi.fn()} />
  </QueryClientProvider>)
  await userEvent.click(screen.getByRole('button', { name: 'Watch on Reels' }))
  expect(onWatchReels).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }))
})

it('keeps rating and a bottom menu with navigation in one row, and shows dislike as an outline', async () => {
  window.history.replaceState(null, '', '/')
  const photo = { id: 5, libraryId: 1, folderId: 3, fileName: 'photo.jpg', mediaType: 'image', extension: '.jpg', availability: 'present', preference: 'disliked',
    modifiedAt: '2026-01-01T00:00:00Z', effectiveDate: '2026-01-01T00:00:00Z', capturedAt: null, width: null, height: null, durationMs: null,
    sizeBytes: 100, tags: [], thumbnail: { status: 'ready', url: '/thumb', width: null, height: null }, preview: { status: 'ready', url: '/preview', width: null, height: null } } as Media
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(url === '/api/tasks' || url === '/api/libraries' ? [] : url.includes('/neighbors?') ? { previous: null, next: null } : photo), { headers: { 'Content-Type': 'application/json' } }))))
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
    <Viewer active={photo} filters={{}} onChange={vi.fn()} onClose={vi.fn()} restoreFocus={vi.fn()} />
  </QueryClientProvider>)
  const like = screen.getByRole('button', { name: 'Like' })
  const dislike = screen.getByRole('button', { name: 'Dislike' })
  const menu = screen.getByRole('button', { name: 'Viewer menu' })
  expect(like.parentElement).toBe(menu.parentElement)
  expect(dislike).toHaveAttribute('aria-pressed', 'true')
  expect(dislike.querySelector('svg')).toHaveClass('text-danger')
  expect(dislike.querySelector('svg')).not.toHaveClass('fill-danger')
  // Navigation lives in the menu, with chevrons rather than arrows.
  for (const name of ['Previous item', 'Next item', 'Media details', 'View options'])
    expect(screen.getByRole('button', { name }).closest('[inert]')).not.toBeNull()
  expect(screen.getByRole('button', { name: 'Next item' }).querySelector('svg')).toHaveClass('lucide-chevron-right')
  await userEvent.click(menu)
  expect(screen.getByRole('button', { name: 'Close viewer menu' })).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('button', { name: 'Next item' }).closest('[inert]')).toBeNull()
})

