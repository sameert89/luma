import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { TagGroups } from './TagGroups'

it('opens an independently paginated tag collection without changing any-tag filter semantics', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [{ id: 1, name: 'Trips' }], nextId: null }))))
  const choose = vi.fn()
  const filters = { tag: ['A', 'C'], tagMode: 'any', folderId: 2, groupBy: 'tag' }
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><TagGroups filters={filters} onChoose={choose} /></QueryClientProvider>)
  await userEvent.click(await screen.findByRole('button', { name: 'Browse Trips' }))
  expect(choose).toHaveBeenCalledWith({ ...filters, collectionTag: 'Trips', groupBy: 'none' })
})
