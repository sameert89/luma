import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { Panels } from './Panels'

beforeEach(() => {
  localStorage.removeItem('luma-panels-query')
  window.history.replaceState({}, '', '/panels')
})
function mount(nextCursor: number | null = null, configured = true) {
  const fetch = vi.fn().mockImplementation((url: string) =>
    Promise.resolve(
      new Response(
        JSON.stringify(
          url.includes('/suggestions')
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
                    : { items: [], nextCursor },
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
  expect(screen.getByRole('textbox', { name: 'Series filter' })).toHaveValue('Moon')
  expect(screen.getByRole('combobox', { name: 'Search comics' })).toHaveValue('')
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/panels/comics?series=Moon', expect.anything()))
})
it('restores favourites from a deep link and persists changes', async () => {
  window.history.replaceState({}, '', '/panels?favourite=true')
  const fetch = mount()
  const filter = screen.getByRole('checkbox', { name: 'Favourites only' })
  expect(filter).toBeChecked()
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/panels/comics?favourite=true', expect.anything()))
  await userEvent.click(filter)
  await waitFor(() => expect(localStorage.getItem('luma-panels-query')).toBe(''))
  expect(window.location.search).toBe('')
})
it('starts from the first page when the favourites filter changes', async () => {
  const fetch = mount(60)
  await userEvent.click(await screen.findByRole('button', { name: 'More comics' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/panels/comics?cursor=60', expect.anything()))
  await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
  await userEvent.click(screen.getByRole('checkbox', { name: 'Favourites only' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/panels/comics?favourite=true', expect.anything()))
  expect(screen.queryByRole('button', { name: 'Newest comics' })).not.toBeInTheDocument()
})

it('first visit saves recursive comic locations without file-management unlock', async () => {
  const fetch = mount(null, false)
  expect(await screen.findByRole('heading', { name: 'Choose where your comics live' })).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Add location' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Manga' }))
  await userEvent.click(screen.getByRole('button', { name: 'Use this folder' }))
  await userEvent.click(screen.getByRole('button', { name: 'Save locations and scan' }))
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/panels/sources',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ locations: [{ libraryId: 1, relativePath: 'Manga', imageFolders: false }] }),
      }),
    ),
  )
})
