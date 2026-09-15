import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(<QueryClientProvider client={client}><App /></QueryClientProvider>)
}

describe('application shell', () => {
  it('loads server status through the API', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ready', schemaVersion: 1 })))
    vi.stubGlobal('fetch', fetch)
    renderApp()
    expect(screen.getByRole('status')).toHaveTextContent('Connecting')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('connected and ready'))
    expect(fetch).toHaveBeenCalledWith('/api/status', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('A home for your memories.')
  })

  it('recovers from server errors using the keyboard', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 503, title: 'Unavailable', code: 'database_unavailable', traceId: 'test' }), { status: 503, headers: { 'Content-Type': 'application/problem+json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ready', schemaVersion: 1 }))))
    renderApp()
    const retry = await screen.findByRole('button', { name: 'Try again' })
    retry.focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('connected and ready'))
  })

  it('opens the accessible dialog and restores focus after Escape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ready', schemaVersion: 1 }))))
    renderApp()
    const trigger = screen.getByRole('button', { name: 'About Luma' })
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('dialog', { name: 'Your media, at home' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
