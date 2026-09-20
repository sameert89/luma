import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import packageJson from '../../package.json'

// Clears the app's stored state but keeps What's new past its once-per-release popup,
// which otherwise opens over every test.
function resetStorage() {
  localStorage.clear()
  localStorage.setItem('luma-version-seen', packageJson.version)
}
function renderApp() {
  window.history.replaceState(null, '', '/')
  resetStorage()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )
}
function emptyApi() {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              url === '/api/tasks' || url.startsWith('/api/libraries')
                ? []
                : { items: [], nextCursor: null, previousCursor: null },
            ),
            { headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      ),
  )
}
function browsingApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/index') && init?.method === 'POST') return Promise.resolve(new Response(null, { status: 204 }))
      const data =
        url === '/api/libraries'
          ? [{ id: 1, name: 'Photos', rootFolderId: 1 }]
          : url.startsWith('/api/folders?')
            ? { current: { id: 2, libraryId: 1, name: 'Trips' }, ancestors: [], items: [] }
            : url.startsWith('/api/indexing')
              ? { libraries: [] }
              : { items: [], nextCursor: null, previousCursor: null }
      return Promise.resolve(
        new Response(JSON.stringify(url === '/api/tasks' ? [] : data), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }),
  )
}

describe('browsing shell', () => {
  it('selects shuffle and reshuffles without randomUUID on HTTP hosts', async () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
    browsingApi()
    renderApp()
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'shuffle')
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    const firstSeed = new URLSearchParams(window.location.search).get('seed')
    expect(firstSeed).toMatch(/^[0-9a-f]{32}$/)
    expect(screen.getByTestId('gallery-scroll')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
    await userEvent.click(screen.getByRole('button', { name: 'Reshuffle' }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    expect(new URLSearchParams(window.location.search).get('seed')).not.toBe(firstSeed)
  })

  it('restores a seedless shuffle URL without randomUUID on HTTP hosts', async () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
    browsingApi()
    resetStorage()
    window.history.replaceState(null, '', '/?sort=shuffle')
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
        <App />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('seed')).toMatch(/^[0-9a-f]{32}$/))
    expect(screen.getByTestId('gallery-scroll')).toBeVisible()
  })

  it('sorts a library in place and keeps selection and folder actions in its compact header', async () => {
    window.history.replaceState(null, '', '/?libraryId=1&folderId=2')
    resetStorage()
    browsingApi()
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
        <App />
      </QueryClientProvider>,
    )
    await screen.findByRole('heading', { name: 'Trips' })
    expect(screen.queryByRole('combobox', { name: 'Sort media' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Import folder metadata' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Select media' }))
    expect(screen.getByRole('button', { name: 'Done selecting' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Select all' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Done selecting' }))
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
    expect(screen.queryByRole('textbox', { name: 'Keyword' })).not.toBeInTheDocument()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'name')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort direction' }), 'asc')
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    expect(window.location.search).toContain('sort=name')
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(
            ([url]) =>
              String(url).startsWith('/api/folders?') &&
              new URL(String(url), window.location.href).searchParams.get('order') === 'asc',
          ),
      ).toBe(true),
    )
    expect(window.location.search).toContain('folderId=2')
    expect(screen.getAllByRole('button', { name: 'Library' })[0]).toHaveAttribute('aria-current', 'page')
    expect(
      screen.getAllByRole('button', { name: 'Search' }).find(button => button.textContent?.includes('Search')),
    ).not.toHaveAttribute('aria-current', 'page')
    await userEvent.click(screen.getByRole('button', { name: 'Folder actions for Trips' }))
    await userEvent.click(screen.getByRole('button', { name: 'Folder information' }))
    expect(screen.getByRole('dialog', { name: 'Folder information' })).toHaveTextContent('Trips')
    expect(screen.getByRole('dialog', { name: 'Folder information' })).toHaveTextContent('Photos')
  })

  it('shows all matching media when sorting an empty search and clears the keyword when resetting filters', async () => {
    browsingApi()
    renderApp()
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Search' }).find(button => button.textContent?.includes('Search'))!,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'name')
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    expect(screen.queryByRole('heading', { name: 'Search your media' })).not.toBeInTheDocument()
    expect(screen.getByTestId('gallery-scroll')).toBeVisible()
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(
            ([url]) =>
              String(url).startsWith('/api/media?') && String(url).includes('sort=name') && !String(url).includes('q='),
          ),
      ).toBe(true),
    )
    await userEvent.type(screen.getByRole('combobox', { name: 'Search media' }), 'Beach{Enter}')
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
    await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
    expect(window.location.search).toBe('')
    expect(screen.getByRole('combobox', { name: 'Search media' })).toHaveValue('')
  })

  it('opens a child folder menu without navigating and imports that folder rather than the parent', async () => {
    window.history.replaceState(null, '', '/?libraryId=1&folderId=2')
    resetStorage()
    const name = 'A very long child folder name that remains available in folder information'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        const data =
          url === '/api/libraries'
            ? [{ id: 1, name: 'Photos', rootFolderId: 1 }]
            : url.startsWith('/api/folders?')
              ? {
                  current: { id: 2, libraryId: 1, name: 'Trips' },
                  ancestors: [],
                  items: [{ id: 3, libraryId: 1, name }],
                }
              : url === '/api/imports/tags'
                ? { id: 9 }
                : url === '/api/jobs/9'
                  ? { id: 9, state: 'completed', processed: 1, failed: 0, items: [] }
                  : url === '/api/indexing'
                    ? { libraries: [] }
                    : { items: [] }
        return Promise.resolve(
          new Response(JSON.stringify(url === '/api/tasks' ? [] : data), {
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }),
    )
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
        <App />
      </QueryClientProvider>,
    )
    await userEvent.click(await screen.findByRole('button', { name: `Folder actions for ${name}` }))
    expect(window.location.search).toBe('?libraryId=1&folderId=2')
    await userEvent.click(screen.getByRole('button', { name: 'Import folder metadata' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import folder metadata tags' }))
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/imports/tags',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ query: { libraryId: 1, folderId: 3, recursive: true }, includeSidecars: false }),
        }),
      ),
    )
  })

  it('opens favourites on mobile without activating the search field, while explicitly opening Search focuses it', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    )
    browsingApi()
    renderApp()
    await userEvent.click(screen.getAllByRole('button', { name: 'Collections' })[0])
    await userEvent.click(await screen.findByRole('button', { name: 'Open favourites' }))
    await waitFor(() => expect(window.location.search).toContain('preference=liked'))
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search media"]')!
    expect(input).not.toHaveFocus()
    expect(input.closest('form')).toHaveAttribute('inert')
    await userEvent.click(screen.getAllByRole('button', { name: 'Library' })[0])
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Search' }).find(button => button.textContent?.includes('Search'))!,
    )
    await waitFor(() => expect(input).toHaveFocus())
  })

  it('clears search back to the last library folder even after returning to Library with the query active', async () => {
    window.history.replaceState(null, '', '/?libraryId=1&folderId=2&order=asc')
    resetStorage()
    browsingApi()
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
        <App />
      </QueryClientProvider>,
    )
    const input = screen.getByRole('combobox', { name: 'Search media' })
    await userEvent.type(input, 'Beach{Enter}')
    expect(window.location.search).toContain('q=Beach')
    await userEvent.click((await screen.findAllByRole('button', { name: 'Library' }))[0])
    expect(window.location.search).toContain('q=Beach')
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(input).toHaveValue('')
    expect(window.location.search).toBe('?libraryId=1&folderId=2&order=asc')
    expect(await screen.findByRole('heading', { name: 'Trips' })).toBeVisible()
  })

  it('runs an exact tag search from a tag suggestion and opens folder and file suggestions directly', async () => {
    const photo = {
      id: 12,
      libraryId: 1,
      folderId: 2,
      fileName: 'beach-sunset.jpg',
      mediaType: 'image',
      extension: '.jpg',
      availability: 'present',
      preference: 'neutral',
      modifiedAt: '2026-01-01T00:00:00Z',
      effectiveDate: '2026-01-01T00:00:00Z',
      capturedAt: null,
      width: 10,
      height: 10,
      durationMs: null,
      sizeBytes: 1,
      tags: [],
      thumbnail: { status: 'ready', url: '/thumb', width: 10, height: 10 },
      preview: { status: 'ready', url: '/preview', width: 10, height: 10 },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        const data = url.startsWith('/api/search/suggestions')
          ? [
              { kind: 'tag', label: 'Beach', id: 4 },
              { kind: 'folder', label: 'Beach trip', id: 30, detail: 'Photos', libraryId: 1 },
              { kind: 'file', label: 'beach-sunset.jpg', id: 12, detail: 'Trips' },
            ]
          : url === '/api/libraries'
            ? [{ id: 1, name: 'Photos', rootFolderId: 1 }]
            : url === '/api/tasks'
              ? []
              : url === '/api/media/12'
                ? photo
                : url.startsWith('/api/folders?')
                  ? { current: { id: 30, libraryId: 1, parentId: 1, name: 'Beach trip' }, ancestors: [], items: [] }
                  : url.includes('/neighbors?')
                    ? { previous: null, next: null }
                    : url.startsWith('/api/indexing')
                      ? { libraries: [] }
                      : { items: [], nextCursor: null, previousCursor: null }
        return Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }))
      }),
    )
    renderApp()
    const field = await screen.findByRole('combobox', { name: 'Search media' })
    await userEvent.type(field, 'bea')
    await userEvent.click(await screen.findByRole('option', { name: /Beach\s*Tag/ }))
    expect(new URLSearchParams(window.location.search).getAll('tag')).toEqual(['Beach'])
    expect(window.location.search).not.toContain('q=')
    await userEvent.type(screen.getByRole('combobox', { name: 'Search media' }), 'bea')
    await userEvent.click(await screen.findByRole('option', { name: /beach-sunset\.jpg/ }))
    expect(await screen.findByRole('dialog', { name: 'beach-sunset.jpg' })).toBeVisible()
    expect(new URLSearchParams(window.location.search).get('q')).toBe('beach-sunset.jpg')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await userEvent.type(screen.getByRole('combobox', { name: 'Search media' }), 'bea')
    await userEvent.click(await screen.findByRole('option', { name: /Beach trip\s*Photos\s*Folder/ }))
    expect(window.location.search).toBe('?libraryId=1&folderId=30')
    expect(await screen.findByRole('heading', { name: 'Beach trip' })).toBeVisible()
  })

  it('clears a search started from Search back to its default page', async () => {
    browsingApi()
    renderApp()
    await userEvent.click(
      (await screen.findAllByRole('button', { name: 'Search' })).find(button =>
        button.textContent?.includes('Search'),
      )!,
    )
    await userEvent.type(screen.getByRole('combobox', { name: 'Search media' }), 'Beach{Enter}')
    expect(window.location.search).toContain('q=Beach')
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(window.location.search).toBe('')
    expect(screen.getByRole('combobox', { name: 'Search media' })).toHaveValue('')
    expect(await screen.findByRole('heading', { name: 'Search your media' })).toBeVisible()
  })

  it('imports the whole current folder without inheriting gallery filters or selecting media IDs', async () => {
    window.history.replaceState(null, '', '/?libraryId=1&folderId=2&mediaType=video&preference=liked')
    resetStorage()
    const fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/folders/2/index' && init?.method === 'POST')
        return Promise.resolve(new Response(null, { status: 204 }))
      const data =
        url === '/api/imports/tags'
          ? { id: 9 }
          : url === '/api/jobs/9'
            ? { id: 9, kind: 'import', state: 'completed', processed: 700, failed: 0, items: [] }
            : url === '/api/libraries'
              ? [{ id: 1, name: 'Photos', rootFolderId: 1 }]
              : url.startsWith('/api/folders?')
                ? { current: { id: 2, libraryId: 1, name: 'Trips' }, ancestors: [], items: [] }
                : url.startsWith('/api/indexing')
                  ? { libraries: [] }
                  : { items: [], nextCursor: null, previousCursor: null }
      return Promise.resolve(
        new Response(JSON.stringify(url === '/api/tasks' ? [] : data), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    vi.stubGlobal('fetch', fetch)
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
        <App />
      </QueryClientProvider>,
    )
    expect(screen.queryByRole('button', { name: 'Import folder metadata' })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Folder actions for Trips' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import folder metadata' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include adjacent XMP sidecars' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import folder metadata tags' }))
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/imports/tags',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ query: { libraryId: 1, folderId: 2, recursive: true }, includeSidecars: true }),
        }),
      ),
    )
    expect(await screen.findByRole('status')).toHaveTextContent('700 processed')
  })

  it('sets up a never-indexed library to index folders as they are opened, without a full scan', async () => {
    let rootFolderId: number | null = null
    const fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/libraries/1/root') rootFolderId = 5
      const data =
        url === '/api/tasks'
          ? []
          : url === '/api/libraries'
            ? [{ id: 1, name: 'Photos', availability: 'unknown', rootFolderId, metadataMode: 'embedded' }]
            : url === '/api/libraries/1/root'
              ? { folderId: 5 }
              : url.startsWith('/api/folders?')
                ? { current: { id: 5, libraryId: 1, name: 'Photos' }, ancestors: [], items: [] }
                : url.startsWith('/api/indexing')
                  ? { libraries: [] }
                  : { items: [], nextCursor: null, previousCursor: null }
      return Promise.resolve(
        init?.method === 'PUT'
          ? new Response(null, { status: 204 })
          : new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }),
      )
    })
    vi.stubGlobal('fetch', fetch)
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: 'Open Photos' }))
    const dialog = screen.getByRole('dialog', { name: 'Set up library' })
    expect(dialog).toHaveTextContent('does not disable indexing, thumbnails, video posters or on-demand previews')
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Automatic tag import' }), 'none')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Index folders as I open them' }))
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('folderId')).toBe('5'))
    const writes = fetch.mock.calls
      .filter(([url, init]) => String(url).startsWith('/api/libraries/') && init?.method !== 'GET')
      .map(([url, init]) => [url, init.body ?? null])
    expect(writes).toEqual([
      ['/api/libraries/1/metadata-mode', JSON.stringify({ metadataMode: 'none' })],
      ['/api/libraries/1/root', null],
    ])
  })

  it('changes the tag import setting of a library from Settings', async () => {
    const fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === 'PUT'
          ? new Response(null, { status: 204 })
          : new Response(
              JSON.stringify(
                url === '/api/tasks'
                  ? []
                  : url === '/api/libraries'
                    ? [
                        {
                          id: 1,
                          name: 'Photos',
                          availability: 'available',
                          rootFolderId: 1,
                          metadataMode: 'embedded',
                        },
                      ]
                    : url === '/api/libraries/1/refresh-settings'
                      ? {
                          mode: 'watcher',
                          refreshOnOpen: true,
                          periodicIntervalMinutes: 60,
                          watcherDebounceSeconds: 5,
                          fileStabilitySeconds: 10,
                        }
                      : { libraries: [] },
              ),
              { headers: { 'Content-Type': 'application/json' } },
            ),
      ),
    )
    vi.stubGlobal('fetch', fetch)
    renderApp()
    await userEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0])
    const setting = await screen.findByRole('combobox', { name: 'Automatic tag import for Photos' })
    expect(setting).toHaveValue('embedded')
    await userEvent.selectOptions(setting, 'xmp')
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/libraries/1/metadata-mode',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ metadataMode: 'xmp' }) }),
      ),
    )
    const discovery = await screen.findByRole('combobox', { name: 'Change detection for Photos' })
    expect(discovery).toHaveValue('watcher')
    await userEvent.selectOptions(discovery, 'periodic')
    await userEvent.clear(screen.getByRole('spinbutton', { name: 'Scan interval (minutes)' }))
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Scan interval (minutes)' }), '360')
    await userEvent.click(screen.getByRole('button', { name: 'Save discovery settings' }))
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/libraries/1/refresh-settings',
        expect.objectContaining({ method: 'PUT', body: expect.stringContaining('"mode":"periodic"') }),
      ),
    )
  })

  it('shows libraries on home without fetching the combined media feed', async () => {
    const fetch = vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              url === '/api/tasks'
                ? []
                : url === '/api/libraries'
                  ? [{ id: 1, name: 'Photos', availability: 'available', rootFolderId: 1 }]
                  : { libraries: [] },
            ),
            { headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      )
    vi.stubGlobal('fetch', fetch)
    renderApp()
    expect(await screen.findByRole('button', { name: 'Open Photos' })).toBeVisible()
    expect(fetch.mock.calls.some(([url]) => String(url).startsWith('/api/media'))).toBe(false)
  })
  it('caps sparse album cards and keeps indexing status in the libraries header', async () => {
    const fetch = vi.fn().mockImplementation((url: string) => {
      const data =
        url === '/api/tasks'
          ? []
          : url === '/api/libraries'
            ? [{ id: 1, name: 'Photos', availability: 'available', rootFolderId: 1 }]
            : url.startsWith('/api/folders?')
              ? {
                  current: { id: 1, libraryId: 1, name: 'Photos' },
                  ancestors: [],
                  items: [{ id: 2, libraryId: 1, name: 'Trips' }],
                }
              : url.startsWith('/api/indexing')
                ? { libraries: [{ id: 1, name: 'Photos', availability: 'available', latestScanId: null }] }
                : { items: [], nextCursor: null, previousCursor: null }
      return Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }))
    })
    vi.stubGlobal('fetch', fetch)
    renderApp()
    const library = await screen.findByRole('button', { name: 'Open Photos' })
    expect(library.closest('article')).toHaveClass('max-w-sm')
    expect(library.closest('article')?.innerHTML).toContain('bg-linear-to-t')
    // A library card carries the same actions menu as any folder.
    expect(within(library.closest('article')!).getByRole('button', { name: 'Folder actions for Photos' })).toBeVisible()
    const status = screen.getByRole('button', { name: 'Background jobs' })
    await userEvent.click(status)
    const jobs = screen.getByRole('dialog', { name: 'Background jobs' })
    expect(jobs).toBeVisible()
    // The jobs panel lists jobs only; rescanning lives in each folder's menu.
    expect(within(jobs).queryByText('Scan controls')).not.toBeInTheDocument()
    expect(within(jobs).queryByRole('button', { name: 'Start rescan' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.click(library)
    const folder = await screen.findByRole('button', { name: 'Open Trips' })
    expect(folder.closest('article')).toHaveClass('max-w-sm')
  })
  it('explains how to connect an empty library', async () => {
    emptyApi()
    renderApp()
    expect(await screen.findByRole('heading', { name: 'Connect your first library' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Search media' })).toBeDefined()
  })
  it('opens filters from the keyboard and restores focus after Escape', async () => {
    emptyApi()
    renderApp()
    const trigger = screen.getByRole('button', { name: 'Filters' })
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('dialog', { name: 'Filters and sorting' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })
  it('keeps applied search and filter state in the URL', async () => {
    emptyApi()
    renderApp()
    await userEvent.type(screen.getByRole('combobox', { name: 'Search media' }), 'Summer{Enter}')
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Favourite state' }), 'liked')
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    expect(window.location.search).toContain('q=Summer')
    expect(window.location.search).toContain('preference=liked')
  })
  it('opens reels with the current folder represented by visible filters', async () => {
    window.history.replaceState(null, '', '/?libraryId=1&folderId=2')
    const clip = {
      id: 10,
      libraryId: 1,
      folderId: 2,
      fileName: 'clip.mp4',
      mediaType: 'video',
      extension: '.mp4',
      sizeBytes: 123,
      modifiedAt: '2026-01-01T00:00:00Z',
      preview: { status: 'pending' },
      thumbnail: { status: 'ready', url: '/thumb.jpg' },
      tags: [],
    }
    const fetch = vi.fn().mockImplementation((url: string) => {
      const text = String(url)
      const data = text.startsWith('/api/libraries')
        ? [{ id: 1, name: 'Photos', availability: 'available', rootFolderId: 1 }]
        : text.startsWith('/api/indexing')
          ? { libraries: [{ id: 1, name: 'Photos', availability: 'available', latestScanId: null }] }
          : text.startsWith('/api/folders')
            ? { current: { id: 2, libraryId: 1, name: 'Trips' }, ancestors: [], items: [] }
            : text.includes('/neighbors?')
              ? { previous: null, next: null }
              : /\/api\/media\/\d+$/.test(text)
                ? clip
                : { items: [clip], nextCursor: null, previousCursor: null }
      return Promise.resolve(
        new Response(JSON.stringify(url === '/api/tasks' ? [] : data), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    vi.stubGlobal('fetch', fetch)
    resetStorage()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
        <App />
      </QueryClientProvider>,
    )
    await userEvent.click((await screen.findAllByRole('button', { name: 'Reels' }))[0])

    await waitFor(() =>
      expect(
        fetch.mock.calls.some(
          ([url]) =>
            String(url).startsWith('/api/media?') &&
            String(url).includes('mediaType=motion') &&
            String(url).includes('folderId=2') &&
            String(url).includes('libraryId=1'),
        ),
      ).toBe(true),
    )
    expect(window.location.search).toContain('mediaType=motion')
    expect(window.location.search).toContain('folderId=2')
  })
  it('restores each folder scroll position when revisiting it', async () => {
    window.history.replaceState(null, '', '/?libraryId=1&folderId=2')
    const photos = Array.from({ length: 80 }, (_, index) => ({
      id: index + 1,
      libraryId: 1,
      folderId: 2,
      fileName: `image-${index + 1}.jpg`,
      mediaType: 'image',
      extension: '.jpg',
      sizeBytes: 1,
      modifiedAt: '2026-01-01T00:00:00Z',
      preference: 'neutral',
      preview: { status: 'ready', url: `/preview-${index}` },
      thumbnail: { status: 'ready', url: `/thumb-${index}` },
      tags: [],
    }))
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        const text = String(url)
        const child = new URL(text, window.location.href).searchParams.get('parentId') === '3'
        const data =
          text === '/api/libraries'
            ? [{ id: 1, name: 'Photos', rootFolderId: 1 }]
            : text.startsWith('/api/folders?')
              ? child
                ? {
                    current: { id: 3, libraryId: 1, parentId: 2, name: 'Beach' },
                    ancestors: [{ id: 2, libraryId: 1, parentId: 1, name: 'Trips' }],
                    items: [],
                  }
                : {
                    current: { id: 2, libraryId: 1, parentId: 1, name: 'Trips' },
                    ancestors: [],
                    items: [{ id: 3, libraryId: 1, parentId: 2, name: 'Beach' }],
                  }
              : text.startsWith('/api/indexing') || text === '/api/tasks'
                ? text === '/api/tasks'
                  ? []
                  : { libraries: [] }
                : { items: photos, nextCursor: null, previousCursor: null }
        return Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }))
      }),
    )
    resetStorage()
    try {
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
          <App />
        </QueryClientProvider>,
      )
      const openChild = await screen.findByRole('button', { name: 'Open Beach' })
      await waitFor(() => expect(screen.getByTestId('gallery-grid')).toHaveAttribute('data-retained-items', '80'))
      const parent = screen.getByTestId('gallery-scroll')
      parent.scrollTop = 420
      fireEvent.scroll(parent)
      await userEvent.click(openChild)
      expect(await screen.findByRole('heading', { name: 'Beach' })).toBeVisible()
      act(() => window.history.back())
      await waitFor(() => expect(screen.getByTestId('gallery-scroll').scrollTop).toBe(420))
    } finally {
      rect.mockRestore()
    }
  })
  it('returns from Watch on Reels to the same viewer and gallery position', async () => {
    window.history.replaceState(null, '', '/?libraryId=1&folderId=2')
    const clip = {
      id: 10,
      libraryId: 1,
      folderId: 2,
      fileName: 'clip.mp4',
      mediaType: 'video',
      extension: '.mp4',
      sizeBytes: 123,
      modifiedAt: '2026-01-01T00:00:00Z',
      preference: 'neutral',
      preview: { status: 'ready', url: '/poster.jpg' },
      thumbnail: { status: 'ready', url: '/thumb.jpg' },
      tags: [],
    }
    const media = [
      clip,
      ...Array.from({ length: 79 }, (_, index) => ({ ...clip, id: index + 11, fileName: `clip-${index + 11}.mp4` })),
    ]
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        const text = String(url)
        const data =
          text === '/api/libraries'
            ? [{ id: 1, name: 'Photos', rootFolderId: 1 }]
            : text.startsWith('/api/folders?')
              ? { current: { id: 2, libraryId: 1, parentId: 1, name: 'Trips' }, ancestors: [], items: [] }
              : text.startsWith('/api/indexing') || text === '/api/tasks'
                ? text === '/api/tasks'
                  ? []
                  : { libraries: [] }
                : text.includes('/neighbors?')
                  ? { previous: null, next: null }
                  : /\/api\/media\/\d+$/.test(text)
                    ? clip
                    : { items: media, nextCursor: null, previousCursor: null }
        return Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }))
      }),
    )
    resetStorage()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    try {
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
          <App />
        </QueryClientProvider>,
      )
      const folderActions = await screen.findByRole('button', { name: 'Folder actions for Trips' })
      const gallery = screen.getByTestId('gallery-scroll')
      gallery.scrollTop = 360
      fireEvent.scroll(gallery)
      await userEvent.click(folderActions)
      await userEvent.click(screen.getByRole('button', { name: 'Start slideshow' }))
      await userEvent.click(await screen.findByRole('button', { name: 'Watch on Reels' }))
      expect(await screen.findByRole('region', { name: 'Reels' })).toBeVisible()
      act(() => window.history.back())
      expect(await screen.findByRole('dialog', { name: 'clip.mp4' })).toBeVisible()
      expect(screen.getByTestId('gallery-scroll').scrollTop).toBe(360)
    } finally {
      rect.mockRestore()
      vi.restoreAllMocks()
    }
  })
  it('keeps the visible reels media filter when opening search, until explicitly cleared', async () => {
    const fetch = vi.fn().mockImplementation((url: string) => {
      const text = String(url)
      const data = text.startsWith('/api/libraries')
        ? [{ id: 1, name: 'Photos', availability: 'available', rootFolderId: 1 }]
        : text.startsWith('/api/indexing')
          ? { libraries: [{ id: 1, name: 'Photos', availability: 'available', latestScanId: null }] }
          : text.includes('/neighbors?')
            ? { previous: null, next: null }
            : { items: [], nextCursor: null, previousCursor: null }
      return Promise.resolve(
        new Response(JSON.stringify(url === '/api/tasks' ? [] : data), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    vi.stubGlobal('fetch', fetch)
    renderApp()
    await userEvent.click((await screen.findAllByRole('button', { name: 'Reels' }))[0])
    expect(window.location.search).toContain('mediaType=motion')
    await userEvent.click(
      (await screen.findAllByRole('button', { name: 'Search' })).find(button =>
        button.textContent?.includes('Search'),
      )!,
    )
    expect(window.location.search).toContain('mediaType=motion')
    await userEvent.click(screen.getByRole('button', { name: 'Clear all filters' }))
    expect(await screen.findByRole('heading', { name: 'Search your media' })).toBeVisible()
    expect(window.location.search).not.toContain('mediaType=motion')
  })
  it('carries visible folder and media filters across gallery and reels', async () => {
    window.history.replaceState(null, '', '/?libraryId=1&folderId=2')
    const clip = {
      id: 10,
      libraryId: 1,
      folderId: 2,
      fileName: 'clip.mp4',
      mediaType: 'video',
      extension: '.mp4',
      sizeBytes: 123,
      modifiedAt: '2026-01-01T00:00:00Z',
      preview: { status: 'pending' },
      thumbnail: { status: 'ready', url: '/thumb.jpg' },
      tags: [],
    }
    const fetch = vi.fn().mockImplementation((url: string) => {
      const text = String(url)
      const data = text.startsWith('/api/libraries')
        ? [{ id: 1, name: 'Photos', availability: 'available', rootFolderId: 1 }]
        : text.startsWith('/api/indexing')
          ? { libraries: [{ id: 1, name: 'Photos', availability: 'available', latestScanId: null }] }
          : text.startsWith('/api/folders')
            ? { current: { id: 2, libraryId: 1, name: 'Trips' }, ancestors: [], items: [] }
            : text.includes('/neighbors?')
              ? { previous: null, next: null }
              : /\/api\/media\/\d+$/.test(text)
                ? clip
                : { items: [clip], nextCursor: null, previousCursor: null }
      return Promise.resolve(
        new Response(JSON.stringify(url === '/api/tasks' ? [] : data), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    vi.stubGlobal('fetch', fetch)
    resetStorage()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
        <App />
      </QueryClientProvider>,
    )

    await userEvent.click((await screen.findAllByRole('button', { name: 'Reels' }))[0])
    await waitFor(() => expect(window.location.search).toContain('mediaType=motion'))
    // Switching presentation preserves the visible query scope.
    expect(window.location.search).toContain('folderId=2')

    await userEvent.click((await screen.findAllByRole('button', { name: 'Library' }))[0])
    expect(window.location.search).toContain('libraryId=1')
    expect(window.location.search).toContain('folderId=2')
    expect(window.location.search).toContain('mediaType=motion')
  })
  it('starts a slideshow from the gallery and hands a video over to reels in the same folder', async () => {
    window.history.replaceState(null, '', '/?libraryId=1&folderId=2')
    const clip = {
      id: 10,
      libraryId: 1,
      folderId: 2,
      fileName: 'clip.mp4',
      mediaType: 'video',
      extension: '.mp4',
      sizeBytes: 123,
      modifiedAt: '2026-01-01T00:00:00Z',
      preference: 'neutral',
      preview: { status: 'pending', url: '/poster.jpg' },
      thumbnail: { status: 'ready', url: '/thumb.jpg' },
      tags: [],
    }
    const fetch = vi.fn().mockImplementation((url: string) => {
      const text = String(url)
      const data = text.startsWith('/api/libraries')
        ? [{ id: 1, name: 'Photos', availability: 'available', rootFolderId: 1 }]
        : text.startsWith('/api/indexing')
          ? { libraries: [] }
          : text.startsWith('/api/folders')
            ? { current: { id: 2, libraryId: 1, parentId: 1, name: 'Trips' }, ancestors: [], items: [] }
            : text.includes('/neighbors?')
              ? { previous: null, next: null }
              : /\/api\/media\/\d+$/.test(text)
                ? clip
                : { items: [clip], nextCursor: null, previousCursor: null }
      return Promise.resolve(
        new Response(JSON.stringify(url === '/api/tasks' ? [] : data), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    vi.stubGlobal('fetch', fetch)
    resetStorage()
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    try {
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
          <App />
        </QueryClientProvider>,
      )
      await userEvent.click(await screen.findByRole('button', { name: 'Folder actions for Trips' }))
      await userEvent.click(screen.getByRole('button', { name: 'Start slideshow' }))
      expect(await screen.findByRole('button', { name: 'Slideshow' })).toHaveAttribute('aria-pressed', 'true')
      // A slideshow plays videos through rather than waiting for a Play press.
      await waitFor(() => expect(play).toHaveBeenCalled())

      await userEvent.click(screen.getByRole('button', { name: 'Watch on Reels' }))
      await waitFor(() => expect(window.location.search).toContain('view=reels'))
      expect(window.location.search).not.toContain('mediaType=')
      expect(window.location.search).toContain('folderId=2')
      expect(await screen.findByRole('region', { name: 'Reels' })).toBeVisible()
      expect(await screen.findByLabelText('clip.mp4')).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    } finally {
      vi.restoreAllMocks()
    }
  })
  it('carries the current visible search and filters into reels', async () => {
    const photo = {
      id: 7,
      libraryId: 1,
      folderId: 1,
      fileName: 'beach.jpg',
      mediaType: 'image',
      extension: '.jpg',
      sizeBytes: 10,
      modifiedAt: '2026-01-01T00:00:00Z',
      preference: 'neutral',
      thumbnail: { status: 'ready', url: '/thumb.jpg' },
      preview: { status: 'ready', url: '/preview.jpg' },
      tags: [],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        const text = String(url)
        const data = text.startsWith('/api/libraries')
          ? [{ id: 1, name: 'Photos', availability: 'available', rootFolderId: 1 }]
          : text.startsWith('/api/indexing')
            ? { libraries: [{ id: 1, name: 'Photos', availability: 'available', latestScanId: null }] }
            : text.includes('/neighbors?')
              ? { previous: null, next: null }
              : /\/api\/media\/\d+$/.test(text)
                ? photo
                : { items: [photo], nextCursor: null, previousCursor: null }
        return Promise.resolve(
          new Response(JSON.stringify(url === '/api/tasks' ? [] : data), {
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }),
    )
    renderApp()
    await userEvent.click((await screen.findAllByRole('button', { name: 'Reels' }))[0])
    await userEvent.click(await screen.findByRole('button', { name: 'Reels menu' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Filters' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Media type' }), 'image')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Favourite state' }), 'liked')
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    expect(window.location.search).toContain('mediaType=image')

    await userEvent.click((await screen.findAllByRole('button', { name: 'Library' }))[0])
    await userEvent.type(screen.getByRole('combobox', { name: 'Search media' }), 'beach{Enter}')
    expect(window.location.search).toContain('q=beach')

    await userEvent.click((await screen.findAllByRole('button', { name: 'Reels' }))[0])
    expect(window.location.search).toContain('mediaType=image')
    expect(window.location.search).toContain('preference=liked')
    expect(window.location.search).toContain('q=beach')
  })
  it('does not show a random feed on the empty search destination', async () => {
    const fetch = vi.fn().mockImplementation((url: string) => {
      const text = String(url)
      const data = text.startsWith('/api/libraries')
        ? [{ id: 1, name: 'Photos', availability: 'available', rootFolderId: 1 }]
        : text.startsWith('/api/indexing')
          ? { libraries: [{ id: 1, name: 'Photos', availability: 'available', latestScanId: null }] }
          : { items: [], nextCursor: null, previousCursor: null }
      return Promise.resolve(
        new Response(JSON.stringify(url === '/api/tasks' ? [] : data), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    vi.stubGlobal('fetch', fetch)
    renderApp()
    await screen.findByRole('button', { name: 'Open Photos' })
    await userEvent.click(
      (await screen.findAllByRole('button', { name: 'Search' })).find(button =>
        button.textContent?.includes('Search'),
      )!,
    )
    expect(await screen.findByRole('heading', { name: 'Search your media' })).toBeVisible()
    expect(screen.queryByTestId('gallery-scroll')).not.toBeInTheDocument()
  })
})

it('restores the open file and query from a refreshed URL and clears only the file when closing', async () => {
  window.history.replaceState(null, '', '/?libraryId=1&folderId=2&tag=Trips&media=9')
  resetStorage()
  const photo = {
    id: 9,
    libraryId: 1,
    folderId: 2,
    fileName: 'selected.jpg',
    mediaType: 'image',
    extension: '.jpg',
    preference: 'neutral',
    sizeBytes: 123,
    modifiedAt: '2026-01-01T00:00:00Z',
    preview: { status: 'ready', url: '/selected.jpg' },
    thumbnail: { status: 'ready', url: '/thumb.jpg' },
    tags: [],
  }
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      const data =
        url === '/api/tasks'
          ? []
          : url === '/api/libraries'
            ? [{ id: 1, name: 'Photos', rootFolderId: 1 }]
            : url === '/api/media/9'
              ? photo
              : url.includes('/neighbors?')
                ? { previous: null, next: null }
                : url.startsWith('/api/indexing')
                  ? { libraries: [] }
                  : url.startsWith('/api/folders?')
                    ? { current: { id: 2, libraryId: 1, name: 'Trips' }, ancestors: [], items: [] }
                    : { items: [], nextCursor: null }
      return Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }))
    }),
  )
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <App />
    </QueryClientProvider>,
  )
  expect(await screen.findByRole('dialog', { name: 'selected.jpg' })).toBeVisible()
  expect(new URLSearchParams(window.location.search).get('media')).toBe('9')
  expect(new URLSearchParams(window.location.search).get('tag')).toBe('Trips')
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(new URLSearchParams(window.location.search).get('media')).toBeNull())
  expect(new URLSearchParams(window.location.search).get('folderId')).toBe('2')
})

it('organizes settings under consistent headings without an installation panel', async () => {
  emptyApi()
  renderApp()
  await userEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0])
  for (const name of [
    'Updates',
    'Theme & appearance',
    'Random media URL',
    'Metadata exchange',
    'Libraries',
    'Hidden folders',
    'Help',
    'About',
  ]) {
    expect(screen.getByRole('heading', { name, level: 2 })).toBeVisible()
  }
  expect(screen.getAllByRole('heading', { name: 'Metadata exchange' })).toHaveLength(1)
  expect(screen.getByRole('heading', { name: 'About' }).closest('section')).toHaveTextContent(
    `Luma v${packageJson.version}`,
  )
  expect(screen.getByTestId('desktop-version')).toHaveTextContent(`Luma v${packageJson.version}`)
  expect(screen.getByTestId('desktop-version').closest('aside')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', 'https://github.com/sameert89/luma')
  expect(screen.queryByText('Install Luma')).not.toBeInTheDocument()
})

describe('help', () => {
  function libraryApi() {
    const fetch = vi.fn().mockImplementation((url: string) => {
      const data =
        url === '/api/tasks'
          ? []
          : url === '/api/libraries'
            ? [{ id: 1, name: 'Photos', availability: 'available', rootFolderId: 1 }]
            : url.startsWith('/api/folders/hidden')
              ? []
              : url.startsWith('/api/folders?')
                ? { current: { id: 2, libraryId: 1, name: 'Trips' }, ancestors: [], items: [] }
                : url.startsWith('/api/indexing')
                  ? { libraries: [] }
                  : { items: [], nextCursor: null, previousCursor: null }
      return Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }))
    })
    vi.stubGlobal('fetch', fetch)
    return fetch
  }
  function navigationSize() {
    return screen
      .getAllByRole('navigation', { name: 'Primary navigation' })
      .map(nav => nav.querySelectorAll('button').length)
  }

  it('opens from a labeled button beside Your libraries and returns home', async () => {
    libraryApi()
    renderApp()
    await screen.findByRole('button', { name: 'Open Photos' })
    const navigation = navigationSize()
    const entry = screen.getByRole('button', { name: 'Help' })
    expect(entry).toHaveTextContent('Help')
    await userEvent.click(entry)
    expect(screen.getByRole('heading', { name: 'Help', level: 1 })).toBeVisible()
    expect(new URLSearchParams(window.location.search).get('view')).toBe('help')
    expect(new URLSearchParams(window.location.search).get('from')).toBe('library')
    // Help is not another bottom-bar destination.
    expect(navigationSize()).toEqual(navigation)
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('heading', { name: 'Your libraries' })).toBeVisible()
    expect(window.location.search).toBe('')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Help' })).toHaveFocus())
  })

  it('opens from Settings without losing folder scope or filters, and Back returns to Settings', async () => {
    window.history.replaceState(null, '', '/?libraryId=1&folderId=2&mediaType=video')
    resetStorage()
    const fetch = libraryApi()
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
        <App />
      </QueryClientProvider>,
    )
    await userEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0])
    expect(screen.queryByText('Viewer shortcuts')).not.toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Open the Help guide' })
    expect(link.getAttribute('href')).toContain('view=help')
    await userEvent.click(link)
    expect(screen.getByRole('heading', { name: 'Help', level: 1 })).toBeVisible()
    const params = new URLSearchParams(window.location.search)
    expect([params.get('folderId'), params.get('mediaType'), params.get('from')]).toEqual(['2', 'video', 'settings'])
    const requests = fetch.mock.calls.length
    await userEvent.click(screen.getByRole('link', { name: /Gestures and keyboard shortcuts/ }))
    expect(screen.getByRole('heading', { name: 'Gestures and keyboard shortcuts', level: 2 })).toHaveFocus()
    // Static content: reading Help requests no media, scans or tasks.
    expect(
      fetch.mock.calls.slice(requests).some(([url]) => /\/api\/(media|scans|libraries\/\d+\/scans)/.test(String(url))),
    ).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('heading', { name: 'Theme & appearance' })).toBeVisible()
    expect(window.location.search).toBe('?libraryId=1&folderId=2&mediaType=video')
    await userEvent.click(screen.getAllByRole('button', { name: 'Library' })[0])
    expect(await screen.findByRole('heading', { name: 'Trips' })).toBeVisible()
  })

  it('restores Help and its return destination from a refreshed URL', async () => {
    window.history.replaceState(null, '', '/?libraryId=1&folderId=2&view=help&from=settings')
    resetStorage()
    const fetch = libraryApi()
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
        <App />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('heading', { name: 'Help', level: 1 })).toBeVisible()
    expect(window.location.search).toBe('?libraryId=1&folderId=2&view=help&from=settings')
    expect(
      fetch.mock.calls.some(
        ([url, init]) => String(url).startsWith('/api/media') || (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('heading', { name: 'Theme & appearance' })).toBeVisible()
    expect(window.location.search).toBe('?libraryId=1&folderId=2')
  })
})

describe('folder actions', () => {
  const photo = {
    id: 7,
    libraryId: 1,
    folderId: 3,
    fileName: 'nested.jpg',
    mediaType: 'image',
    extension: '.jpg',
    preference: 'neutral',
    sizeBytes: 10,
    modifiedAt: '2026-01-01T00:00:00Z',
    thumbnail: { status: 'ready', url: '/thumb.jpg' },
    preview: { status: 'ready', url: '/preview.jpg' },
    tags: [],
  }
  function folderApi() {
    const fetch = vi.fn().mockImplementation((url: string) => {
      const text = String(url)
      const data =
        text === '/api/tasks'
          ? []
          : text === '/api/libraries'
            ? [{ id: 1, name: 'Photos', rootFolderId: 1, metadataMode: 'xmp' }]
            : text.startsWith('/api/folders?')
              ? {
                  current: { id: 2, libraryId: 1, parentId: 1, name: 'Trips' },
                  ancestors: [],
                  items: [{ id: 3, libraryId: 1, name: 'Beach' }],
                }
              : text.startsWith('/api/indexing')
                ? { libraries: [{ id: 1, name: 'Photos', availability: 'available', latestScanId: null }] }
                : text.includes('/neighbors?')
                  ? { previous: null, next: null }
                  : text === '/api/media/7'
                    ? photo
                    : // The folder holds only subfolders: media appears only when subfolders are included.
                      text.startsWith('/api/media?')
                      ? {
                          items: text.includes('recursive=true') ? [photo] : [],
                          nextCursor: null,
                          previousCursor: null,
                        }
                      : { items: [], nextCursor: null, previousCursor: null }
      return Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }))
    })
    vi.stubGlobal('fetch', fetch)
    return fetch
  }
  function renderFolder() {
    window.history.replaceState(null, '', '/?libraryId=1&folderId=2')
    resetStorage()
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
        <App />
      </QueryClientProvider>,
    )
  }

  it('starts a slideshow of a folder that only contains subfolders', async () => {
    const fetch = folderApi()
    renderFolder()
    await userEvent.click(await screen.findByRole('button', { name: 'Folder actions for Trips' }))
    await userEvent.click(screen.getByRole('button', { name: 'Start slideshow' }))
    expect(await screen.findByRole('dialog', { name: 'nested.jpg' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Slideshow' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() =>
      expect(
        fetch.mock.calls.some(([url]) => String(url).includes('/neighbors?') && String(url).includes('recursive=true')),
      ).toBe(true),
    )
  })

  it('includes media in subfolders when switching from a folder to Reels', async () => {
    const fetch = folderApi()
    renderFolder()
    await screen.findByRole('heading', { name: 'Trips' })
    await userEvent.click(screen.getAllByRole('button', { name: 'Reels' })[0])
    await waitFor(() =>
      expect(
        fetch.mock.calls.some(([url]) => {
          const value = String(url)
          return (
            value.startsWith('/api/media?') &&
            value.includes('folderId=2') &&
            value.includes('recursive=true') &&
            value.includes('mediaType=motion')
          )
        }),
      ).toBe(true),
    )
    expect(new URLSearchParams(window.location.search).get('recursive')).toBe('true')
  })

  it('rescans a folder and everything inside it from its menu, only after confirmation', async () => {
    const fetch = folderApi()
    renderFolder()
    const posted = () =>
      fetch.mock.calls.filter(
        ([url, init]) => String(url).endsWith('/scans') && (init as RequestInit | undefined)?.method === 'POST',
      )
    // Refresh collection only reloads what is shown; it never starts a scan.
    await userEvent.click(await screen.findByRole('button', { name: 'Folder actions for Trips' }))
    await userEvent.click(screen.getByRole('button', { name: 'Refresh collection' }))
    expect(posted()).toHaveLength(0)
    await userEvent.click(await screen.findByRole('button', { name: 'Folder actions for Trips' }))
    await userEvent.click(screen.getByRole('button', { name: 'Rescan folder' }))
    const dialog = screen.getByRole('dialog', { name: 'Rescan folder' })
    expect(dialog).toHaveTextContent('every folder inside it')
    expect(posted()).toHaveLength(0)
    // The choice starts from the library's own setting.
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Tag import' })).toHaveValue('xmp'))
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Tag import' }), 'none')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start rescan' }))
    await waitFor(() => expect(posted()).toHaveLength(1))
    expect(posted()[0][0]).toBe('/api/folders/2/scans')
    expect(JSON.parse(String((posted()[0][1] as RequestInit).body))).toEqual({ metadataMode: 'none' })
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Rescan queued')
  })

  it('orders folders by their date for date sorts and by name for every other sort', async () => {
    const fetch = folderApi()
    const folderSorts = () =>
      fetch.mock.calls
        .map(([url]) => String(url))
        .filter(url => url.startsWith('/api/folders?'))
        .map(url => new URLSearchParams(url.split('?')[1]).get('sort'))
    renderFolder()
    await screen.findByRole('button', { name: 'Folder actions for Trips' })
    // The default media sort is by date modified, so folders follow their own modified time.
    expect(folderSorts().at(-1)).toBe('modified')
    for (const [sort, expected] of [
      ['name', 'name'],
      ['size', 'name'],
      ['captured', 'modified'],
    ]) {
      window.history.replaceState(null, '', `/?libraryId=1&folderId=2&sort=${sort}`)
      cleanup()
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
          <App />
        </QueryClientProvider>,
      )
      await screen.findByRole('button', { name: 'Folder actions for Trips' })
      expect(folderSorts().at(-1)).toBe(expected)
    }
  })

  it('shows folder information without library scan status', async () => {
    folderApi()
    renderFolder()
    await userEvent.click(await screen.findByRole('button', { name: 'Folder actions for Trips' }))
    await userEvent.click(screen.getByRole('button', { name: 'Folder information' }))
    const dialog = screen.getByRole('dialog', { name: 'Folder information' })
    expect(dialog).toHaveTextContent('Photos')
    expect(within(dialog).queryByRole('region', { name: 'Library indexing' })).not.toBeInTheDocument()
  })
})

it('remembers filter-row visibility separately for Reels', async () => {
  window.history.replaceState(null, '', '/?libraryId=1&folderId=2')
  resetStorage()
  const photo = {
    id: 7,
    libraryId: 1,
    folderId: 2,
    fileName: 'beach.jpg',
    mediaType: 'image',
    extension: '.jpg',
    sizeBytes: 10,
    modifiedAt: '2026-01-01T00:00:00Z',
    preference: 'neutral',
    thumbnail: { status: 'ready', url: '/thumb.jpg' },
    preview: { status: 'ready', url: '/preview.jpg' },
    tags: [],
  }
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      const text = String(url)
      const data =
        text === '/api/tasks'
          ? []
          : text === '/api/libraries'
            ? [{ id: 1, name: 'Photos', rootFolderId: 1 }]
            : text.startsWith('/api/folders?')
              ? { current: { id: 2, libraryId: 1, name: 'Trips' }, ancestors: [], items: [] }
              : text.startsWith('/api/indexing')
                ? { libraries: [] }
                : text.includes('/neighbors?')
                  ? { previous: null, next: null }
                  : /\/api\/media\/\d+$/.test(text)
                    ? photo
                    : { items: [photo], nextCursor: null, previousCursor: null }
      return Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }))
    }),
  )
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  try {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
        <App />
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('navigation', { name: 'Active filters' })).toBeVisible()
    await userEvent.click((await screen.findAllByRole('button', { name: 'Reels' }))[0])
    expect(screen.getByRole('navigation', { name: 'Active filters' })).toBeVisible()
    await userEvent.click(await screen.findByRole('button', { name: 'Reels menu' }))
    await userEvent.click(screen.getByRole('button', { name: 'Hide filters' }))
    expect(screen.queryByRole('navigation', { name: 'Active filters' })).not.toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: 'Library' })[0])
    expect(await screen.findByRole('navigation', { name: 'Active filters' })).toBeVisible()
    await userEvent.click((await screen.findAllByRole('button', { name: 'Reels' }))[0])
    expect(screen.queryByRole('navigation', { name: 'Active filters' })).not.toBeInTheDocument()
  } finally {
    vi.restoreAllMocks()
  }
})

it('pulls the folder in view to the front of a running scan, and says a refusal in a toast', async () => {
  const rescans: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/index') && init?.method === 'POST') return Promise.resolve(new Response(null, { status: 204 }))
      if (url.includes('/scans') && init?.method === 'POST') {
        rescans.push(String(init.body))
        // A scan the running one will never reach still refuses, which is what the person sees.
        return Promise.resolve(
          new Response(JSON.stringify({ code: 'conflict', title: 'A scan for this library is already running.' }), {
            status: 409,
            headers: { 'Content-Type': 'application/problem+json' },
          }),
        )
      }
      const data =
        url === '/api/libraries'
          ? [{ id: 1, name: 'Photos', rootFolderId: 1, metadataMode: 'xmp' }]
          : url.startsWith('/api/folders?')
            ? { current: { id: 2, libraryId: 1, name: 'Trips' }, ancestors: [], items: [] }
            : url.startsWith('/api/indexing')
              ? { libraries: [] }
              : { items: [], nextCursor: null, previousCursor: null }
      return Promise.resolve(
        new Response(JSON.stringify(url === '/api/tasks' ? [] : data), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }),
  )
  window.history.replaceState(null, '', '/?libraryId=1&folderId=2')
  resetStorage()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <App />
    </QueryClientProvider>,
  )
  await screen.findByRole('heading', { name: 'Trips' })
  const scroller = screen.getByTestId('gallery-scroll')
  fireEvent.touchStart(scroller, { touches: [{ clientY: 0 }] })
  fireEvent.touchMove(scroller, { touches: [{ clientY: 200 }] })
  await act(async () => {
    fireEvent.touchEnd(scroller)
  })

  // The folder in view, its library's own tag setting, one directory deep, moved to the front.
  expect(JSON.parse(rescans[0])).toEqual({ metadataMode: 'xmp', prioritize: true, shallow: true })
  const toast = await screen.findByRole('alert')
  expect(toast).toHaveTextContent('already running')
  // In a toast that can be closed, not pinned above the collection.
  await userEvent.click(within(toast).getByRole('button', { name: 'Dismiss' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('points the page at the manifest built for the chosen theme, and tints browser chrome with it', async () => {
  document.head.innerHTML =
    '<meta name="theme-color" content="#111319" /><link rel="manifest" href="/manifest.webmanifest" />'
  emptyApi()
  renderApp()
  await userEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0])
  await userEvent.click(await screen.findByRole('button', { name: 'Nord' }))

  // An installed app reads the manifest, a browser tab reads the meta colour: both follow.
  expect(document.querySelector('link[rel="manifest"]')).toHaveAttribute('href', '/manifest-nord.webmanifest')
  expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#2e3440')
  expect(localStorage.getItem('luma-theme')).toBe('nord')
})
