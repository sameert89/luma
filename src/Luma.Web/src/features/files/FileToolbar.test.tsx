import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import { FileToolbar } from './FileToolbar'
import { request } from '../browse/api'
vi.mock('../browse/api', () => ({
  request: vi.fn(async (path: string) =>
    path.includes('capabilities')
      ? { accessConfigured: true, libraries: [{ libraryId: 1, writable: true }] }
      : { libraryId: 1, relativePath: 'photos' },
  ),
  errorMessage: () => 'Failed',
}))
vi.mock('../uploads/UploadPicker', () => ({ UploadPicker: () => null }))
test('deletion defaults to recycling and reviewing does not send a mutation', async () => {
  const user = userEvent.setup()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <FileToolbar libraryId={1} folderId={2} selected={new Set([3, 4])} />
    </QueryClientProvider>,
  )
  await user.click(await screen.findByRole('button', { name: 'Manage files' }))
  await user.selectOptions(screen.getByLabelText('Operation'), 'delete')
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  await user.click(await screen.findByRole('button', { name: 'Review deletion' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Delete 2 selected items?')
  expect(vi.mocked(request).mock.calls.every(call => call[2] !== 'POST')).toBe(true)
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByText('Delete 2 selected items?')).not.toBeInTheDocument()
})

test('read-only capabilities disable file actions and a successful recheck restores them', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(['file-capabilities'], { accessConfigured: true, libraries: [{ libraryId: 1, writable: false }] })
  render(
    <QueryClientProvider client={client}>
      <FileToolbar libraryId={1} folderId={2} />
    </QueryClientProvider>,
  )
  expect(screen.getByRole('button', { name: 'Manage files' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Recycle bin' })).toBeDisabled()
  expect(screen.getByText(/File changes disabled/)).toBeInTheDocument()
  await client.invalidateQueries({ queryKey: ['file-capabilities'] })
  expect(await screen.findByRole('button', { name: 'Manage files' })).toBeEnabled()
})
