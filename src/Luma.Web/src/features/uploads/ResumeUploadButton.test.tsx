import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { ResumeUploadButton } from './ResumeUploadButton'
import { resumeUpload } from './uploadQueue'
vi.mock('./uploadQueue', () => ({
  resumeUpload: vi.fn().mockResolvedValue(undefined),
  uploadAction: vi.fn(),
  subscribeUploads: () => () => {},
  uploadSelectionBlocked: () => false,
}))

it('opens a per-upload picker and attaches the chosen file to its original queue entry', async () => {
  const file = new File(['abc'], 'original.jpg', { lastModified: 123 })
  const item = {
    key: 'saved',
    id: 'session',
    libraryId: 1,
    target: 'photos/original.jpg',
    size: 3,
    lastModified: 123,
    offset: 2,
    state: 'reselect',
  }
  const onError = vi.fn()
  render(<ResumeUploadButton item={item} onError={onError} />)
  const input = screen.getByLabelText('Choose the original file for photos/original.jpg')
  const click = vi.spyOn(input, 'click')
  await userEvent.click(screen.getByRole('button', { name: 'Choose file to resume' }))
  expect(click).toHaveBeenCalledOnce()
  await userEvent.upload(input, file)
  await waitFor(() => expect(resumeUpload).toHaveBeenCalledWith('saved', file))
  expect(onError).toHaveBeenLastCalledWith('')
})
