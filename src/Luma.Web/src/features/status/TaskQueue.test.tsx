import { QueryClient, QueryClientProvider, useMutation, useQueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { TaskQueue } from './TaskQueue'

it('shows an operation while enqueue is pending and shows its queued state immediately after acceptance', async () => {
  let finish: () => void = () => {}
  let accepted = false
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(accepted ? [{ id: 'metadata-1', kind: 'import', state: 'queued', createdAt: '2026', processed: 0, failed: 0, pending: 0 }] : [])))))
  function Operation() {
    const client = useQueryClient()
    const start = useMutation({ mutationKey: ['background-task'], mutationFn: () => new Promise<void>(resolve => { finish = () => { accepted = true; resolve() } }), onSuccess: () => client.invalidateQueries({ queryKey: ['tasks'] }) })
    return <><button type="button" onClick={() => start.mutate()}>Start import</button><TaskQueue /></>
  }
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><Operation /></QueryClientProvider>)
  await userEvent.click(screen.getByRole('button', { name: 'Start import' }))
  expect(screen.getByRole('status')).toHaveTextContent('Starting operation')
  finish()
  expect(await screen.findByText('import · queued')).toBeVisible()
  await waitFor(() => expect(screen.queryByText('Starting operation…')).not.toBeInTheDocument())
})

it('cancels queue items and only queues cancelled items again on request', async () => {
  let state = 'queued'
  const fetcher = vi.fn((url: string) => {
    if (url.endsWith('/cancel')) state = 'cancelled'
    if (url.endsWith('/queue')) state = 'queued'
    return Promise.resolve(new Response(JSON.stringify(url === '/api/tasks' ? [{ id: 'metadata-1', kind: 'import', state, processed: 2, pending: 0, failed: 0 }] : {})))
  })
  vi.stubGlobal('fetch', fetcher)
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><TaskQueue /></QueryClientProvider>)
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
  expect(await screen.findByText('import · cancelled')).toBeVisible()
  expect(fetcher.mock.calls.some(([url]) => url.endsWith('/queue'))).toBe(false)
  await userEvent.click(screen.getByRole('button', { name: 'Queue again' }))
  expect(await screen.findByText('import · queued')).toBeVisible()
})

it('clears finished entries, retains active work and disables clearing when none remain', async () => {
  let tasks = ['queued', 'running', 'completed', 'cancelled', 'failed', 'expired'].map((state, index) => ({ id: `metadata-${index + 1}`, kind: 'import', state, processed: 0, pending: 0, failed: 0 }))
  const fetcher = vi.fn((url: string) => {
    if (url === '/api/tasks/clear-finished') { tasks = tasks.filter(task => ['queued', 'running'].includes(task.state)); return Promise.resolve(new Response(null, { status: 204 })) }
    return Promise.resolve(new Response(JSON.stringify(tasks)))
  })
  vi.stubGlobal('fetch', fetcher)
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><TaskQueue /></QueryClientProvider>)
  expect(await screen.findByText('import · completed')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Clear finished' }))
  await waitFor(() => expect(screen.queryByText('import · completed')).not.toBeInTheDocument())
  expect(screen.getByText('import · queued')).toBeVisible()
  expect(screen.getByText('import · running')).toBeVisible()
  expect(screen.queryByText('import · failed')).not.toBeInTheDocument()
  expect(screen.queryByText('import · cancelled')).not.toBeInTheDocument()
  expect(screen.queryByText('import · expired')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Clear finished' })).toBeDisabled()
  expect(fetcher.mock.calls.filter(([url]) => url === '/api/tasks/clear-finished')).toHaveLength(1)
})
