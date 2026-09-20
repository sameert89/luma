import { render as rtlRender, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { AlbumCover, AlbumCoverSettings } from './AlbumCover'
import { FolderActions } from './FolderActions'
import { setCoverRenderingMode } from './coverLayout'
import type { FolderPage } from './api'

function render(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return rtlRender(ui, {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })
}
const images = [1, 2, 3, 4, 5].map(n => ({ url: `/cover-${n}`, width: 320, height: 213 }))
const cover = (container: HTMLElement) => container.querySelector('[data-cover]')!.getAttribute('data-cover')

afterEach(() => {
  setCoverRenderingMode('smart')
  vi.unstubAllGlobals()
})

it('draws automatic covers in the Settings style, switching live, while a manual cover stays one photo', async () => {
  const { container, rerender } = render(
    <>
      <AlbumCoverSettings />
      <AlbumCover images={images} height="h-24" fallback={null} />
    </>,
  )
  // Unmeasured cards assume 16:9, which fits a four-tile mosaic.
  expect(cover(container)).toBe('mosaic-4')
  await userEvent.click(screen.getByRole('radio', { name: /Cropped album covers/ }))
  expect(cover(container)).toBe('cover')
  expect(container.querySelectorAll('img')).toHaveLength(1)
  expect(localStorage.getItem('luma-album-covers')).toBe('cropped')
  await userEvent.click(screen.getByRole('radio', { name: /Smart album covers/ }))
  rerender(
    <>
      <AlbumCoverSettings />
      <AlbumCover images={[{ url: '/chosen', width: 180, height: 320 }]} override height="h-24" fallback={null} />
    </>,
  )
  expect(cover(container)).toBe('blurred-foreground')
  expect([...container.querySelectorAll('img')].every(image => image.getAttribute('src') === '/chosen')).toBe(true)
  expect(
    screen.getByText(/A cover you picked yourself for an album or folder always stays that photo/),
  ).toBeInTheDocument()
})

it('shows a placeholder when a folder has no prepared cover', () => {
  render(<AlbumCover images={[]} height="h-24" fallback={<span>Preparing album cover</span>} />)
  expect(screen.getByText('Preparing album cover')).toBeInTheDocument()
})

it('offers Reset album cover only for a manual cover and clears just that choice', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)
  const folder = {
    id: 7,
    libraryId: 1,
    parentId: 1,
    name: 'Trips',
    coverUrl: '/cover-1',
    coverOverride: false,
    coverImages: images,
  } as FolderPage['current']
  const { rerender } = render(<FolderActions folder={folder} />)
  await userEvent.click(screen.getByRole('button', { name: 'Folder actions for Trips' }))
  expect(screen.queryByRole('button', { name: 'Reset album cover' })).not.toBeInTheDocument()
  rerender(<FolderActions folder={{ ...folder, coverOverride: true }} />)
  await userEvent.click(screen.getByRole('button', { name: 'Reset album cover' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
  const [url, init] = fetch.mock.calls[0]
  expect(String(url)).toContain('/api/folders/7/cover')
  expect(init.method).toBe('PUT')
  expect(JSON.parse(String(init.body))).toEqual({ mediaId: null })
})
