import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
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

for (const configuredWritable of [false, true]) {
  test(`reports checking and completion on repeated read-only checks (Writable=${configuredWritable})`, async () => {
    let finish: (value: unknown) => void = () => {}
    vi.mocked(request).mockImplementation(async path => {
      if (path.endsWith('/settings')) return { enabled: true }
      return new Promise(resolve => {
        finish = resolve
      })
    })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <FileAccess />
      </QueryClientProvider>,
    )
    const button = await screen.findByRole('button', { name: 'Check media mounts' })
    for (let check = 0; check < 2; check++) {
      await userEvent.click(button)
      expect(screen.getByRole('button', { name: 'Checking media mounts…' })).toBeDisabled()
      expect(screen.getByRole('status')).toHaveTextContent('Checking library write access…')
      await act(async () =>
        finish([
          { libraryId: 1, name: 'Photos', configuredWritable, canWrite: false, warning: 'Read-only mount.' },
          { libraryId: 2, name: 'Uploads', configuredWritable: true, canWrite: true, warning: null },
        ]),
      )
      await waitFor(() => expect(button).toBeEnabled())
      expect(screen.getByRole('status')).toHaveTextContent('Check complete. 1 of 2 libraries have write access.')
      expect(
        screen.getByText(`Photos: ${configuredWritable ? 'No write access' : 'Configured read-only'}.`),
      ).toBeVisible()
      expect(screen.getByText('Uploads: Writable.')).toBeVisible()
    }
  })
}

test('reports a failed mount check and lets the user retry', async () => {
  vi.mocked(request).mockImplementation(async path => {
    if (path.endsWith('/settings')) return { enabled: true }
    throw new Error('Check failed')
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FileAccess />
    </QueryClientProvider>,
  )
  await userEvent.click(await screen.findByRole('button', { name: 'Check media mounts' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Unavailable')
  expect(screen.getByRole('button', { name: 'Check media mounts' })).toBeEnabled()
  expect(screen.getByRole('status')).not.toHaveTextContent('Mount check complete')
})
