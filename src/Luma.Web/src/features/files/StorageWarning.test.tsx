import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { StorageWarning } from './StorageWarning'
import { request } from '../browse/api'

vi.mock('../browse/api', () => ({ request: vi.fn() }))
beforeEach(() => {
  sessionStorage.clear()
  vi.mocked(request).mockResolvedValue({
    bootId: 'boot-1',
    accessConfigured: false,
    libraries: [{ libraryId: 1, name: 'Photos', warning: 'Read-only mount: change :ro to :rw.' }],
  })
})
function warning(onSettings = vi.fn()) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <StorageWarning onSettings={onSettings} />
    </QueryClientProvider>
  )
}
test('warns before administrator unlock and dismisses only for the current server boot', async () => {
  const onSettings = vi.fn()
  const first = render(warning(onSettings))
  expect(await screen.findByRole('alert')).toHaveTextContent('Read-only mount')
  await userEvent.click(screen.getByRole('button', { name: 'Open file management' }))
  expect(onSettings).toHaveBeenCalledOnce()
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(sessionStorage.getItem('luma-storage-warning')).toBe('boot-1')
  first.unmount()
  vi.mocked(request).mockResolvedValue({
    bootId: 'boot-2',
    libraries: [{ libraryId: 1, name: 'Photos', warning: 'Read-only mount after reboot' }],
  })
  render(warning())
  expect(await screen.findByRole('alert')).toHaveTextContent('after reboot')
})
