import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ retry: vi.fn(() => 1), items: [{ state: 'failed' }] }))
vi.mock('./uploadQueue', () => ({
  retryFailedUploads: mocks.retry,
  subscribeUploads: () => () => {},
  uploadSnapshot: () => mocks.items,
}))
import { RetryFailedUploads } from './RetryFailedUploads'
it('offers one batch retry and explains when original files are needed', async () => {
  const view = render(<RetryFailedUploads />)
  await userEvent.click(screen.getByRole('button', { name: 'Retry failed uploads' }))
  expect(mocks.retry).toHaveBeenCalledOnce()
  mocks.items = [{ state: 'reselect' }]
  view.rerender(<RetryFailedUploads />)
  expect(screen.getByRole('status')).toHaveTextContent('Some uploads need their original files again')
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
