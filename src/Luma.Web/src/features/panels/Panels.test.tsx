import type { Comic } from './api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { Panels } from './Panels'

vi.mock('./ComicReader', () => ({
  ComicReader: ({ onExit }: { onExit: () => void }) => <button onClick={onExit}>Exit reader</button>,
}))

beforeEach(() => {
  localStorage.removeItem('luma-panels-query')
  localStorage.removeItem('luma-panels-sort')
  window.history.replaceState({}, '', '/panels')
})
function mount(
  nextCursor: number | null = null,
  configured = true,
  resume: Comic[] = [],
  response?: (url: string) => unknown,
) {
  const fetch = vi.fn().mockImplementation((url: string) =>
    Promise.resolve(
      new Response(
        JSON.stringify(
          response?.(url) ??
            (url === '/api/panels/continue-reading'
              ? resume
              : url.includes('/suggestions') || url === '/api/tasks'
                ? []
                : url.includes('/source-folders')
                  ? { items: [{ name: 'Manga', relativePath: 'Manga' }], nextOffset: null }
                  : url === '/api/libraries'
                    ? [{ id: 1, name: 'Comics', rootFolderId: 1 }]
                    : url.includes('/sources')
                      ? {
                          configured,
                          locations: configured ? [{ libraryId: 1, relativePath: '', imageFolders: false }] : [],
                        }
                      : url.includes('/statistics')
                        ? {}
                        : { items: [], nextCursor }),
        ),
        {
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    ),
  )
  vi.stubGlobal('fetch', fetch)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(
    <QueryClientProvider client={client}>
      <Panels logo={<span>Luma</span>} onSettings={vi.fn()} />
    </QueryClientProvider>,
  )
  return fetch
}
it('honours a series-only deep link over a saved query', async () => {
  localStorage.setItem('luma-panels-query', 'q=old&series=Previous')
  window.history.replaceState({}, '', '/panels?series=Moon')
  const fetch = mount()
  expect(screen.getByRole('combobox', { name: 'Search comics' })).toHaveValue('')
  await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
  expect(screen.getByRole('textbox', { name: 'Series filter' })).toHaveValue('Moon')
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith('/api/panels/comics?series=Moon&sort=title&order=asc', expect.anything()),
  )
})
it('restores favourites from a deep link and persists changes', async () => {
  window.history.replaceState({}, '', '/panels?favourite=true')
  const fetch = mount()
  await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
  const filter = screen.getByRole('checkbox', { name: 'Favourites only' })
  expect(filter).toBeChecked()
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith('/api/panels/comics?favourite=true&sort=title&order=asc', expect.anything()),
  )
  await userEvent.click(filter)
  await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
  await waitFor(() => expect(localStorage.getItem('luma-panels-query')).toBe(''))
  expect(window.location.search).toBe('')
})
it('starts from the first page when the favourites filter changes', async () => {
  window.history.replaceState({}, '', '/panels?libraryId=1&path=')
  const fetch = mount(60)
  await userEvent.click(await screen.findByRole('button', { name: 'Next page' }))
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/panels/comics?libraryId=1&path=&cursor=60&sort=title&order=asc',
      expect.anything(),
    ),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
  await userEvent.click(screen.getByRole('checkbox', { name: 'Favourites only' }))
  await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/panels/comics?favourite=true&libraryId=1&sort=title&order=asc',
      expect.anything(),
    ),
  )
  expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
})

it('first visit saves recursive comic locations without file-management unlock', async () => {
  const fetch = mount(null, false)
  expect(await screen.findByRole('heading', { name: 'Choose where your comics live' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Save locations and scan' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Add comic location' }))
  await userEvent.click(screen.getByRole('button', { name: 'Add location' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Manga' }))
  await userEvent.click(screen.getByRole('button', { name: 'Use this folder' }))
  await userEvent.click(screen.getByRole('button', { name: 'Save locations and scan' }))
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/panels/sources',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          locations: [{ libraryId: 1, relativePath: 'Manga', imageFolders: false, excludeFromGallery: true }],
        }),
      }),
    ),
  )
})

it('browses saved locations before listing their direct comics', async () => {
  const fetch = mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Open Comics' }))
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith('/api/panels/folders?libraryId=1&path=&order=asc', expect.anything()),
  )
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith('/api/panels/comics?libraryId=1&path=&sort=title&order=asc', expect.anything()),
  )
  expect(window.location.search).toBe('?libraryId=1&path=')
})

it('shows at most five continued books with saved page indicators and one location-management action', async () => {
  const comics: Comic[] = Array.from({ length: 6 }, (_, index) => ({
    id: index + 1,
    libraryId: 1,
    title: `Recent ${index + 1}`,
    series: 'Series',
    author: '',
    description: '',
    format: 'zip',
    pageCount: 10,
    pageIndex: 3,
    state: 'reading',
    readingSeconds: 4,
    direction: 'ltr',
    settings: '{}',
    lastReadAt: '2026-10-19',
    favourite: false,
    coverUrl: null,
    coverPage: 0,
  }))
  mount(null, true, comics)
  const row = await screen.findByRole('region', { name: 'Continue reading' })
  expect(within(row).getAllByRole('button', { name: /^Read Recent/ })).toHaveLength(5)
  expect(within(row).getByRole('progressbar', { name: 'Reading progress for Recent 1' })).toHaveAttribute(
    'aria-valuenow',
    '4',
  )
  expect(screen.getAllByRole('button', { name: 'Comic locations' })).toHaveLength(1)
  expect(screen.queryByText('Loading comics…')).not.toBeInTheDocument()
})

it('starts with title ascending and keeps a chosen order when entering a folder', async () => {
  const fetch = mount()
  await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
  expect(await screen.findByRole('combobox', { name: 'Sort by' })).toHaveValue('title')
  expect(screen.getByRole('combobox', { name: 'Sort direction' })).toHaveValue('asc')
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort direction' }), 'desc')
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'modified')
  await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
  await userEvent.click(screen.getByRole('button', { name: 'Open Comics' }))
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/panels/comics?libraryId=1&path=&sort=modified&order=desc',
      expect.anything(),
    ),
  )
  expect(JSON.parse(localStorage.getItem('luma-panels-sort')!)).toEqual({ sort: 'modified', order: 'desc' })
})

it('restores the saved sort and resets both pagers when it changes', async () => {
  localStorage.setItem('luma-panels-sort', '{"sort":"added","order":"desc"}')
  window.history.replaceState({}, '', '/panels?libraryId=1&path=')
  const fetch = mount(60)
  await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
  expect(await screen.findByRole('combobox', { name: 'Sort by' })).toHaveValue('added')
  expect(screen.getByRole('combobox', { name: 'Sort direction' })).toHaveValue('desc')
  await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Next page' }))
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/panels/comics?libraryId=1&path=&cursor=60&sort=added&order=desc',
      expect.anything(),
    ),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'title')
  await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith('/api/panels/comics?libraryId=1&path=&sort=title&order=desc', expect.anything()),
  )
  expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
})

it('falls back to reading order for a damaged saved preference', async () => {
  localStorage.setItem('luma-panels-sort', 'not JSON')
  mount()
  await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
  expect(await screen.findByRole('combobox', { name: 'Sort by' })).toHaveValue('title')
  expect(screen.getByRole('combobox', { name: 'Sort direction' })).toHaveValue('asc')
})

it('keeps only locations beside the library title and discards unapplied popup edits', async () => {
  window.history.replaceState({}, '', '/panels?libraryId=1&path=')
  const fetch = mount()
  await screen.findByRole('button', { name: 'Comic locations' })
  expect(screen.queryByRole('combobox', { name: 'Sort by' })).not.toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: 'Series filter' })).not.toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: 'Comic locations' })).toHaveLength(1)
  await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
  const dialog = screen.getByRole('dialog', { name: 'Filters and sorting' })
  expect(within(dialog).getByRole('combobox', { name: 'Reading status' })).toBeVisible()
  expect(within(dialog).getByRole('textbox', { name: 'Comic tag filter' })).toBeVisible()
  await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Sort direction' }), 'desc')
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Series filter' }), 'Draft')
  expect(JSON.parse(localStorage.getItem('luma-panels-sort')!)).toEqual({ sort: 'title', order: 'asc' })
  expect(fetch.mock.calls.some(([url]) => String(url).includes('series=Draft'))).toBe(false)
  await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(window.history.state?.lumaModal).toBeFalsy())
  await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
  expect(screen.getByRole('combobox', { name: 'Sort direction' })).toHaveValue('asc')
  expect(screen.getByRole('textbox', { name: 'Series filter' })).toHaveValue('')
})

it('resets filters and sort together while preserving the current folder', async () => {
  window.history.replaceState({}, '', '/panels?libraryId=1&path=Manga&series=Moon&favourite=true')
  localStorage.setItem('luma-panels-sort', '{"sort":"modified","order":"desc"}')
  const fetch = mount()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
  await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/panels/comics?libraryId=1&path=Manga&sort=title&order=asc',
      expect.anything(),
    ),
  )
  expect(window.location.search).toBe('?libraryId=1&path=Manga')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(JSON.parse(localStorage.getItem('luma-panels-sort')!)).toEqual({ sort: 'title', order: 'asc' })
})

const book = (id: number): Comic => ({
  id,
  libraryId: 1,
  title: `Comic ${id}`,
  series: '',
  author: '',
  description: '',
  format: 'zip',
  pageCount: 2,
  pageIndex: 0,
  state: 'unread',
  readingSeconds: 0,
  direction: 'ltr',
  settings: '{}',
  lastReadAt: null,
  favourite: false,
  coverUrl: null,
  coverPage: 0,
})
function pagedLibrary(url: string) {
  if (/\/comics\/\d+$/.test(url)) return book(Number(url.split('/').at(-1)))
  if (!url.startsWith('/api/panels/comics?')) return undefined
  const cursor = Number(new URL(url, window.location.origin).searchParams.get('cursor'))
  return { items: [book(cursor + 1)], nextCursor: cursor < 120 ? cursor + 60 : null }
}

it('moves one page at a time, starts at the top and disables Next on the last page', async () => {
  window.history.replaceState({}, '', '/panels?libraryId=1&path=')
  mount(null, true, [], pagedLibrary)
  const first = await screen.findByRole('button', { name: 'Read Comic 1' })
  const shelf = first.closest('.overflow-auto') as HTMLElement
  shelf.scrollTop = 400
  fireEvent.scroll(shelf)
  expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
  await screen.findByRole('button', { name: 'Read Comic 61' })
  expect(shelf.scrollTop).toBe(0)
  expect(screen.getByText('Page 2')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
  await screen.findByRole('button', { name: 'Read Comic 121' })
  expect(screen.getByText('Page 3')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Previous page' }))
  await screen.findByRole('button', { name: 'Read Comic 61' })
  expect(screen.getByText('Page 2')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Previous page' }))
  await screen.findByRole('button', { name: 'Read Comic 1' })
  expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
})

it('restores the current comic page and scroll after Exit and browser Back', async () => {
  window.history.replaceState({}, '', '/panels?libraryId=1&path=')
  mount(null, true, [], pagedLibrary)
  await screen.findByRole('button', { name: 'Read Comic 1' })
  await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
  let comic = await screen.findByRole('button', { name: 'Read Comic 61' })
  let shelf = comic.closest('.overflow-auto') as HTMLElement
  shelf.scrollTop = 420
  fireEvent.scroll(shelf)
  await userEvent.click(comic)
  await userEvent.click(await screen.findByRole('button', { name: 'Exit reader' }))
  comic = await screen.findByRole('button', { name: 'Read Comic 61' })
  shelf = comic.closest('.overflow-auto') as HTMLElement
  expect(shelf.scrollTop).toBe(420)
  expect(screen.getByText('Page 2')).toBeVisible()
  await userEvent.click(comic)
  await screen.findByRole('button', { name: 'Exit reader' })
  window.history.back()
  comic = await screen.findByRole('button', { name: 'Read Comic 61' })
  expect((comic.closest('.overflow-auto') as HTMLElement).scrollTop).toBe(420)
  expect(screen.getByText('Page 2')).toBeVisible()
})

it('restores the bookshelf page and scroll on browser Back from a nested folder', async () => {
  window.history.replaceState({}, '', '/panels?libraryId=1&path=')
  mount(null, true, [], url =>
    url.startsWith('/api/panels/folders?')
      ? { items: [{ name: 'Manga', relativePath: 'Manga', coverUrls: [] }], nextCursor: null }
      : pagedLibrary(url),
  )
  await screen.findByRole('button', { name: 'Read Comic 1' })
  await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
  const comic = await screen.findByRole('button', { name: 'Read Comic 61' })
  const shelf = comic.closest('.overflow-auto') as HTMLElement
  shelf.scrollTop = 240
  fireEvent.scroll(shelf)
  await userEvent.click(screen.getByRole('button', { name: 'Open Manga' }))
  await screen.findByRole('button', { name: 'Read Comic 1' })
  window.history.back()
  await screen.findByRole('button', { name: 'Read Comic 61' })
  expect(screen.getByText('Page 2')).toBeVisible()
  expect(shelf.scrollTop).toBe(240)
})

it('requests a folder timestamp refresh separately from indexed browsing on open', async () => {
  window.history.replaceState({}, '', '/panels?libraryId=1&path=Manga')
  const fetch = mount()
  await waitFor(() =>
    expect(
      fetch.mock.calls.some(
        ([url, init]) =>
          url === '/api/panels/refresh' && init?.method === 'POST' && JSON.parse(init.body).relativePath === 'Manga',
      ),
    ).toBe(true),
  )
  expect(fetch.mock.calls.filter(([url]) => url === '/api/panels/refresh')).toHaveLength(1)
  expect(fetch.mock.calls.some(([url]) => url === '/api/panels/discover')).toBe(false)
})

it('refreshes saved source folders from the bookshelf without starting a full-library scan', async () => {
  const fetch = mount()
  await waitFor(() =>
    expect(
      fetch.mock.calls.some(
        ([url, init]) =>
          url === '/api/panels/refresh' && init?.method === 'POST' && JSON.parse(init.body).libraryId === 1,
      ),
    ).toBe(true),
  )
  expect(fetch.mock.calls.some(([url]) => url === '/api/panels/discover')).toBe(false)
})

it('does not request source access for a search', async () => {
  window.history.replaceState({}, '', '/panels?q=moon')
  const fetch = mount()
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.includes('/api/panels/comics?'))).toBe(true))
  expect(fetch.mock.calls.some(([url]) => url === '/api/panels/refresh')).toBe(false)
})

it('shows the ten most recently added comics in a separate horizontal row on the bookshelf', async () => {
  const comics = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    title: `New ${index + 1}`,
    format: 'pdf',
    pageCount: 41,
    pageIndex: 0,
    state: 'unread',
  }))
  mount(null, true, [], url => (url === '/api/panels/recently-added' ? comics : undefined))
  const row = await screen.findByRole('region', { name: 'Recently added' })
  expect(within(row).getAllByRole('button', { name: /^Read New/ })).toHaveLength(10)
  expect(within(row).getAllByRole('button', { name: /^Edit details for/ })).toHaveLength(10)
  expect(within(row).queryByText('New 11')).not.toBeInTheDocument()
})
