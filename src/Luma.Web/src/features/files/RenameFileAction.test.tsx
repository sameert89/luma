import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { RenameFileAction } from './RenameFileAction'

function setup(folder = false, writable = true) {
  const fetch = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes('capabilities')
            ? { accessConfigured: true, libraries: [{ libraryId: 2, writable }] }
            : url.includes('clipboard')
              ? [
                  {
                    libraryId: 2,
                    relativePath: folder ? 'parent/album' : 'parent/photo.jpg',
                    mediaId: folder ? null : 7,
                    folderId: folder ? 9 : null,
                  },
                ]
              : { id: 'queued' },
        ),
      ),
  )
  vi.stubGlobal('fetch', fetch)
  const queued = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RenameFileAction mediaIds={folder ? [] : [7]} folderIds={folder ? [9] : []} libraryId={2} onQueued={queued} />
    </QueryClientProvider>,
  )
  return { fetch, queued }
}
test.each([false, true])(
  'rename queues a same-folder move for a file/folder (%s) without operation polling',
  async folder => {
    const { fetch, queued } = setup(folder)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Rename' }))
    const name = await screen.findByRole('textbox', { name: 'Name' })
    await waitFor(() => expect(name).toHaveValue(folder ? 'album' : 'photo.jpg'))
    await user.clear(name)
    await user.type(name, folder ? 'Holiday' : 'Holiday.jpg')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Rename' }))
    await waitFor(() => expect(queued).toHaveBeenCalledOnce())
    expect(fetch).toHaveBeenCalledWith(
      '/api/files/items',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          libraryId: 2,
          ...(folder ? { folderId: 9 } : { mediaId: 7 }),
          kind: 'move',
          destination: folder ? 'parent/Holiday' : 'parent/Holiday.jpg',
        }),
      }),
    )
    expect(fetch.mock.calls.some(call => call[0].includes('/operations/'))).toBe(false)
  },
)
test('rename rejects paths and keeps the dialog open on a queue error', async () => {
  const { fetch } = setup()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Rename' }))
  const name = screen.getByRole('textbox', { name: 'Name' })
  await waitFor(() => expect(name).toHaveValue('photo.jpg'))
  await user.clear(name)
  await user.type(name, '../other.jpg')
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Rename' }))
  expect(screen.getByRole('alert')).toHaveTextContent('not a path')
  expect(fetch.mock.calls.some(call => call[0] === '/api/files/items')).toBe(false)
  fetch.mockImplementation(async url =>
    url === '/api/files/items' ? new Response(null, { status: 409 }) : new Response('{}'),
  )
  await user.clear(name)
  await user.type(name, 'existing.jpg')
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Rename' }))
  await waitFor(() => expect(screen.getByRole('alert')).not.toHaveTextContent('not a path'))
  expect(screen.getByRole('dialog', { name: 'Rename' })).toBeVisible()
})
test('rename is disabled for its read-only library', async () => {
  setup(false, false)
  expect(await screen.findByRole('button', { name: 'Rename' })).toBeDisabled()
})
