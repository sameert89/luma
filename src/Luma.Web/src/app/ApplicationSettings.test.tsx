import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { ApplicationSettings } from './ApplicationSettings'
import { request } from '../features/browse/api'
vi.mock('../features/browse/api', () => ({ request: vi.fn(), errorMessage: () => 'Unavailable' }))
test('both apps default on and can be switched without enabling file management', async () => {
  let applications = { flickEnabled: true, panelsEnabled: true }
  vi.mocked(request).mockImplementation(async (path, _signal, method, body) => {
    if (method === 'PUT') applications = body as typeof applications
    return { applications, defaults: {} }
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ApplicationSettings />
    </QueryClientProvider>,
  )
  const flick = screen.getByRole('checkbox', { name: 'Enable Flick' })
  const panels = screen.getByRole('checkbox', { name: 'Enable Panels' })
  await waitFor(() => expect(flick).toBeEnabled())
  expect(flick).toBeChecked()
  expect(panels).toBeChecked()
  await userEvent.click(flick)
  await waitFor(() => expect(flick).not.toBeChecked())
  expect(panels).toBeChecked()
  expect(request).toHaveBeenCalledWith('/api/files/applications', undefined, 'PUT', {
    flickEnabled: false,
    panelsEnabled: true,
  })
})
