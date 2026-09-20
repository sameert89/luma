import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { Reels } from './Reels'
import type { Media } from './api'

beforeEach(() => localStorage.clear())

function clip(id: number): Media {
  return {
    id,
    libraryId: 1,
    folderId: 1,
    fileName: `${id}.mp4`,
    mediaType: 'video',
    extension: '.mp4',
    sizeBytes: 1024,
    width: 640,
    height: 480,
    durationMs: 10000,
    modifiedAt: '2026-01-01T00:00:00Z',
    effectiveDate: '2026-01-01T00:00:00Z',
    capturedAt: null,
    preference: 'neutral',
    availability: 'present',
    preview: { status: 'ready', url: `/poster-${id}.jpg`, width: 640, height: 480 },
    thumbnail: { status: 'ready', url: `/thumb-${id}.jpg`, width: 160, height: 120 },
    tags: [],
  }
}

it('shows a styled empty state with a direct route to filters', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [], nextCursor: null, previousCursor: null }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
  const filters = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(
    <QueryClientProvider client={client}>
      <Reels filters={{ mediaType: 'motion' }} onFilters={filters} onOpenViewer={vi.fn()} />
    </QueryClientProvider>,
  )
  const heading = await screen.findByRole('heading', { name: 'No reels to show' })
  expect(heading.closest('section')).toHaveClass('bg-black')
  expect(heading.closest('section')).toHaveTextContent('No photos or videos match this view.')
  await userEvent.click(screen.getByRole('button', { name: 'Adjust filters' }))
  expect(filters).toHaveBeenCalledOnce()
})

it('restores the current reel, mute and auto-scroll after leaving and returning, and resets position for changed filters', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  const items = [1, 2].map(clip)
  const fetch = vi.fn().mockImplementation((url: string) => {
    const id = Number(url.match(/media\/(\d+)/)?.[1] ?? 1)
    const data = url.includes('/neighbors?')
      ? { previous: items[id - 2] ?? null, next: items[id] ?? null }
      : /media\/\d+$/.test(url)
        ? items[id - 1]
        : { items: [items[0]] }
    return Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }))
  })
  vi.stubGlobal('fetch', fetch)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const mount = (filters = { mediaType: 'video', order: 'asc' }) =>
    render(
      <QueryClientProvider client={client}>
        <Reels filters={filters} onFilters={vi.fn()} onOpenViewer={vi.fn()} />
      </QueryClientProvider>,
    )
  try {
    const first = mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Reels menu' }))
    await userEvent.click(screen.getByRole('button', { name: 'Unmute' }))
    await userEvent.click(screen.getByRole('button', { name: 'Auto-scroll' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByLabelText('2.mp4')
    first.unmount()
    const feedsBefore = fetch.mock.calls.filter(([url]) => url.startsWith('/api/media?')).length
    const returned = mount()
    expect(await screen.findByLabelText('2.mp4')).toHaveProperty('muted', false)
    await userEvent.click(screen.getByRole('button', { name: 'Reels menu' }))
    expect(screen.getByRole('button', { name: 'Mute' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Auto-scroll' })).toHaveAttribute('aria-pressed', 'true')
    expect(fetch.mock.calls.filter(([url]) => url.startsWith('/api/media?'))).toHaveLength(feedsBefore)
    returned.unmount()
    mount({ mediaType: 'video', order: 'desc' })
    expect(await screen.findByLabelText('1.mp4')).toHaveProperty('muted', false)
  } finally {
    vi.restoreAllMocks()
    client.clear()
  }
})

it('retains only current query data and one nearby preview during sequential browsing', async () => {
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  const items = Array.from(
    { length: 12 },
    (_, index) =>
      ({
        id: index + 1,
        fileName: `item-${index}.mp4`,
        mediaType: 'video',
        width: 640,
        height: 480,
        preference: 'neutral',
        thumbnail: { url: `/cache/${index}-thumb.webp`, status: 'ready' },
        preview: { url: `/cache/${index}.jpg`, status: 'ready' },
        tags: [],
      }) as unknown as Media,
  )
  const preloads: HTMLImageElement[] = []
  vi.stubGlobal('Image', function () {
    const image = document.createElement('img')
    preloads.push(image)
    return image
  })
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      const id = Number(url.match(/media\/(\d+)/)?.[1] ?? 1)
      const data = url.includes('/neighbors?')
        ? { previous: items[id - 2] ?? null, next: items[id] ?? null }
        : /media\/\d+$/.test(url)
          ? items[id - 1]
          : { items: [items[0]] }
      return Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }))
    }),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  try {
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <Reels
          filters={{ q: 'item', order: 'asc', mediaType: 'video', libraryId: 1, folderId: 2 }}
          onFilters={vi.fn()}
          onOpenViewer={vi.fn()}
        />
      </QueryClientProvider>,
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Reels menu' }))
    const next = await screen.findByRole('button', { name: /^Next$/ })
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(([url]) => String(url).includes('mediaType=video') && String(url).includes('folderId=2')),
      ).toBe(true),
    )
    for (let index = 0; index < 10; index++) {
      await waitFor(() => expect(next).toBeEnabled())
      await userEvent.click(next)
      await waitFor(() => expect(screen.getByLabelText(items[index + 1].fileName)).toBeVisible())
      expect(document.querySelectorAll('video')).toHaveLength(1)
    }
    await waitFor(() => expect(client.getQueryCache().getAll().length).toBeLessThanOrEqual(4))
    expect(preloads.filter(image => image.hasAttribute('src'))).toHaveLength(1)
    unmount()
    expect(preloads.filter(image => image.hasAttribute('src'))).toHaveLength(0)
    expect(play).toHaveBeenCalled()
  } finally {
    vi.restoreAllMocks()
    client.clear()
  }
})

it('consolidates view options and closes tags with the cross, outside click and Escape', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  const item = clip(1)
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      const data = url.includes('/neighbors?')
        ? { previous: null, next: null }
        : /media\/\d+$/.test(url)
          ? item
          : { items: [item] }
      return Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }))
    }),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  try {
    render(
      <QueryClientProvider client={client}>
        <Reels filters={{}} onFilters={vi.fn()} onOpenViewer={vi.fn()} />
      </QueryClientProvider>,
    )
    const menu = await screen.findByRole('button', { name: 'Reels menu' })
    expect(menu).toHaveAttribute('aria-expanded', 'false')
    expect(menu.querySelector('svg')).toHaveClass('lucide-ellipsis-vertical')
    expect(screen.queryByRole('button', { name: 'More options' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View options' }).closest('[inert]')).not.toBeNull()
    fireEvent(screen.getByLabelText('1.mp4'), new Event('webkitbeginfullscreen'))
    expect(screen.queryByRole('button', { name: 'Reels menu' })).not.toBeInTheDocument()
    fireEvent(screen.getByLabelText('1.mp4'), new Event('webkitendfullscreen'))
    expect(screen.getByRole('button', { name: 'Reels menu' })).toBeVisible()
    await userEvent.click(menu)
    const closeMenu = screen.getByRole('button', { name: 'Close reels menu' })
    expect(closeMenu).toHaveAttribute('aria-expanded', 'true')
    expect(closeMenu.querySelector('svg')).toHaveClass('lucide-x')
    const viewOptions = screen.getByRole('button', { name: 'View options' })
    expect(viewOptions.querySelector('svg')).toHaveClass('lucide-settings-2')
    await userEvent.click(viewOptions)
    expect(screen.getByRole('dialog', { name: 'View options' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Playback speed' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'View options' })).not.toBeInTheDocument())
    const info = screen.getByRole('button', { name: 'Media information' })
    expect(info.querySelector('svg')).toHaveClass('lucide-info')
    await userEvent.click(info)
    expect(screen.getByRole('dialog', { name: 'Media information' })).toHaveTextContent('1.mp4')
    expect(screen.getByRole('dialog', { name: 'Media information' })).toHaveTextContent('640 × 480')
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Media information' })).not.toBeInTheDocument())
    expect(info).toHaveFocus()
    const tags = screen.getByRole('button', { name: 'Tags' })
    await userEvent.click(tags)
    const tagSheet = screen.getByRole('dialog', { name: 'Tags' })
    expect(tagSheet).toBeVisible()
    await userEvent.click(within(tagSheet).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tags' })).not.toBeInTheDocument())
    expect(tags).toHaveFocus()
    await userEvent.click(tags)
    // The shared sheet's full viewport container represents the area outside its panel.
    fireEvent.pointerDown(screen.getByRole('dialog', { name: 'Tags' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tags' })).not.toBeInTheDocument())
    await userEvent.click(tags)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tags' })).not.toBeInTheDocument())
    await userEvent.click(closeMenu)
    expect(screen.getByRole('button', { name: 'Reels menu' }).querySelector('svg')).toHaveClass(
      'lucide-ellipsis-vertical',
    )
    expect(screen.getByRole('button', { name: 'View options' }).closest('[inert]')).not.toBeNull()
  } finally {
    vi.restoreAllMocks()
    client.clear()
  }
})

it('keeps like and dislike on the stage beside a bottom menu, loops by default and warms only the next reel', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  const items = [1, 2].map(clip)
  const fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') return Promise.resolve(new Response(null, { status: 204 }))
    const id = Number(url.match(/media\/(\d+)/)?.[1] ?? 1)
    const data = url.includes('/neighbors?')
      ? { previous: items[id - 2] ?? null, next: items[id] ?? null }
      : /media\/\d+$/.test(url)
        ? items[id - 1]
        : { items: [items[0]] }
    return Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }))
  })
  vi.stubGlobal('fetch', fetch)
  const warmed: HTMLVideoElement[] = []
  const create = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((name: string, options?: ElementCreationOptions) => {
    const element = create(name, options)
    if (name === 'video') warmed.push(element as HTMLVideoElement)
    return element
  }) as typeof document.createElement)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  try {
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <Reels filters={{ mediaType: 'motion' }} onFilters={vi.fn()} onOpenViewer={vi.fn()} />
      </QueryClientProvider>,
    )
    const video = await screen.findByLabelText('1.mp4')
    expect(video).toHaveProperty('loop', true)
    // Rating is always one tap away; the menu toggle sits beside it rather than at the top.
    const like = screen.getByRole('button', { name: 'Like' })
    const dislike = screen.getByRole('button', { name: 'Dislike' })
    const menu = screen.getByRole('button', { name: 'Reels menu' })
    expect(like.closest('[inert]')).toBeNull()
    expect(dislike.parentElement).toBe(menu.parentElement)
    expect(like.parentElement).toBe(menu.parentElement)
    await userEvent.click(dislike)
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/media/1/preference',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ preference: 'disliked' }) }),
      ),
    )

    await waitFor(() =>
      expect(warmed.find(element => element.getAttribute('src') === '/api/media/2/original')).toBeDefined(),
    )
    const warm = warmed.find(element => element.getAttribute('src') === '/api/media/2/original')!
    expect(warm.preload).toBe('metadata')
    expect(document.querySelectorAll('video')).toHaveLength(1)

    // Auto-scroll turns looping off so the reel can end and advance.
    await userEvent.click(menu)
    await userEvent.click(screen.getByRole('button', { name: 'Auto-scroll' }))
    expect(video).toHaveProperty('loop', false)
    unmount()
    expect(warm.hasAttribute('src')).toBe(false)
    expect(load).toHaveBeenCalled()
  } finally {
    vi.restoreAllMocks()
    vi.useRealTimers()
    client.clear()
  }
})
