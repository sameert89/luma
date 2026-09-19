import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { TagEditor } from './TagEditor'

function api() {
  const fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url === '/api/tags' && init?.method === 'POST') return Promise.resolve(new Response(JSON.stringify({ id: 9, name: 'Beach day' })))
    if (url === '/api/media/tags') return Promise.resolve(new Response(null, { status: 204 }))
    return Promise.resolve(new Response(JSON.stringify([{ id: 1, name: 'Beach' }, { id: 2, name: 'Beaches' }])))
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}
const renderEditor = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
  <TagEditor mediaIds={[7]} tags={[{ id: 1, name: 'Beach' }]} />
</QueryClientProvider>)
const tagged = (fetch: ReturnType<typeof api>) => fetch.mock.calls.filter(([url]) => url === '/api/media/tags').map(([, init]) => JSON.parse(String((init as RequestInit).body)))

it('lists matching tags as it types, marks ones already on the item and adds a chosen one', async () => {
  const fetch = api()
  renderEditor()
  const field = screen.getByRole('searchbox', { name: 'Find or create a tag' })
  // The field offers no browser or keyboard autocomplete of its own; the list below replaces it.
  expect(field).toHaveAttribute('autocomplete', 'off')
  expect(document.querySelector('datalist')).toBeNull()
  await userEvent.type(field, 'bea')
  const results = await screen.findByRole('list', { name: 'Matching tags' })
  expect(within(results).getByRole('button', { name: /Beach\s*Added/ })).toBeDisabled()
  await userEvent.click(within(results).getByRole('button', { name: /Beaches/ }))
  await waitFor(() => expect(tagged(fetch)).toEqual([{ mediaIds: [7], addTagIds: [2], removeTagIds: [] }]))
  expect(field).toHaveValue('')
})

it('offers to create a tag that does not exist yet, and reaches results with the arrow keys', async () => {
  const fetch = api()
  renderEditor()
  const field = screen.getByRole('searchbox', { name: 'Find or create a tag' })
  await userEvent.type(field, 'Beach day')
  const create = await screen.findByRole('button', { name: /Create “Beach day”/ })
  await userEvent.keyboard('{ArrowDown}')
  expect(screen.getByRole('button', { name: /Beaches/ })).toHaveFocus()
  await userEvent.keyboard('{ArrowUp}')
  expect(field).toHaveFocus()
  await userEvent.click(create)
  await waitFor(() => expect(tagged(fetch)).toEqual([{ mediaIds: [7], addTagIds: [9], removeTagIds: [] }]))
})
