import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import { RecycleBin } from './FileToolbar'
import { request } from '../browse/api'
import { waitForOperation } from './operations'
vi.mock('../browse/api', () => ({ request: vi.fn(), errorMessage: (error: unknown) => String(error) }))
vi.mock('./operations', () => ({ waitForOperation: vi.fn().mockResolvedValue({ state: 'completed' }) }))

function setup(count: number, reject = false) {
  const pending = new Set<string>()
  const entries = Array.from({ length: count }, (_, index) => ({
    id: String(index),
    source: `photo-${index}.jpg`,
    createdAt: '2026-10-24T00:00:00Z',
  }))
  vi.mocked(request)
    .mockReset()
    .mockImplementation(async (url, _signal, method, body) => {
      if (method === 'POST') {
        if (reject) throw new Error('Library unavailable')
        const id = (body as { recycleId: string }).recycleId
        if (pending.has(id)) throw new Error('Duplicate action')
        pending.add(id)
        return { id: `operation-${id}` }
      }
      if (url.startsWith('/api/files/trash')) return entries.filter(item => !pending.has(item.id)).slice(0, 100)
      throw new Error(`Unexpected: ${url}`)
    })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RecycleBin libraryId={1} />
    </QueryClientProvider>,
  )
  return pending
}

test('permanent deletion uses a separate confirmation and removes admitted rows immediately', async () => {
  const user = userEvent.setup()
  const pending = setup(2)
  await user.click((await screen.findAllByRole('button', { name: 'Permanently delete' }))[0])
  expect(pending.size).toBe(0)
  const dialog = screen.getByRole('dialog', { name: 'Permanently delete' })
  expect(dialog).toHaveTextContent('photo-0.jpg')
  await user.click(within(dialog).getByRole('button', { name: 'Confirm permanent deletion' }))
  await waitFor(() => expect(screen.queryByText('photo-0.jpg')).not.toBeInTheDocument())
  expect(screen.getByText('photo-1.jpg')).toBeVisible()
  expect(pending.size).toBe(1)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})

test.each(['Restore all', 'Empty bin'])('%s includes older pages and submits each item once', async label => {
  const user = userEvent.setup()
  const pending = setup(102)
  await screen.findByText('photo-0.jpg')
  await user.click(screen.getByRole('button', { name: label }))
  if (label === 'Empty bin') {
    expect(pending.size).toBe(0)
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm permanent deletion' }))
  }
  await waitFor(() => expect(pending.size).toBe(102))
  await screen.findByText('There’s nothing in the recycle bin.')
  expect(waitForOperation).toHaveBeenCalled()
})

test('a rejected restore keeps the row and shows the error', async () => {
  const user = userEvent.setup()
  setup(1, true)
  await user.click(await screen.findByRole('button', { name: 'Restore' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Library unavailable')
  expect(screen.getByText('photo-0.jpg')).toBeVisible()
})
