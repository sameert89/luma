import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { MetadataExchange } from './MetadataExchange'

it('makes import findings beyond the first hundred item results reachable', async () => {
  const fetch = vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(url === '/api/imports/tags'
    ? { id: 1 }
    : { id: 1, kind: 'import', state: 'completed', processed: 120, failed: 1, items: url.includes('afterMediaId=100') ? [{ mediaId: 120, code: 'source_unavailable' }] : [{ mediaId: 100, code: 'imported' }], nextMediaId: url.includes('afterMediaId=100') ? null : 100 }), { headers: { 'Content-Type': 'application/json' } })))
  vi.stubGlobal('fetch', fetch)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const { unmount } = render(<QueryClientProvider client={client}><MetadataExchange mediaIds={Array.from({ length: 120 }, (_, index) => index + 1)} /></QueryClientProvider>)
  await userEvent.click(screen.getByRole('button', { name: 'Import metadata tags' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Next item results' }))
  expect(await screen.findByText('Item 120: source_unavailable')).toBeVisible()
  expect(fetch).toHaveBeenCalledWith('/api/jobs/1?afterMediaId=100', expect.anything())
  await userEvent.click(screen.getByRole('button', { name: 'First item results' }))
  expect(await screen.findByRole('button', { name: 'Next item results' })).toBeVisible()
  expect(screen.queryByText('Item 120: source_unavailable')).not.toBeInTheDocument()
  unmount()
  client.clear()
})
