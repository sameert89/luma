import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../browse/api', () => ({ request: mocks.request }))
vi.mock('../files/operations', () => ({ waitForOperation: vi.fn().mockResolvedValue(undefined) }))
import { UploadPicker } from './UploadPicker'
import { uploadSnapshot } from './uploadQueue'

it('protects an existing batch after closing and reopening in another folder, then unlocks the chooser', async () => {
  let finish!: (value: unknown) => void
  mocks.request.mockImplementation((path: string, _signal, _method, body) =>
    path === '/api/files/uploads'
      ? new Promise(resolve => {
          finish = resolve
        })
      : Promise.resolve({ id: body?.requestId ?? 'session', state: 'finalizing', operationId: 'op' }),
  )
  const view = render(<UploadPicker libraryId={1} destination="first" />)
  const input = screen.getByLabelText('Choose upload files')
  await userEvent.upload(input, new File([], 'photo.jpg'))
  await waitFor(() => expect(uploadSnapshot()[0].state).toBe('uploading'))
  // Retain the input's selection while its File objects are in use.
  expect((input as HTMLInputElement).files).toHaveLength(1)
  view.unmount()
  render(<UploadPicker libraryId={1} destination="second" />)
  expect(screen.getByRole('button', { name: 'Choose files' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Choose folder' })).toBeDisabled()
  expect(screen.getByText(/Finish or cancel your current uploads/)).toBeVisible()
  fireEvent.drop(screen.getByRole('region', { name: 'Upload files' }), {
    dataTransfer: { files: [new File([], 'second.jpg')], items: [] },
  })
  expect(mocks.request).toHaveBeenCalledOnce()
  await act(async () => finish({ id: 'session', committedOffset: 0, state: 'waitingForClient' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Choose files' })).toBeEnabled())
  expect(uploadSnapshot()[0].state).toBe('completed')
})
