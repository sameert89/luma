import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { FileAccess } from './FileAccess'
import { request } from '../browse/api'
vi.mock('../browse/api', () => ({ request: vi.fn(), errorMessage: () => 'Unavailable' }))
test('the file management switch saves a server preference and rechecks mounts without a token', async () => {
  let enabled = false
  vi.mocked(request).mockImplementation(async (path, _signal, method, body) => {
    if (path.endsWith('/settings')) {
      if (method === 'PUT') enabled = (body as { enabled: boolean }).enabled
      return { enabled }
    }
    return []
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FileAccess />
    </QueryClientProvider>,
  )
  const toggle = await screen.findByRole('checkbox', { name: 'Enable file management' })
  await waitFor(() => expect(toggle).toBeEnabled())
  await userEvent.click(toggle)
  await waitFor(() => expect(toggle).toBeChecked())
  expect(request).toHaveBeenCalledWith('/api/files/settings', undefined, 'PUT', { enabled: true })
  await waitFor(() => expect(request).toHaveBeenCalledWith('/api/files/storage-check', undefined, 'POST'))
  await waitFor(() => expect(toggle).toBeEnabled())
  await userEvent.click(toggle)
  await waitFor(() => expect(toggle).not.toBeChecked())
  expect(screen.queryByLabelText('Administrator access token')).toBeNull()
})
