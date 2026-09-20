import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { FilterForm } from './FilterForm'

it('lifts Apply and Reset to the bottom edge as soon as a filter changes', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('[]', { headers: { 'Content-Type': 'application/json' } }))))
  const apply = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(<QueryClientProvider client={client}><FilterForm value={{ sort: 'name' }} onApply={apply} /></QueryClientProvider>)

  // Nothing edited yet: the buttons stay at the end of the form.
  const actions = screen.getByTestId('filter-actions')
  expect(actions.className).not.toContain('sticky')

  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'size')
  expect(actions.className).toContain('sticky')

  // Back to what is already applied, in a different key order: nothing to apply again.
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'name')
  expect(actions.className).not.toContain('sticky')

  await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
  expect(apply).toHaveBeenCalledWith({ sort: 'name' })
})
