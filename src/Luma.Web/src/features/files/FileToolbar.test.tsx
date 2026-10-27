import { ApiError } from '../../lib/api/client'
import { TaskQueue } from '../status/TaskQueue'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, test, vi } from 'vitest'
import { FileManagementButton, FileToolbar } from './FileToolbar'
import { request } from '../browse/api'
import { clipboardSnapshot, setClipboard } from './clipboard'
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
  await screen.findByText('Added 2 tasks to Background jobs.')
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
  expect(request).toHaveBeenCalledWith('/api/files/items', expect.any(AbortSignal), 'POST', {
    libraryId: 1,
    kind: 'move',
    mediaId: 3,
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
  await screen.findByText('Added 1 task to Background jobs.')
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

test('a pending paste is visible and cannot be duplicated by rapid clicks, shortcuts or remounting', async () => {
  const base = vi.mocked(request).getMockImplementation()!
  let finish: (value: { id: string }) => void = () => {}
  const pending = new Promise<{ id: string }>(resolve => {
    finish = resolve
  })
  vi.mocked(request).mockImplementation((path, signal, method, body) =>
    path === '/api/files/items' ? pending : base(path, signal, method, body),
  )
  setClipboard({
    kind: 'move',
    entries: [{ libraryId: 1, relativePath: 'source/photo.jpg', mediaId: 7, folderId: null }],
  })
  const view = setup({ selected: new Set() })
  const paste = await screen.findByRole('button', { name: 'Paste (1)' })
  await waitFor(() => expect(paste).toBeEnabled())
  try {
    act(() => {
      fireEvent.click(paste)
      fireEvent.click(paste)
    })
    expect(await screen.findByRole('button', { name: 'Pasting… (1)' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Adding files to Background jobs')
    await waitFor(() =>
      expect(vi.mocked(request).mock.calls.filter(call => call[0] === '/api/files/items')).toHaveLength(1),
    )
    view.unmount()
    setup({ selected: new Set() })
    const remounted = await screen.findByRole('button', { name: 'Pasting… (1)' })
    expect(remounted).toBeDisabled()
    fireEvent.click(remounted)
    fireEvent.keyDown(document, { key: 'v', ctrlKey: true })
    expect(vi.mocked(request).mock.calls.filter(call => call[0] === '/api/files/items')).toHaveLength(1)
  } finally {
    await act(async () => {
      finish({ id: 'queued' })
      await pending
    })
  }
  await waitFor(() => expect(screen.getByRole('button', { name: 'Paste' })).toBeDisabled())
  expect(clipboardSnapshot()).toBeNull()
})

test('accepted items refresh Background jobs while a later item is still being admitted', async () => {
  const base = vi.mocked(request).getMockImplementation()!
  let finish: (value: { id: string }) => void = () => {}
  const pending = new Promise<{ id: string }>(resolve => {
    finish = resolve
  })
  let posted = 0
  vi.mocked(request).mockImplementation((path, signal, method, body) =>
    path === '/api/files/items'
      ? ++posted === 1
        ? Promise.resolve({ id: 'first' })
        : pending
      : base(path, signal, method, body),
  )
  setClipboard({
    kind: 'move',
    entries: [7, 8].map(mediaId => ({ libraryId: 1, relativePath: `source/${mediaId}.jpg`, mediaId, folderId: null })),
  })
  const view = setup({ selected: new Set() })
  const refresh = vi.spyOn(view.client, 'invalidateQueries')
  const user = userEvent.setup()
  try {
    await user.click(await screen.findByRole('button', { name: 'Paste (2)' }))
    await waitFor(() => expect(posted).toBe(2))
    expect(refresh).toHaveBeenCalledWith({ queryKey: ['tasks'] })
    expect(screen.getByRole('button', { name: 'Pasting… (2)' })).toBeDisabled()
  } finally {
    await act(async () => {
      finish({ id: 'second' })
      await pending
    })
  }
  await screen.findByText('Added 2 tasks to Background jobs.')
})

test('Background jobs shows paste admission immediately and the queued move as soon as accepted', async () => {
  const base = vi.mocked(request).getMockImplementation()!
  let finish: () => void = () => {}
  let accepted = false
  const pending = new Promise<{ id: string }>(resolve => {
    finish = () => {
      accepted = true
      resolve({ id: 'queued' })
    }
  })
  vi.mocked(request).mockImplementation((path, signal, method, body) => {
    if (path === '/api/tasks')
      return Promise.resolve(
        accepted
          ? [
              {
                id: 'file-queued',
                kind: 'move',
                state: 'queued',
                createdAt: '2026',
                processed: 0,
                failed: 0,
                pending: 1,
              },
            ]
          : [],
      )
    if (path === '/api/indexing') return Promise.resolve({ libraries: [] })
    if (path === '/api/files/items') return pending
    return base(path, signal, method, body)
  })
  setClipboard({
    kind: 'move',
    entries: [{ libraryId: 1, relativePath: 'source/photo.jpg', mediaId: 7, folderId: null }],
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  render(
    <QueryClientProvider client={client}>
      <FileToolbar libraryId={1} folderId={2} />
      <TaskQueue />
    </QueryClientProvider>,
  )
  try {
    await userEvent.click(await screen.findByRole('button', { name: 'Paste (1)' }))
    expect(await screen.findByText('Starting operation…')).toBeVisible()
  } finally {
    await act(async () => {
      finish()
      await pending
    })
  }
  expect(await screen.findByRole('article', { name: 'Move / rename, Queued' })).toBeVisible()
  await waitFor(() => expect(screen.queryByText('Starting operation…')).not.toBeInTheDocument())
})

test('a paste waiting for contention can be cancelled and leaves unaccepted files ready to retry', async () => {
  const base = vi.mocked(request).getMockImplementation()!
  vi.mocked(request).mockImplementation((path, signal, method, body) =>
    path === '/api/files/items'
      ? Promise.reject(new ApiError(409, { code: 'path_busy', title: 'Busy', traceId: 'test' }))
      : base(path, signal, method, body),
  )
  const clipboard = {
    kind: 'move' as const,
    entries: [{ libraryId: 1, relativePath: 'source/photo.jpg', mediaId: 7, folderId: null }],
  }
  setClipboard(clipboard)
  setup({ selected: new Set() })
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Paste (1)' }))
  await screen.findByText('Waiting to paste…')
  await user.click(screen.getByRole('button', { name: 'Cancel remaining' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Paste (1)' })).toBeEnabled())
  expect(clipboardSnapshot()).toEqual(clipboard)
  expect(screen.queryByText('Waiting to paste…')).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
