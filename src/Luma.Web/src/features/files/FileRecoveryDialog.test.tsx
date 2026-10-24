import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FileRecoveryDialog } from './FileRecoveryDialog'
const evidence = {
  operation: {
    id: 'operation',
    libraryId: 1,
    kind: 'move',
    source: 'photo.jpg',
    destination: 'moved.jpg',
    state: 'needsAttention',
    recoveryState: 'reserved',
    failureCode: 'destination_exists',
  },
  stagingPath: '.luma-operations/operation/content',
  sourceExists: false,
  sourceMatches: false,
  stagingExists: true,
  destinationExists: true,
  destinationMatches: false,
  actions: [],
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const close = vi.fn(),
    resolved = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <FileRecoveryDialog id="operation" onClose={close} onResolved={resolved} />
    </QueryClientProvider>,
  )
  return { close, resolved }
}
describe('operation recovery review', () => {
  it('requires explicit review before retrying a collision at an alternative destination', async () => {
    const fetch = vi
      .fn()
      .mockImplementation((_path: string, init?: RequestInit) =>
        Promise.resolve(
          init?.method === 'POST'
            ? new Response(null, { status: 204 })
            : new Response(JSON.stringify(evidence), { headers: { 'Content-Type': 'application/json' } }),
        ),
      )
    vi.stubGlobal('fetch', fetch)
    const { resolved, close } = mount()
    const alternative = await screen.findByRole('textbox', { name: 'Alternative destination (optional)' })
    expect(screen.queryByRole('button', { name: 'Resume where it stopped' })).not.toBeInTheDocument()
    await userEvent.type(alternative, 'safe.jpg')
    const retry = screen.getByRole('button', { name: 'Resume where it stopped' })
    expect(retry).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(retry)
    await waitFor(() => expect(resolved).toHaveBeenCalledOnce())
    expect(close).toHaveBeenCalledOnce()
    const posted = fetch.mock.calls.find(call => call[1]?.method === 'POST')!
    expect(JSON.parse(posted[1].body)).toEqual({
      action: 'retry',
      confirmed: true,
      expectedFailureCode: 'destination_exists',
      destination: 'safe.jpg',
    })
  })
  it('shows changed evidence errors and clears confirmation after a rejected recovery', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_path: string, init?: RequestInit) =>
        Promise.resolve(
          init?.method === 'POST'
            ? new Response(JSON.stringify({ title: 'Evidence changed', code: 'recovery_changed' }), {
                status: 409,
                headers: { 'Content-Type': 'application/problem+json' },
              })
            : new Response(JSON.stringify({ ...evidence, actions: ['confirmPublished'] }), {
                headers: { 'Content-Type': 'application/json' },
              }),
        ),
      ),
    )
    mount()
    const confirm = await screen.findByRole('button', { name: 'Keep destination and finish' })
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(confirm)
    expect(await screen.findByRole('alert')).toHaveTextContent('Evidence changed')
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(confirm).toBeDisabled()
  })
})

it('keeps recovery evidence visible but disables mutations for an unavailable mount', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (path: string) =>
        new Response(
          JSON.stringify(
            path.includes('capabilities')
              ? { accessConfigured: true, libraries: [{ libraryId: 1, writable: false }] }
              : { ...evidence, actions: ['retry'] },
          ),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    ),
  )
  mount()
  const retry = await screen.findByRole('button', { name: 'Resume where it stopped' })
  await userEvent.click(screen.getByRole('checkbox'))
  expect(retry).toBeDisabled()
  expect(screen.getByText(/needs write access before recovery/)).toBeInTheDocument()
  expect(screen.getByText(evidence.stagingPath)).toBeInTheDocument()
})
