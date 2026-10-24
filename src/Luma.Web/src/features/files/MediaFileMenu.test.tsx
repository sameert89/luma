import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import { MediaFileMenu } from './MediaFileMenu'
import { clipboardSnapshot, setClipboard } from './clipboard'
import type { Media } from '../browse/api'

const item: Media = {
  id: 7,
  libraryId: 1,
  folderId: 2,
  fileName: 'photo.jpg',
  mediaType: 'image',
  extension: '.jpg',
  sizeBytes: 1024,
  width: 128,
  height: 96,
  durationMs: null,
  modifiedAt: '2026-10-24',
  effectiveDate: '2026-10-24',
  capturedAt: null,
  preference: 'neutral',
  availability: 'present',
  thumbnail: { status: 'ready', url: '/thumb/7', width: 128, height: 96 },
  preview: { status: 'ready', url: '/preview/7', width: 128, height: 96 },
  tags: [],
}
function setup() {
  setClipboard(null)
  const fetch = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes('capabilities')
            ? { accessConfigured: true, libraries: [{ libraryId: 1, writable: true }] }
            : url.includes('clipboard')
              ? [{ libraryId: 1, relativePath: 'photos/photo.jpg', mediaId: 7, folderId: null }]
              : { id: 'queued' },
        ),
      ),
  )
  vi.stubGlobal('fetch', fetch)
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MediaFileMenu item={item} />
    </QueryClientProvider>,
  )
  return fetch
}
test('file menu exposes properties and file actions without selecting the gallery', async () => {
  setup()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'File actions for photo.jpg' }))
  for (const name of ['Cut', 'Copy', 'Rename', 'Delete'])
    expect(await screen.findByRole('button', { name })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Properties' }))
  expect(screen.getByRole('dialog', { name: 'Properties' })).toHaveTextContent('photo.jpg')
  expect(screen.getByRole('dialog')).toHaveTextContent('128 × 96')
})
test.each(['Cut', 'Copy'])('%s captures a single file and closes the menu', async name => {
  const fetch = setup()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'File actions for photo.jpg' }))
  await user.click(await screen.findByRole('button', { name }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(clipboardSnapshot()).toEqual({
    kind: name === 'Cut' ? 'move' : 'copy',
    entries: [{ libraryId: 1, relativePath: 'photos/photo.jpg', mediaId: 7, folderId: null }],
  })
  expect(fetch).toHaveBeenCalledWith(
    '/api/files/clipboard',
    expect.objectContaining({ body: JSON.stringify({ mediaIds: [7], folderIds: [] }) }),
  )
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})
test('rename is available directly from the file menu', async () => {
  const fetch = setup()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'File actions for photo.jpg' }))
  await user.click(await screen.findByRole('button', { name: 'Rename' }))
  const dialog = await screen.findByRole('dialog', { name: 'Rename' })
  const input = await within(dialog).findByRole('textbox', { name: 'Name' })
  await waitFor(() => expect(input).toHaveValue('photo.jpg'))
  await user.clear(input)
  await user.type(input, 'Holiday.jpg')
  await user.click(within(dialog).getByRole('button', { name: 'Rename' }))
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/files/items',
      expect.objectContaining({
        body: JSON.stringify({ libraryId: 1, mediaId: 7, kind: 'move', destination: 'photos/Holiday.jpg' }),
      }),
    ),
  )
})
