import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { expect, it, vi } from 'vitest'
import { Gallery } from './Gallery'

it('shows loading instead of an empty library until the request succeeds, including refetches', async () => {
  let finish: (value: Response) => void = () => {}
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve })))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(<QueryClientProvider client={client}><Gallery filters={{}} selected={new Set()} selecting={false} onSelect={vi.fn()} onOpen={vi.fn()} scrollerRef={createRef<HTMLDivElement>()} /></QueryClientProvider>)
  expect(screen.getByRole('status')).toHaveTextContent('Loading your collection')
  expect(screen.queryByText('No media to show')).not.toBeInTheDocument()
  await act(async () => { finish(new Response(JSON.stringify({ items: [], nextCursor: null, previousCursor: null }))) })
  expect(await screen.findByText('No media to show')).toBeVisible()
  act(() => { void client.invalidateQueries({ queryKey: ['media'] }) })
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Loading your collection'))
  expect(screen.queryByText('No media to show')).not.toBeInTheDocument()
  await act(async () => { finish(new Response(JSON.stringify({ items: [], nextCursor: null, previousCursor: null }))) })
  expect(await screen.findByText('No media to show')).toBeVisible()
})

it('waits for the root folder listing instead of announcing an empty library', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], nextCursor: null, previousCursor: null }))))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const props = { filters: { libraryId: 1 }, selected: new Set<number>(), selecting: false, onSelect: vi.fn(), onOpen: vi.fn(), scrollerRef: createRef<HTMLDivElement>() }
  const { rerender } = render(<QueryClientProvider client={client}><Gallery {...props} scopePending /></QueryClientProvider>)
  await waitFor(() => expect(client.getQueryState(['media', props.filters])?.status).toBe('success'))
  expect(screen.queryByText('No media to show')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Loading your collection')
  rerender(<QueryClientProvider client={client}><Gallery {...props} leadingContent={<p>Subfolders</p>} /></QueryClientProvider>)
  expect(screen.queryByText('No media to show')).not.toBeInTheDocument()
  expect(screen.getByText('Subfolders')).toBeVisible()
})

it('keeps accepted folder indexing in a loading state while its scan status resolves', async () => {
  let finish: (response: Response) => void = () => {}
  vi.stubGlobal('fetch', vi.fn((url: string) => url.startsWith('/api/scans/') ? new Promise<Response>(resolve => { finish = resolve }) : Promise.resolve(new Response(JSON.stringify(url.endsWith('/index') ? { id: 1 } : { items: [], nextCursor: null, previousCursor: null })))))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(<QueryClientProvider client={client}><Gallery filters={{ folderId: 2 }} selected={new Set()} selecting={false} onSelect={vi.fn()} onOpen={vi.fn()} scrollerRef={createRef<HTMLDivElement>()} /></QueryClientProvider>)
  await waitFor(() => expect(client.getQueryState(['folder-indexing', 2])?.status).toBe('success'))
  expect(screen.queryByText('No media to show')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Checking this folder')
  await act(async () => { finish(new Response(JSON.stringify({ id: 1, state: 'completed', discovered: 0, ready: 0, pending: 0, processing: 0 }))) })
  expect(await screen.findByText('No media to show')).toBeVisible()
})
