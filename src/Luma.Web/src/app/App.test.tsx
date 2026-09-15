import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'

function renderApp() {
  window.history.replaceState(null, '', '/')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(<QueryClientProvider client={client}><App /></QueryClientProvider>)
}
function emptyApi() {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(url.startsWith('/api/libraries') ? [] : { items: [], nextCursor: null, previousCursor: null }), { headers: { 'Content-Type': 'application/json' } }))))
}
describe('browsing shell', () => {
  it('explains how to connect an empty library', async () => {
    emptyApi(); renderApp()
    expect(await screen.findByRole('heading', { name: 'Connect your first library' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Search media' })).toBeDefined()
  })
  it('opens filters from the keyboard and restores focus after Escape', async () => {
    emptyApi(); renderApp()
    const trigger = screen.getByRole('button', { name: 'Filters' })
    trigger.focus(); await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('dialog', { name: 'Search and filters' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })
  it('keeps applied search and filter state in the URL', async () => {
    emptyApi(); renderApp()
    await userEvent.type(screen.getByRole('textbox', { name: 'Search media' }), 'Summer{Enter}')
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Preference' }), 'liked')
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    expect(window.location.search).toContain('q=Summer')
    expect(window.location.search).toContain('preference=liked')
  })
})
