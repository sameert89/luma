import { QueryClient, QueryClientProvider, useMutation, useQueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { TaskQueue } from './TaskQueue'

const task = (id: string, state: string, kind = 'import') => ({ id, kind, state, createdAt: '2026', processed: 2, pending: 0, failed: 0 })
const renderQueue = (children = <TaskQueue />) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>{children}</QueryClientProvider>)

it('shows an operation while enqueue is pending and shows its queued state immediately after acceptance', async () => {
  let finish: () => void = () => {}
  let accepted = false
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(accepted ? [task('metadata-1', 'queued')] : [])))))
  function Operation() {
    const client = useQueryClient()
    const start = useMutation({ mutationKey: ['background-task'], mutationFn: () => new Promise<void>(resolve => { finish = () => { accepted = true; resolve() } }), onSuccess: () => client.invalidateQueries({ queryKey: ['tasks'] }) })
    return <><button type="button" onClick={() => start.mutate()}>Start import</button><TaskQueue /></>
  }
  renderQueue(<Operation />)
  await userEvent.click(screen.getByRole('button', { name: 'Start import' }))
  expect(screen.getByRole('status')).toHaveTextContent('Starting operation')
  finish()
  expect(await screen.findByRole('article', { name: 'Tag import, Queued' })).toBeVisible()
  await waitFor(() => expect(screen.queryByText('Starting operation…')).not.toBeInTheDocument())
})

it('cancels active work and queues stopped work again only on request', async () => {
  let state = 'queued'
  const fetcher = vi.fn((url: string) => {
    if (url.endsWith('/cancel')) state = 'cancelled'
    if (url.endsWith('/queue')) state = 'queued'
    return Promise.resolve(new Response(JSON.stringify(url === '/api/tasks' ? [task('metadata-1', state)] : {})))
  })
  vi.stubGlobal('fetch', fetcher)
  renderQueue()
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel Tag import' }))
  expect(await screen.findByRole('article', { name: 'Tag import, Cancelled' })).toBeVisible()
  expect(fetcher.mock.calls.some(([url]) => url.endsWith('/queue'))).toBe(false)
  await userEvent.click(screen.getByRole('button', { name: 'Queue Tag import again' }))
  expect(await screen.findByRole('article', { name: 'Tag import, Queued' })).toBeVisible()
})

it('offers Clear on every finished task and Queue again only on stopped ones', async () => {
  let tasks = [task('scan-1', 'interrupted', 'indexing'), task('metadata-2', 'completed', 'xmp'), task('metadata-3', 'failed'), task('metadata-4', 'running')]
  const fetcher = vi.fn((url: string) => {
    if (url === '/api/tasks/scan-1/clear') { tasks = tasks.filter(item => item.id !== 'scan-1'); return Promise.resolve(new Response(null, { status: 204 })) }
    return Promise.resolve(new Response(JSON.stringify(tasks)))
  })
  vi.stubGlobal('fetch', fetcher)
  renderQueue()
  const interrupted = await screen.findByRole('article', { name: 'Indexing, Interrupted' })
  expect(within(interrupted).getByRole('button', { name: 'Queue Indexing again' })).toBeVisible()
  const completed = screen.getByRole('article', { name: 'XMP export, Completed' })
  expect(within(completed).queryByRole('button', { name: /again/ })).not.toBeInTheDocument()
  expect(within(completed).getByRole('button', { name: 'Clear XMP export' })).toBeVisible()
  const running = screen.getByRole('article', { name: 'Tag import, Running' })
  expect(within(running).queryByRole('button', { name: /Clear/ })).not.toBeInTheDocument()
  await userEvent.click(within(interrupted).getByRole('button', { name: 'Clear Indexing' }))
  await waitFor(() => expect(screen.queryByRole('article', { name: 'Indexing, Interrupted' })).not.toBeInTheDocument())
})

it('clears every finished entry, retains active work and disables clearing when none remain', async () => {
  let tasks = ['queued', 'running', 'completed', 'cancelled', 'failed', 'interrupted', 'expired'].map((state, index) => task(`metadata-${index + 1}`, state))
  const fetcher = vi.fn((url: string) => {
    if (url === '/api/tasks/clear-finished') { tasks = tasks.filter(item => ['queued', 'running'].includes(item.state)); return Promise.resolve(new Response(null, { status: 204 })) }
    return Promise.resolve(new Response(JSON.stringify(tasks)))
  })
  vi.stubGlobal('fetch', fetcher)
  renderQueue()
  expect(await screen.findByRole('article', { name: 'Tag import, Completed' })).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Clear finished' }))
  await waitFor(() => expect(screen.queryByRole('article', { name: 'Tag import, Completed' })).not.toBeInTheDocument())
  expect(screen.getByRole('article', { name: 'Tag import, Queued' })).toBeVisible()
  expect(screen.getByRole('article', { name: 'Tag import, Running' })).toBeVisible()
  for (const state of ['Failed', 'Cancelled', 'Interrupted', 'Expired'])
    expect(screen.queryByRole('article', { name: `Tag import, ${state}` })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Clear finished' })).toBeDisabled()
  expect(fetcher.mock.calls.filter(([url]) => url === '/api/tasks/clear-finished')).toHaveLength(1)
})
