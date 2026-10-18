import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { ComicDetails } from './ComicDetails'
import type { Comic } from './api'

const comic: Comic = {
  id: 1,
  libraryId: 1,
  title: 'Moon',
  series: 'Night',
  author: 'Writer',
  description: 'A story',
  format: 'zip',
  pageCount: 5000,
  pageIndex: 2,
  state: 'reading',
  readingSeconds: 10,
  direction: 'ltr',
  settings: '{}',
  lastReadAt: null,
  favourite: true,
  coverUrl: null,
  coverPage: 17,
}
function mount(fail = false) {
  const fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
    Promise.resolve(
      init?.method === 'PUT'
        ? fail
          ? new Response(JSON.stringify({ code: 'mutation_unauthorized', title: 'Unlock file management.' }), {
              status: 401,
              headers: { 'Content-Type': 'application/problem+json' },
            })
          : new Response(null, { status: 204 })
        : new Response(JSON.stringify(comic), { headers: { 'Content-Type': 'application/json' } }),
    ),
  )
  vi.stubGlobal('fetch', fetch)
  const saved = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(
    <QueryClientProvider client={client}>
      <ComicDetails id={1} onSaved={saved} />
    </QueryClientProvider>,
  )
  return { fetch, saved }
}
it('preserves a non-first cover and other metadata when editing the title', async () => {
  const { fetch, saved } = mount()
  const title = await screen.findByRole('textbox', { name: 'Title' })
  expect(screen.getByRole('spinbutton', { name: 'Cover page' })).toHaveValue(18)
  expect(screen.queryAllByRole('option')).toHaveLength(0)
  await userEvent.clear(title)
  await userEvent.type(title, 'New title')
  await userEvent.click(screen.getByRole('button', { name: 'Save comic details' }))
  await waitFor(() => expect(saved).toHaveBeenCalledOnce())
  const put = fetch.mock.calls.find(call => call[1]?.method === 'PUT')!
  expect(JSON.parse(put[1].body)).toEqual({
    title: 'New title',
    series: 'Night',
    author: 'Writer',
    description: 'A story',
    favourite: true,
    coverPage: 17,
  })
})
it('sends a selected cover as a zero-based page and favourite changes', async () => {
  const { fetch } = mount()
  const cover = await screen.findByRole('spinbutton', { name: 'Cover page' })
  await userEvent.clear(cover)
  await userEvent.type(cover, '5000')
  await userEvent.click(screen.getByRole('checkbox', { name: 'Favourite' }))
  await userEvent.click(screen.getByRole('button', { name: 'Save comic details' }))
  await waitFor(() => expect(fetch.mock.calls.some(call => call[1]?.method === 'PUT')).toBe(true))
  expect(JSON.parse(fetch.mock.calls.find(call => call[1]?.method === 'PUT')![1].body)).toMatchObject({
    coverPage: 4999,
    favourite: false,
  })
})
it('keeps the draft and shows an authorization failure for retry', async () => {
  const { saved } = mount(true)
  await screen.findByRole('textbox', { name: 'Title' })
  await userEvent.click(screen.getByRole('button', { name: 'Save comic details' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Unlock file management.')
  expect(saved).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Moon')
  expect(screen.getByRole('button', { name: 'Save comic details' })).toBeEnabled()
})
