import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

it('renders a heading per tag group with its media below it, repeating an item under each of its tags', async () => {
  const item = (id: number, fileName: string, groupKey: string, groupLabel: string) => ({
    id, libraryId: 1, folderId: 2, fileName, mediaType: 'image', extension: '.jpg', sizeBytes: 1, width: 10, height: 10, durationMs: null,
    modifiedAt: '2026-01-01T00:00:00Z', effectiveDate: '2026-01-01T00:00:00Z', capturedAt: null, preference: 'neutral', availability: 'present',
    thumbnail: { status: 'ready', url: `/thumb/${id}` }, preview: { status: 'ready', url: `/preview/${id}` }, tags: [], groupKey, groupLabel })
  const items = [item(1, 'one.jpg', 'tag:4', 'Beach'), item(2, 'two.jpg', 'tag:4', 'Beach'), item(2, 'two.jpg', 'tag:9', 'Sunset'), item(3, 'three.jpg', 'tag:9', 'Sunset')]
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ items, nextCursor: null, previousCursor: null }))))
  // Virtualized rows need a measurable grid and scroller, which jsdom lays out as nothing.
  const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get(this: HTMLElement) { return this.dataset.testid === 'gallery-scroll' ? 600 : 0 } })
  try {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    render(<QueryClientProvider client={client}><Gallery filters={{ groupBy: 'tag' }} selected={new Set()} selecting={false} onSelect={vi.fn()} onOpen={vi.fn()} scrollerRef={createRef<HTMLDivElement>()} /></QueryClientProvider>)
    expect(await screen.findByRole('heading', { name: 'Beach' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Sunset' })).toBeVisible()
    // The same media under two tags is a cell in each group, not one cell merged away.
    expect(screen.getAllByRole('button', { name: 'Open two.jpg' })).toHaveLength(2)
    expect(screen.getAllByTestId('media-cell')).toHaveLength(4)
    expect(screen.queryByText('No media to show')).not.toBeInTheDocument()
  } finally { rect.mockRestore(); Object.defineProperty(HTMLElement.prototype, 'offsetHeight', height) }
})

it('refreshes the collection when the gallery is pulled down from the top', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ items: [], nextCursor: null, previousCursor: null })))))
  const refresh = vi.fn().mockResolvedValue(undefined)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(<QueryClientProvider client={client}><Gallery filters={{}} selected={new Set()} selecting={false} onSelect={vi.fn()} onOpen={vi.fn()} scrollerRef={createRef<HTMLDivElement>()} onPullRefresh={refresh} /></QueryClientProvider>)
  const scroller = await screen.findByTestId('gallery-scroll')

  // A short pull shows the hint and does nothing on release.
  fireEvent.touchStart(scroller, { touches: [{ clientY: 0 }] })
  fireEvent.touchMove(scroller, { touches: [{ clientY: 40 }] })
  expect(screen.getByText('Pull to refresh')).toBeVisible()
  fireEvent.touchEnd(scroller)
  expect(refresh).not.toHaveBeenCalled()

  fireEvent.touchStart(scroller, { touches: [{ clientY: 0 }] })
  fireEvent.touchMove(scroller, { touches: [{ clientY: 200 }] })
  expect(screen.getByText('Release to refresh')).toBeVisible()
  await act(async () => { fireEvent.touchEnd(scroller) })
  expect(refresh).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(screen.queryByText('Release to refresh')).not.toBeInTheDocument())
})

it('leaves scrolling alone when the gallery has no refresh action', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ items: [], nextCursor: null, previousCursor: null })))))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(<QueryClientProvider client={client}><Gallery filters={{}} selected={new Set()} selecting={false} onSelect={vi.fn()} onOpen={vi.fn()} scrollerRef={createRef<HTMLDivElement>()} /></QueryClientProvider>)
  const scroller = await screen.findByTestId('gallery-scroll')
  fireEvent.touchStart(scroller, { touches: [{ clientY: 0 }] })
  fireEvent.touchMove(scroller, { touches: [{ clientY: 200 }] })
  expect(screen.queryByText('Release to refresh')).not.toBeInTheDocument()
})
