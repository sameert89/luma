import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { BackgroundJobsButton } from './BackgroundJobs'

it('turns while a job runs and opens a jobs-only panel', async () => {
  let tasks = [
    { id: 'scan-1', kind: 'indexing', state: 'running', createdAt: '2026', processed: 3, pending: 1, failed: 0 },
  ]
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          new Response(JSON.stringify(url === '/api/tasks' ? tasks : { libraries: [], cachePressure: false })),
        ),
      ),
  )
  const { unmount } = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <BackgroundJobsButton libraryId={1} />
    </QueryClientProvider>,
  )
  const button = await screen.findByRole('button', { name: 'Background jobs, running' })
  expect(button.querySelector('svg')).toHaveClass('motion-safe:animate-spin')
  await userEvent.click(button)
  const dialog = screen.getByRole('dialog', { name: 'Background jobs' })
  expect(await screen.findByRole('article', { name: 'Indexing, Running' })).toBeVisible()
  expect(dialog).not.toHaveTextContent('Start rescan')
  unmount()
  tasks = []
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <BackgroundJobsButton />
    </QueryClientProvider>,
  )
  expect((await screen.findByRole('button', { name: 'Background jobs' })).querySelector('svg')).not.toHaveClass(
    'motion-safe:animate-spin',
  )
})

it('refreshes the gallery when a fast file operation first appears already completed', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } } })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify([]))),
  )
  render(
    <QueryClientProvider client={client}>
      <BackgroundJobsButton />
    </QueryClientProvider>,
  )
  await screen.findByRole('button', { name: 'Background jobs' })
  await waitFor(() => expect(client.getQueryData(['tasks'])).toEqual([]))
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  await act(async () => {
    client.setQueryData(
      ['tasks'],
      [
        {
          id: 'file-fast',
          kind: 'recycle',
          state: 'completed',
          createdAt: '2026',
          processed: 0,
          pending: 0,
          failed: 0,
        },
      ],
    )
  })
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['media'] }))
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['folders'] })
})
