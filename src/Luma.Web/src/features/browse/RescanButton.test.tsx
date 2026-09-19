import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { RescanButton } from './RescanButton'

it('refreshes scan status immediately when opening instead of waiting for a poll', async () => {
  let preparing = false
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(url === '/api/tasks' ? preparing ? [{ id: 'scan-2', kind: 'indexing', state: 'running', processed: 100, pending: 10, failed: 0 }] : [] : url === '/api/indexing'
    ? { libraries: [{ id: 1, latestScanId: preparing ? 2 : 1 }] }
    : { id: preparing ? 2 : 1, state: 'completed', discovered: 100, ready: 90, pending: preparing ? 10 : 0, processing: 0 }), { headers: { 'Content-Type': 'application/json' } }))))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const { unmount } = render(<QueryClientProvider client={client}><RescanButton libraryId={1} name="Photos" /></QueryClientProvider>)
  const trigger = await screen.findByRole('button', { name: 'Rescan Photos' })
  expect(trigger.textContent).toBe('')
  expect(trigger.querySelector('svg')).not.toHaveClass('motion-safe:animate-spin')
  preparing = true
  await userEvent.click(trigger)
  expect(await screen.findByRole('button', { name: 'Cancel Indexing' })).toBeVisible()
  expect(trigger.querySelector('svg')).toHaveClass('motion-safe:animate-spin')
  expect(screen.queryByRole('button', { name: 'Start rescan' })).not.toBeInTheDocument()
  unmount()
  client.clear()
})
