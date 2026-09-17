import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'

function renderApp() {
  window.history.replaceState(null, '', '/')
  localStorage.clear()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(<QueryClientProvider client={client}><App /></QueryClientProvider>)
}
function emptyApi() {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(url.startsWith('/api/libraries') ? [] : { items: [], nextCursor: null, previousCursor: null }), { headers: { 'Content-Type': 'application/json' } }))))
}
function browsingApi() {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url.endsWith('/index') && init?.method === 'POST') return Promise.resolve(new Response(null, { status: 204 }))
    const data = url === '/api/libraries' ? [{ id: 1, name: 'Photos', rootFolderId: 1 }]
      : url.startsWith('/api/folders?') ? { current: { id: 2, libraryId: 1, name: 'Trips' }, ancestors: [], items: [] }
        : url.startsWith('/api/indexing') ? { libraries: [] } : { items: [], nextCursor: null, previousCursor: null }
    return Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }))
  }))
}

describe('browsing shell', () => {
  it('opens favourites on mobile without activating the search field, while explicitly opening Search focuses it', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    browsingApi()
    renderApp()
    await userEvent.click(screen.getAllByRole('button', { name: 'Collections' })[0])
    await userEvent.click(await screen.findByRole('button', { name: 'Open favourites' }))
    await waitFor(() => expect(window.location.search).toContain('preference=liked'))
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search media"]')!
    expect(input).not.toHaveFocus()
    expect(input.closest('form')).toHaveAttribute('inert')
    await userEvent.click(screen.getAllByRole('button', { name: 'Library' })[0])
    await userEvent.click(screen.getAllByRole('button', { name: 'Search' }).find(button => button.textContent?.includes('Search'))!)
    await waitFor(() => expect(input).toHaveFocus())
  })

  it('clears search back to the last library folder even after returning to Library with the query active', async () => {
    window.history.replaceState(null, '', '/?libraryId=1&folderId=2&order=asc')
    localStorage.clear()
    browsingApi()
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><App /></QueryClientProvider>)
    const input = screen.getByRole('textbox', { name: 'Search media' })
    await userEvent.type(input, 'Beach{Enter}')
    expect(window.location.search).toContain('q=Beach')
    await userEvent.click((await screen.findAllByRole('button', { name: 'Library' }))[0])
    expect(window.location.search).toContain('q=Beach')
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(input).toHaveValue('')
    expect(window.location.search).toBe('?libraryId=1&folderId=2&order=asc')
    expect(await screen.findByRole('heading', { name: 'Trips' })).toBeVisible()
  })

  it('clears a search started from Search back to its default page', async () => {
    browsingApi()
    renderApp()
    await userEvent.click((await screen.findAllByRole('button', { name: 'Search' })).find(button => button.textContent?.includes('Search'))!)
    await userEvent.type(screen.getByRole('textbox', { name: 'Search media' }), 'Beach{Enter}')
    expect(window.location.search).toContain('q=Beach')
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(window.location.search).toBe('')
    expect(screen.getByRole('textbox', { name: 'Search media' })).toHaveValue('')
    expect(await screen.findByRole('heading', { name: 'Search your media' })).toBeVisible()
  })

  it('imports the whole current folder without inheriting gallery filters or selecting media IDs', async () => {
    window.history.replaceState(null, '', '/?libraryId=1&folderId=2&mediaType=video&preference=liked')
    localStorage.clear()
    const fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/folders/2/index' && init?.method === 'POST') return Promise.resolve(new Response(null, { status: 204 }))
      const data = url === '/api/imports/tags' ? { id: 9 }
        : url === '/api/jobs/9' ? { id: 9, kind: 'import', state: 'completed', processed: 700, failed: 0, items: [] }
          : url === '/api/libraries' ? [{ id: 1, name: 'Photos', rootFolderId: 1 }]
            : url.startsWith('/api/folders?') ? { current: { id: 2, libraryId: 1, name: 'Trips' }, ancestors: [], items: [] }
              : url.startsWith('/api/indexing') ? { libraries: [] }
                : { items: [], nextCursor: null, previousCursor: null }
      return Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }))
    })
    vi.stubGlobal('fetch', fetch)
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><App /></QueryClientProvider>)
    await userEvent.click(await screen.findByRole('button', { name: 'Import folder metadata' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include adjacent XMP sidecars' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import folder metadata tags' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/imports/tags', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ query: { libraryId: 1, folderId: 2 }, includeSidecars: true }),
    })))
    expect(await screen.findByRole('status')).toHaveTextContent('700 processed')
  })

  it('shows libraries on home without fetching the combined media feed', async () => {
    const fetch = vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(url === '/api/libraries'
      ? [{ id: 1, name: 'Photos', availability: 'available', rootFolderId: 1 }]
      : { libraries: [] }), { headers: { 'Content-Type': 'application/json' } })))
    vi.stubGlobal('fetch', fetch)
    renderApp()
    expect(await screen.findByRole('heading', { name: 'Photos' })).toBeVisible()
    expect(fetch.mock.calls.some(([url]) => String(url).startsWith('/api/media'))).toBe(false)
  })
  it('explains how to connect an empty library', async () => {
    emptyApi(); renderApp()
    expect(await screen.findByRole('heading', { name: 'Connect your first library' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Search media' })).toBeDefined()
  })
  it('opens filters from the keyboard and restores focus after Escape', async () => {
    emptyApi(); renderApp()
    const trigger = screen.getByRole('button', { name: 'Filters' })
    trigger.focus(); await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('dialog', { name: 'Search and filters' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })
  it('keeps applied search and filter state in the URL', async () => {
    emptyApi(); renderApp()
    await userEvent.type(screen.getByRole('textbox', { name: 'Search media' }), 'Summer{Enter}')
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Favourite state' }), 'liked')
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    expect(window.location.search).toContain('q=Summer')
    expect(window.location.search).toContain('preference=liked')
  })
  it('opens reels as a global video feed instead of the current folder', async () => {
    window.history.replaceState(null, '', '/?libraryId=1&folderId=2')
    const clip = { id: 10, libraryId: 1, folderId: 2, fileName: 'clip.mp4', mediaType: 'video', extension: '.mp4', sizeBytes: 123, modifiedAt: '2026-01-01T00:00:00Z', preview: { status: 'pending' }, thumbnail: { status: 'ready', url: '/thumb.jpg' }, tags: [] }
    const fetch = vi.fn().mockImplementation((url: string) => {
      const text = String(url)
      const data = text.startsWith('/api/libraries') ? [{ id: 1, name: 'Photos', availability: 'available', rootFolderId: 1 }]
        : text.startsWith('/api/indexing') ? { libraries: [{ id: 1, name: 'Photos', availability: 'available', latestScanId: null }] }
        : text.startsWith('/api/folders') ? { current: { id: 2, libraryId: 1, name: 'Trips' }, ancestors: [], items: [] }
        : text.includes('/neighbors?') ? { previous: null, next: null }
            : /\/api\/media\/\d+$/.test(text) ? clip
              : { items: [clip], nextCursor: null, previousCursor: null }
      return Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }))
    })
    vi.stubGlobal('fetch', fetch)
    localStorage.clear()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})

    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><App /></QueryClientProvider>)
    await userEvent.click((await screen.findAllByRole('button', { name: 'Reels' }))[0])

    await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).startsWith('/api/media?') && String(url).includes('mediaType=video') && !String(url).includes('folderId=2') && !String(url).includes('libraryId=1'))).toBe(true))
    expect(window.location.search).toContain('mediaType=video')
    expect(window.location.search).not.toContain('folderId=2')
  })
  it('clears the reels video filter when opening search', async () => {
    const fetch = vi.fn().mockImplementation((url: string) => {
      const text = String(url)
      const data = text.startsWith('/api/libraries')
        ? [{ id: 1, name: 'Photos', availability: 'available', rootFolderId: 1 }]
        : text.startsWith('/api/indexing')
          ? { libraries: [{ id: 1, name: 'Photos', availability: 'available', latestScanId: null }] }
          : text.includes('/neighbors?') ? { previous: null, next: null }
            : { items: [], nextCursor: null, previousCursor: null }
      return Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }))
    })
    vi.stubGlobal('fetch', fetch)
    renderApp()
    await userEvent.click((await screen.findAllByRole('button', { name: 'Reels' }))[0])
    expect(window.location.search).toContain('mediaType=video')
    await userEvent.click((await screen.findAllByRole('button', { name: 'Search' })).find(button => button.textContent?.includes('Search'))!)
    expect(await screen.findByRole('heading', { name: 'Search your media' })).toBeVisible()
    expect(window.location.search).not.toContain('mediaType=video')
  })
  it('never lets reels change the folder library returns to', async () => {
    window.history.replaceState(null, '', '/?libraryId=1&folderId=2')
    const clip = { id: 10, libraryId: 1, folderId: 2, fileName: 'clip.mp4', mediaType: 'video', extension: '.mp4', sizeBytes: 123, modifiedAt: '2026-01-01T00:00:00Z', preview: { status: 'pending' }, thumbnail: { status: 'ready', url: '/thumb.jpg' }, tags: [] }
    const fetch = vi.fn().mockImplementation((url: string) => {
      const text = String(url)
      const data = text.startsWith('/api/libraries') ? [{ id: 1, name: 'Photos', availability: 'available', rootFolderId: 1 }]
        : text.startsWith('/api/indexing') ? { libraries: [{ id: 1, name: 'Photos', availability: 'available', latestScanId: null }] }
        : text.startsWith('/api/folders') ? { current: { id: 2, libraryId: 1, name: 'Trips' }, ancestors: [], items: [] }
        : text.includes('/neighbors?') ? { previous: null, next: null }
            : /\/api\/media\/\d+$/.test(text) ? clip
              : { items: [clip], nextCursor: null, previousCursor: null }
      return Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }))
    })
    vi.stubGlobal('fetch', fetch)
    localStorage.clear()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><App /></QueryClientProvider>)

    await userEvent.click((await screen.findAllByRole('button', { name: 'Reels' }))[0])
    await waitFor(() => expect(window.location.search).toContain('mediaType=video'))
    // Sanity: entering Reels really did drop the folder scope, so restoring it below proves the fix.
    expect(window.location.search).not.toContain('folderId=2')

    await userEvent.click((await screen.findAllByRole('button', { name: 'Library' }))[0])
    expect(window.location.search).toContain('libraryId=1')
    expect(window.location.search).toContain('folderId=2')
    expect(window.location.search).not.toContain('mediaType=video')
  })
  it('restores the filters last used in reels when returning to it', async () => {
    const photo = { id: 7, libraryId: 1, folderId: 1, fileName: 'beach.jpg', mediaType: 'image', extension: '.jpg', sizeBytes: 10, modifiedAt: '2026-01-01T00:00:00Z', preference: 'neutral', thumbnail: { status: 'ready', url: '/thumb.jpg' }, preview: { status: 'ready', url: '/preview.jpg' }, tags: [] }
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      const text = String(url)
      const data = text.startsWith('/api/libraries') ? [{ id: 1, name: 'Photos', availability: 'available', rootFolderId: 1 }]
        : text.startsWith('/api/indexing') ? { libraries: [{ id: 1, name: 'Photos', availability: 'available', latestScanId: null }] }
          : text.includes('/neighbors?') ? { previous: null, next: null }
            : /\/api\/media\/\d+$/.test(text) ? photo
              : { items: [photo], nextCursor: null, previousCursor: null }
      return Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }))
    }))
    renderApp()
    await userEvent.click((await screen.findAllByRole('button', { name: 'Reels' }))[0])
    await userEvent.click(await screen.findByRole('button', { name: 'Reels menu' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Filters' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Media type' }), 'image')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Favourite state' }), 'liked')
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    expect(window.location.search).toContain('mediaType=image')

    await userEvent.click((await screen.findAllByRole('button', { name: 'Library' }))[0])
    await userEvent.type(screen.getByRole('textbox', { name: 'Search media' }), 'beach{Enter}')
    expect(window.location.search).toContain('q=beach')

    await userEvent.click((await screen.findAllByRole('button', { name: 'Reels' }))[0])
    expect(window.location.search).toContain('mediaType=image')
    expect(window.location.search).toContain('preference=liked')
    expect(window.location.search).not.toContain('q=beach')
  })
  it('does not show a random feed on the empty search destination', async () => {
    const fetch = vi.fn().mockImplementation((url: string) => {
      const text = String(url)
      const data = text.startsWith('/api/libraries')
        ? [{ id: 1, name: 'Photos', availability: 'available', rootFolderId: 1 }]
        : text.startsWith('/api/indexing')
          ? { libraries: [{ id: 1, name: 'Photos', availability: 'available', latestScanId: null }] }
          : { items: [], nextCursor: null, previousCursor: null }
      return Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }))
    })
    vi.stubGlobal('fetch', fetch)
    renderApp()
    await screen.findByRole('heading', { name: 'Photos' })
    await userEvent.click((await screen.findAllByRole('button', { name: 'Search' })).find(button => button.textContent?.includes('Search'))!)
    expect(await screen.findByRole('heading', { name: 'Search your media' })).toBeVisible()
    expect(screen.queryByTestId('gallery-scroll')).not.toBeInTheDocument()
  })
})
