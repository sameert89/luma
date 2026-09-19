import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { SourceVerificationSettings } from './SourceVerificationSettings'

it('keeps background missing-file checks opt in and persists the choice', async () => {
  const fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => Promise.resolve(init?.method === 'PUT'
    ? new Response(null, { status: 204 })
    : new Response(JSON.stringify({ enabled: false }), { headers: { 'Content-Type': 'application/json' } })))
  vi.stubGlobal('fetch', fetch)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><SourceVerificationSettings /></QueryClientProvider>)

  const checkbox = await screen.findByRole('checkbox', { name: 'Check indexed files for deletions' })
  expect(checkbox).not.toBeChecked()
  await userEvent.click(checkbox)

  await waitFor(() => expect(checkbox).toBeChecked())
  expect(fetch).toHaveBeenCalledWith('/api/settings/source-verification', expect.objectContaining({
    method: 'PUT', body: JSON.stringify({ enabled: true })
  }))
})
