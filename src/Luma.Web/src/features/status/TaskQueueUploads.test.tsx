import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { TaskQueue } from './TaskQueue'
const uploads = vi.hoisted(() => ({
  resumeUpload: vi.fn().mockResolvedValue(undefined),
  uploadAction: vi.fn().mockResolvedValue(undefined),
  items: [
    {
      key: 'saved',
      id: 'session',
      libraryId: 1,
      target: 'photos/original.jpg',
      size: 3,
      lastModified: 123,
      offset: 2,
      state: 'reselect',
    },
  ],
}))
vi.mock('../uploads/uploadQueue', () => ({
  ...uploads,
  uploadSelectionBlocked: () => false,
  retryFailedUploads: vi.fn(),
  subscribeUploads: () => () => {},
  uploadSnapshot: () => uploads.items,
}))

it('offers the original file picker directly on a restored upload in Background jobs', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (path: string) =>
        new Response(
          JSON.stringify(
            path === '/api/tasks'
              ? [
                  {
                    id: 'upload-session',
                    kind: 'upload',
                    state: 'waitingForClient',
                    processed: 2,
                    pending: 1,
                    failed: 0,
                    scope: 'photos/original.jpg',
                  },
                ]
              : { libraries: [] },
          ),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    ),
  )
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TaskQueue />
    </QueryClientProvider>,
  )
  expect(await screen.findByRole('button', { name: 'Choose file to resume' })).toBeVisible()
  const file = new File(['abc'], 'original.jpg', { lastModified: 123 })
  await userEvent.upload(screen.getByLabelText('Choose the original file for photos/original.jpg'), file)
  expect(uploads.resumeUpload).toHaveBeenCalledWith('saved', file)
  await userEvent.click(screen.getByRole('button', { name: 'Cancel Upload' }))
  expect(uploads.uploadAction).toHaveBeenCalledWith('saved', 'cancel')
})
