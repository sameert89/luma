import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { DeleteMediaAction } from './DeleteMediaAction'

const photo = { id: 7, libraryId: 1, fileName: 'photo.jpg', availability: 'present' }
function setup(writable = true) {
  const fetch = vi.fn(
    async (url: string, init?: RequestInit) =>
      new Response(
        JSON.stringify(
          url.includes('capabilities')
            ? { accessConfigured: true, libraries: [{ libraryId: 1, writable }] }
            : { id: 'queued' },
        ),
        { status: init?.method === 'POST' ? 202 : 200 },
      ),
  )
  vi.stubGlobal('fetch', fetch)
  const queued = vi.fn(),
    changed = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui = (item = photo) => (
    <QueryClientProvider client={client}>
      <DeleteMediaAction item={item} onQueued={queued} onOpenChange={changed} />
    </QueryClientProvider>
  )
  const view = render(ui())
  return { fetch, queued, changed, item: (item: typeof photo) => view.rerender(ui(item)) }
}
test('viewer deletion confirms recycling, queues once and never waits for filesystem completion', async () => {
  const { fetch, queued } = setup()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Delete file' }))
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  expect(fetch.mock.calls.some(call => call[1]?.method === 'POST')).toBe(false)
  await user.click(screen.getByRole('button', { name: 'Move to recycle bin' }))
  await waitFor(() => expect(queued).toHaveBeenCalledOnce())
  expect(fetch).toHaveBeenCalledWith(
    '/api/files/items',
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ libraryId: 1, mediaId: 7, kind: 'recycle' }) }),
  )
  expect(fetch.mock.calls.some(call => call[0].includes('/operations/'))).toBe(false)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
test('a read-only library disables viewer deletion', async () => {
  setup(false)
  expect(await screen.findByRole('button', { name: 'Delete file' })).toBeDisabled()
})
test('the confirmation keeps its original target if the viewer item changes', async () => {
  const view = setup()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Delete file' }))
  view.item({ ...photo, id: 8, fileName: 'video.mp4' })
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: 'Delete permanently' }))
  await waitFor(() => expect(view.queued).toHaveBeenCalledOnce())
  expect(view.fetch).toHaveBeenCalledWith(
    '/api/files/items',
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ libraryId: 1, mediaId: 7, kind: 'delete' }) }),
  )
})
