import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { Viewer } from './Viewer'
import type { Media } from './api'

// The stub records the stage's latest props so tests can play its events (a video ending).
const stage = vi.hoisted(() => ({ props: {} as Record<string, unknown> }))
vi.mock('./MediaStage', () => ({
  MediaStage: (props: Record<string, unknown>) => {
    stage.props = props
    return <div />
  },
}))

it('offers only the two explicit cover actions only inside media details', async () => {
  window.history.replaceState(null, '', '/')
  const media: Media = {
    id: 7,
    libraryId: 1,
    folderId: 3,
    fileName: 'photo.jpg',
    mediaType: 'image',
    extension: '.jpg',
    availability: 'present',
    preference: 'neutral',
    modifiedAt: '2026-01-01T00:00:00Z',
    effectiveDate: '2026-01-01T00:00:00Z',
    capturedAt: null,
    width: null,
    height: null,
    durationMs: null,
    sizeBytes: 100,
    tags: [],
    thumbnail: { status: 'ready', url: '/thumb', width: null, height: null },
    preview: { status: 'ready', url: '/preview', width: null, height: null },
  }
  const fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') return Promise.resolve(new Response(null, { status: 204 }))
    const data =
      url === '/api/libraries'
        ? [{ id: 1, name: 'Photos', rootFolderId: 10 }]
        : url.includes('/neighbors?')
          ? { previous: null, next: null }
          : media
    return Promise.resolve(
      new Response(JSON.stringify(url === '/api/tasks' ? [] : data), {
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
  vi.stubGlobal('fetch', fetch)
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <Viewer
        active={media}
        filters={{ libraryId: 1, folderId: 2, recursive: true }}
        onChange={vi.fn()}
        onClose={vi.fn()}
        restoreFocus={vi.fn()}
      />
    </QueryClientProvider>,
  )

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
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/folders/2/cover',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ mediaId: 7 }) }),
    ),
  )
  await waitFor(() => expect(library).toBeEnabled())
  await userEvent.click(library)
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/folders/10/cover',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ mediaId: 7 }) }),
    ),
  )
})

it('runs a slideshow at the chosen pace, preloads the next slide and stops at the end', async () => {
  window.history.replaceState(null, '', '/')
  localStorage.setItem('luma-slideshow-seconds', '3')
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const photo = (id: number): Media => ({
    id,
    libraryId: 1,
    folderId: 3,
    fileName: `${id}.jpg`,
    mediaType: 'image',
    extension: '.jpg',
    availability: 'present',
    preference: 'neutral',
    modifiedAt: '2026-01-01T00:00:00Z',
    effectiveDate: '2026-01-01T00:00:00Z',
    capturedAt: null,
    width: null,
    height: null,
    durationMs: null,
    sizeBytes: 100,
    tags: [],
    thumbnail: { status: 'ready', url: `/thumb-${id}`, width: null, height: null },
    preview: { status: 'ready', url: `/preview-${id}`, width: null, height: null },
  })
  const items = [photo(1), photo(2)]
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      const id = Number(url.match(/media\/(\d+)/)?.[1] ?? 1)
      const data =
        url === '/api/tasks' || url === '/api/libraries'
          ? []
          : url.includes('/neighbors?')
            ? { previous: items[id - 2] ?? null, next: items[id] ?? null }
            : items[id - 1]
      return Promise.resolve(
        new Response(JSON.stringify(url === '/api/tasks' ? [] : data), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }),
  )
  const preloads: HTMLImageElement[] = []
  vi.stubGlobal('Image', function () {
    const image = document.createElement('img')
    preloads.push(image)
    return image
  })
  const onChange = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  try {
    const view = render(
      <QueryClientProvider client={client}>
        <Viewer
          active={items[0]}
          filters={{}}
          startSlideshow
          onChange={onChange}
          onClose={vi.fn()}
          restoreFocus={vi.fn()}
        />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('button', { name: 'Slideshow' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Slide duration, 3 seconds' })).toBeVisible()
    await waitFor(() => expect(preloads.some(image => image.getAttribute('src') === '/preview-2')).toBe(true))
    expect(screen.queryByRole('button', { name: 'Watch on Flick' })).not.toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500)
    })
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(onChange).toHaveBeenCalledWith(items[1])

    view.rerender(
      <QueryClientProvider client={client}>
        <Viewer
          active={items[1]}
          filters={{}}
          startSlideshow
          onChange={onChange}
          onClose={vi.fn()}
          restoreFocus={vi.fn()}
        />
      </QueryClientProvider>,
    )
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith('/api/media/2/neighbors'))).toBe(true),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100)
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Slideshow' })).toHaveAttribute('aria-pressed', 'false'),
    )
    expect(onChange).toHaveBeenCalledTimes(1)
  } finally {
    vi.useRealTimers()
    client.clear()
  }
})

it('offers Watch on Flick for videos and GIFs', async () => {
  window.history.replaceState(null, '', '/')
  const gif = {
    id: 9,
    libraryId: 1,
    folderId: 3,
    fileName: 'loop.gif',
    mediaType: 'image',
    extension: '.gif',
    availability: 'present',
    preference: 'neutral',
    modifiedAt: '2026-01-01T00:00:00Z',
    effectiveDate: '2026-01-01T00:00:00Z',
    capturedAt: null,
    width: null,
    height: null,
    durationMs: null,
    sizeBytes: 100,
    tags: [],
    thumbnail: { status: 'ready', url: '/thumb', width: null, height: null },
    preview: { status: 'ready', url: '/preview', width: null, height: null },
  } as Media
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              url === '/api/tasks' || url === '/api/libraries'
                ? []
                : url.includes('/neighbors?')
                  ? { previous: null, next: null }
                  : gif,
            ),
            { headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      ),
  )
  const onWatchReels = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <Viewer
        active={gif}
        filters={{}}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onWatchReels={onWatchReels}
        restoreFocus={vi.fn()}
      />
    </QueryClientProvider>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Watch on Flick' }))
  expect(onWatchReels).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }))
})

it('keeps rating and a bottom menu with navigation in one row, and shows dislike as an outline', async () => {
  window.history.replaceState(null, '', '/')
  const photo = {
    id: 5,
    libraryId: 1,
    folderId: 3,
    fileName: 'photo.jpg',
    mediaType: 'image',
    extension: '.jpg',
    availability: 'present',
    preference: 'disliked',
    modifiedAt: '2026-01-01T00:00:00Z',
    effectiveDate: '2026-01-01T00:00:00Z',
    capturedAt: null,
    width: null,
    height: null,
    durationMs: null,
    sizeBytes: 100,
    tags: [],
    thumbnail: { status: 'ready', url: '/thumb', width: null, height: null },
    preview: { status: 'ready', url: '/preview', width: null, height: null },
  } as Media
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              url === '/api/tasks' || url === '/api/libraries'
                ? []
                : url.includes('/neighbors?')
                  ? { previous: null, next: null }
                  : photo,
            ),
            { headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      ),
  )
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <Viewer active={photo} filters={{}} onChange={vi.fn()} onClose={vi.fn()} restoreFocus={vi.fn()} />
    </QueryClientProvider>,
  )
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

it('autoplays the next video when one ends only while Autoplay is on, and remembers the choice', async () => {
  window.history.replaceState(null, '', '/')
  localStorage.removeItem('luma-video-autoplay')
  const video = (id: number): Media => ({
    id,
    libraryId: 1,
    folderId: 3,
    fileName: `${id}.mp4`,
    mediaType: 'video',
    extension: '.mp4',
    availability: 'present',
    preference: 'neutral',
    modifiedAt: '2026-01-01T00:00:00Z',
    effectiveDate: '2026-01-01T00:00:00Z',
    capturedAt: null,
    width: null,
    height: null,
    durationMs: 1000,
    sizeBytes: 100,
    tags: [],
    thumbnail: { status: 'ready', url: '/thumb', width: null, height: null },
    preview: { status: 'ready', url: '/preview', width: null, height: null },
  })
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              url.includes('/neighbors?')
                ? { previous: null, next: video(2) }
                : url === '/api/libraries'
                  ? []
                  : video(1),
            ),
            { headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      ),
  )
  const onChange = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <Viewer
        active={video(1)}
        filters={{ libraryId: 1 }}
        onChange={onChange}
        onClose={vi.fn()}
        restoreFocus={vi.fn()}
      />
    </QueryClientProvider>,
  )
  await screen.findByRole('button', { name: 'Next item' })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Next item' })).toBeEnabled())

  expect(stage.props.autoplayNext).toBe(false)
  act(() => (stage.props.onEnded as () => void)())
  expect(onChange).not.toHaveBeenCalled()

  act(() => (stage.props.onAutoplayNextChange as (value: boolean) => void)(true))
  expect(localStorage.getItem('luma-video-autoplay')).toBe('1')
  act(() => (stage.props.onEnded as () => void)())
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
  // The next video starts by itself; a video the person picks does not.
  expect(stage.props.autoPlay).toBe(true)
  await userEvent.click(screen.getByRole('button', { name: 'Next item' }))
  expect(stage.props.autoPlay).toBe(false)
})

it('does not navigate the video behind an open caption settings dialog', async () => {
  const media: Media = {
    id: 700,
    libraryId: 1,
    folderId: 1,
    fileName: 'movie.mp4',
    mediaType: 'video',
    extension: '.mp4',
    availability: 'present',
    modifiedAt: '2026-01-01T00:00:00Z',
    effectiveDate: '2026-01-01T00:00:00Z',
    capturedAt: null,
    width: null,
    height: null,
    durationMs: 1000,
    sizeBytes: 100,
    preference: 'neutral',
    tags: [],
    thumbnail: { status: 'ready', url: '/thumb', width: null, height: null },
    preview: { status: 'ready', url: '/poster', width: null, height: null },
  }
  const next = { ...media, id: 701, fileName: 'next.mp4' }
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes('/neighbors?')
              ? { previous: null, next }
              : url === '/api/tasks' || url === '/api/libraries'
                ? []
                : media,
          ),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    ),
  )
  const changed = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <Viewer active={media} filters={{}} onChange={changed} onClose={vi.fn()} restoreFocus={vi.fn()} />
    </QueryClientProvider>,
  )
  await userEvent.click(await screen.findByRole('button', { name: 'Viewer menu' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Next item' })).toBeEnabled())
  const captionDialog = document.createElement('div')
  captionDialog.setAttribute('role', 'dialog')
  captionDialog.setAttribute('data-state', 'open')
  document.body.append(captionDialog)
  try {
    await userEvent.keyboard('{ArrowRight}')
    expect(changed).not.toHaveBeenCalled()
  } finally {
    captionDialog.remove()
  }
  await userEvent.keyboard('{ArrowRight}')
  expect(changed).toHaveBeenCalledWith(next)
})

it.each(['image', 'video'])(
  'deleting %s advances, falls back at the end and skips queued removals without closing',
  async mediaType => {
    window.history.replaceState(null, '', '/')
    const items = [1, 2, 3].map(
      id =>
        ({
          id,
          libraryId: 1,
          folderId: 1,
          fileName: `${id}.${mediaType === 'video' ? 'mp4' : 'jpg'}`,
          mediaType,
          extension: mediaType === 'video' ? '.mp4' : '.jpg',
          availability: 'present',
          preference: 'neutral',
          modifiedAt: '2026-01-01T00:00:00Z',
          effectiveDate: '2026-01-01T00:00:00Z',
          capturedAt: null,
          width: null,
          height: null,
          durationMs: null,
          sizeBytes: 100,
          tags: [],
          thumbnail: { status: 'ready', url: '/thumb', width: null, height: null },
          preview: { status: 'ready', url: '/preview', width: null, height: null },
        }) as Media,
    )
    const fetch = vi.fn(async (url: string) => {
      const id = Number(url.match(/media\/(\d+)/)?.[1] ?? 1)
      return new Response(
        JSON.stringify(
          url.includes('capabilities')
            ? { accessConfigured: true, libraries: [{ libraryId: 1, writable: true }] }
            : url.includes('/neighbors?')
              ? { previous: items[id - 2] ?? null, next: items[id] ?? null }
              : url === '/api/files/items'
                ? { id: 'queued' }
                : url === '/api/libraries'
                  ? []
                  : items[id - 1],
        ),
      )
    })
    vi.stubGlobal('fetch', fetch)
    const closed = vi.fn()
    function Controlled() {
      const [active, setActive] = useState(items[1])
      return <Viewer active={active} filters={{}} onChange={setActive} onClose={closed} restoreFocus={vi.fn()} />
    }
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
        <Controlled />
      </QueryClientProvider>,
    )
    const user = userEvent.setup()
    async function remove() {
      await waitFor(() => expect(screen.getByRole('button', { name: 'Delete file' })).toBeEnabled())
      await user.click(screen.getByRole('button', { name: 'Delete file' }))
      await user.click(screen.getByRole('button', { name: 'Move to recycle bin' }))
    }
    await remove()
    await screen.findByRole('dialog', { name: items[2].fileName })
    expect(closed).not.toHaveBeenCalled()
    await remove()
    await screen.findByRole('dialog', { name: items[0].fileName })
    expect(closed).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next item' })).toBeDisabled())
    await remove()
    await waitFor(() => expect(closed).toHaveBeenCalledOnce())
    const posts = fetch.mock.calls.filter(call => call[0] === '/api/files/items')
    expect(posts).toHaveLength(3)
  },
)

it('hides the entire top bar during a temporary speed boost and restores its controls afterwards', () => {
  const media = {
    id: 1,
    libraryId: 1,
    fileName: 'video.mp4',
    mediaType: 'video',
    preference: 'neutral',
    tags: [],
    preview: { status: 'ready', url: '/preview' },
    thumbnail: { status: 'ready', url: '/thumb' },
  } as unknown as Media
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ previous: null, next: null }))),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const view = render(
    <QueryClientProvider client={client}>
      <Viewer active={media} filters={{}} onChange={vi.fn()} onClose={vi.fn()} restoreFocus={vi.fn()} startSlideshow />
    </QueryClientProvider>,
  )
  const header = screen.getByRole('button', { name: 'Close viewer' }).closest('header')!
  expect(header).toBeVisible()
  expect(screen.getByRole('button', { name: 'Slideshow' })).toBeVisible()
  act(() => (stage.props.onBoostChange as (value: boolean) => void)(true))
  expect(header).not.toBeVisible()
  expect(screen.queryByRole('button', { name: 'Close viewer' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Slideshow' })).not.toBeInTheDocument()
  act(() => (stage.props.onBoostChange as (value: boolean) => void)(false))
  expect(header).toBeVisible()
  expect(screen.getByRole('button', { name: 'Close viewer' })).toBeVisible()
  view.unmount()
  client.clear()
})
