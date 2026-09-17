import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { Viewer } from './Viewer'
import type { Media } from './api'

vi.mock('./MediaStage', () => ({ MediaStage: () => <div /> }))

it('offers only the two explicit cover actions only inside media details', async () => {
  window.history.replaceState(null, '', '/')
  const media: Media = { id: 7, libraryId: 1, folderId: 3, fileName: 'photo.jpg', mediaType: 'image', extension: '.jpg', availability: 'present', preference: 'neutral',
    modifiedAt: '2026-01-01T00:00:00Z', effectiveDate: '2026-01-01T00:00:00Z', capturedAt: null, width: null, height: null, durationMs: null,
    sizeBytes: 100, tags: [], thumbnail: { status: 'ready', url: '/thumb', width: null, height: null }, preview: { status: 'ready', url: '/preview', width: null, height: null } }
  const fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') return Promise.resolve(new Response(null, { status: 204 }))
    const data = url === '/api/libraries' ? [{ id: 1, name: 'Photos', rootFolderId: 10 }]
      : url.includes('/neighbors?') ? { previous: null, next: null } : media
    return Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }))
  })
  vi.stubGlobal('fetch', fetch)
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
    <Viewer active={media} filters={{ libraryId: 1, folderId: 2, recursive: true }} onChange={vi.fn()} onClose={vi.fn()} restoreFocus={vi.fn()} />
  </QueryClientProvider>)

  expect(screen.queryByRole('button', { name: /Use as .* cover/ })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Media details' }))
  expect(screen.getByRole('dialog', { name: 'Media details' })).toBeVisible()

  const folder = screen.getByRole('button', { name: 'Use as folder cover' })
  const library = await screen.findByRole('button', { name: 'Use as library cover' })
  expect(folder).toBeVisible()
  expect(library).toBeVisible()
  expect(screen.getAllByRole('button', { name: /Use as .* cover/ })).toHaveLength(2)
  expect(screen.queryByRole('button', { name: /Automatic .* cover/ })).not.toBeInTheDocument()

  await userEvent.click(folder)
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/folders/2/cover', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ mediaId: 7 }) })))
  await waitFor(() => expect(library).toBeEnabled())
  await userEvent.click(library)
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/folders/10/cover', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ mediaId: 7 }) })))
})
