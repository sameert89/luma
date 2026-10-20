import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import { FileManagementButton, FileToolbar } from './FileToolbar'
import { request } from '../browse/api'
import { setClipboard } from './clipboard'
vi.mock('../browse/api', () => ({ request: vi.fn(), errorMessage: (error: unknown) => String(error) }))
vi.mock('../uploads/UploadPicker', () => ({ UploadPicker: () => <p>Upload drop zone</p> }))
beforeEach(() => {
  setClipboard(null)
  vi.mocked(request)
    .mockReset()
    .mockImplementation(async (path, _signal, method, body) => {
      if (path.includes('capabilities'))
        return { accessConfigured: true, libraries: [{ libraryId: 1, writable: true }] }
      if (path.includes('clipboard'))
        return (body as { mediaIds: number[] }).mediaIds.map(mediaId => ({
          libraryId: 1,
          relativePath: 'photos/one.jpg',
          mediaId,
          folderId: null,
        }))
      if (path.includes('location'))
        return { libraryId: 1, relativePath: path.endsWith('=5') ? 'destination' : 'photos' }
      if (method === 'POST') return { id: 'queued' }
      throw new Error(`Unexpected request: ${path}`)
    })
})
function setup(props: Partial<Parameters<typeof FileToolbar>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  const ui = (folderId = 2) => (
    <QueryClientProvider client={client}>
      <FileToolbar libraryId={1} folderId={folderId} selected={new Set([3, 4])} {...props} />
    </QueryClientProvider>
  )
  const view = render(ui())
  return { client, ...view, folder: (id: number) => view.rerender(ui(id)) }
}
test('deletion queues every selected file without polling and closes the dialog', async () => {
  const user = userEvent.setup()
  const onQueued = vi.fn()
  setup({ onQueued })
  await user.click(await screen.findByRole('button', { name: 'Delete' }))
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  expect(vi.mocked(request).mock.calls.some(call => call[2] === 'POST')).toBe(false)
  await user.click(screen.getByRole('button', { name: 'Move to recycle bin' }))
  await screen.findByText('2 operations queued. Follow progress in Background jobs.')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  const posts = vi.mocked(request).mock.calls.filter(call => call[0] === '/api/files/items')
  expect(posts.map(call => call[3])).toEqual([
    { libraryId: 1, mediaId: 3, kind: 'recycle' },
    { libraryId: 1, mediaId: 4, kind: 'recycle' },
  ])
  expect(vi.mocked(request).mock.calls.some(call => call[0].startsWith('/api/files/operations/'))).toBe(false)
  expect(onQueued).toHaveBeenCalledOnce()
})
test('cut survives navigation and pastes into the browsed destination without a path field', async () => {
  const user = userEvent.setup()
  const view = setup({ selected: new Set([3]) })
  await user.click(await screen.findByRole('button', { name: 'Cut' }))
  await screen.findByRole('button', { name: 'Paste (1)' })
  view.folder(5)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Paste (1)' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: 'Paste (1)' }))
  expect(request).toHaveBeenCalledWith('/api/files/operations', expect.any(AbortSignal), 'POST', {
    libraryId: 1,
    kind: 'move',
    source: 'photos/one.jpg',
    destination: 'destination/one.jpg',
  })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Paste' })).toBeDisabled())
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})
test('copy retains the clipboard after paste and upload opens a dedicated dialog', async () => {
  const user = userEvent.setup()
  const view = setup({ selected: new Set([3]) })
  await user.click(await screen.findByRole('button', { name: 'Copy' }))
  view.folder(5)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Paste (1)' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: 'Paste (1)' }))
  await screen.findByText('1 operation queued. Follow progress in Background jobs.')
  expect(screen.getByRole('button', { name: 'Paste (1)' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Upload' }))
  expect(screen.getByRole('dialog', { name: 'Upload' })).toHaveTextContent('Upload drop zone')
})
test('read-only capabilities disable the file-management toggle and hide write actions', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(['file-capabilities'], { accessConfigured: true, libraries: [{ libraryId: 1, writable: false }] })
  render(
    <QueryClientProvider client={client}>
      <FileManagementButton libraryId={1} active onToggle={vi.fn()} />
      <FileToolbar libraryId={1} folderId={2} />
    </QueryClientProvider>,
  )
  expect(screen.getByRole('button', { name: 'File management' })).toBeDisabled()
  expect(screen.queryByRole('group', { name: 'File actions' })).not.toBeInTheDocument()
})
test('new folder asks for a name only and queues creation in the current folder', async () => {
  const user = userEvent.setup()
  setup()
  await user.click(await screen.findByRole('button', { name: 'New folder' }))
  await user.type(screen.getByLabelText('Folder name'), 'Holiday')
  await user.click(screen.getByRole('button', { name: 'Create folder' }))
  expect(request).toHaveBeenCalledWith('/api/files/operations', undefined, 'POST', {
    libraryId: 1,
    kind: 'mkdir',
    source: 'photos/Holiday',
  })
})

test('search results support selected-item actions without a destination folder', async () => {
  const user = userEvent.setup()
  setup({ libraryId: undefined, folderId: undefined, selected: new Set([3]) })
  expect(await screen.findByRole('group', { name: 'File actions' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'New folder' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Rename' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  await user.click(screen.getByRole('button', { name: 'Move to recycle bin' }))
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('/api/files/items', undefined, 'POST', {
      libraryId: 1,
      mediaId: 3,
      kind: 'recycle',
    }),
  )
  expect(vi.mocked(request).mock.calls.some(call => call[0].includes('folderId=undefined'))).toBe(false)
})

test('a mixed-library selection is checked before queueing deletion', async () => {
  const user = userEvent.setup()
  const original = vi.mocked(request).getMockImplementation()!
  vi.mocked(request).mockImplementation(async (...args) =>
    args[0].includes('clipboard')
      ? [
          { libraryId: 1, relativePath: 'one.jpg', mediaId: 3 },
          { libraryId: 2, relativePath: 'two.jpg', mediaId: 4 },
        ]
      : original(...args),
  )
  setup({ libraryId: undefined, folderId: undefined })
  await user.click(await screen.findByRole('button', { name: 'Delete' }))
  await user.click(screen.getByRole('button', { name: 'Move to recycle bin' }))
  expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent('read-only')
  expect(vi.mocked(request).mock.calls.some(call => call[0] === '/api/files/items')).toBe(false)
})
