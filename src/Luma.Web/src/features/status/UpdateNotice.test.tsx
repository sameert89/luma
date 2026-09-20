import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { UpdateNotice, UpdateSettings, WhatsNew, appVersion, unseenRelease } from './UpdateNotice'
import { currentRelease } from '../help/changelog'

function withClient(node: React.ReactNode) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>{node}</QueryClientProvider>
}
function serverVersion(version: string) {
  // A Response body can only be read once, so every call gets its own.
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ status: 'ready', schemaVersion: 1, version }), { headers: { 'Content-Type': 'application/json' } }))))
}

it('offers the update once per server release and keeps it in settings after Not now', async () => {
  serverVersion('9.9.9')
  const { unmount } = render(withClient(<UpdateNotice />))
  expect(await screen.findByText(/Luma 9\.9\.9 is ready/)).toBeVisible()

  await userEvent.click(screen.getByRole('button', { name: 'Not now' }))
  expect(screen.queryByText(/Luma 9\.9\.9 is ready/)).not.toBeInTheDocument()

  // A reopened tab is not asked again about the same release.
  unmount()
  render(withClient(<UpdateNotice />))
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  expect(screen.queryByText(/Luma 9\.9\.9 is ready/)).not.toBeInTheDocument()

  render(withClient(<UpdateSettings onWhatsNew={vi.fn()} />))
  expect(await screen.findByRole('button', { name: /Refresh to update/ })).toBeVisible()
})

it('says the running release is current when the server reports the same one', async () => {
  serverVersion(appVersion)
  render(withClient(<UpdateSettings onWhatsNew={vi.fn()} />))
  expect(await screen.findByText(`v${appVersion}`)).toBeVisible()
  expect(screen.queryByRole('button', { name: /Refresh to update/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'What’s new' })).toBeVisible()

  render(withClient(<UpdateNotice />))
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  expect(screen.queryByText(/is ready\. Refresh to update/)).not.toBeInTheDocument()
})

it('reports a release as unseen once, and lists its changes with the version', () => {
  localStorage.removeItem('luma-version-seen')
  expect(unseenRelease()).toBe(true)
  expect(unseenRelease()).toBe(false)

  render(<WhatsNew open onOpenChange={vi.fn()} />)
  expect(screen.getByRole('heading', { name: `What’s new in Luma v${appVersion}` })).toBeVisible()
  expect(screen.getByText(currentRelease.changes[0])).toBeVisible()
  expect(currentRelease.version).toBe(appVersion)
})
