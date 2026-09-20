import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Collections } from './Collections'

const page = { items: [{ id: 1, name: 'Vacation' }], nextCursor: null, previousCursor: null }

function renderCollections(onChoose = vi.fn()) {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(page), { headers: { 'Content-Type': 'application/json' } })),
      ),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(
    <QueryClientProvider client={client}>
      <Collections onChoose={onChoose} />
    </QueryClientProvider>,
  )
  return onChoose
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('browses by tag on a plain click, and long-pressing opens the manage dialog instead', async () => {
  const onChoose = renderCollections()
  const chip = await screen.findByRole('button', { name: 'Vacation' })

  fireEvent.click(chip)
  expect(onChoose).toHaveBeenCalledWith({ tag: ['Vacation'] })

  onChoose.mockClear()
  fireEvent.pointerDown(chip)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600)
  })
  fireEvent.pointerUp(chip)
  fireEvent.click(chip)
  expect(onChoose).not.toHaveBeenCalled()
  expect(await screen.findByRole('dialog', { name: 'Manage "Vacation"' })).toBeVisible()
})

it('releasing before the long-press threshold still counts as a normal click', async () => {
  const onChoose = renderCollections()
  const chip = await screen.findByRole('button', { name: 'Vacation' })
  fireEvent.pointerDown(chip)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200)
  })
  fireEvent.pointerUp(chip)
  fireEvent.click(chip)
  expect(onChoose).toHaveBeenCalledWith({ tag: ['Vacation'] })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('renames a tag from the manage dialog reached by its button', async () => {
  vi.useRealTimers()
  renderCollections()
  await userEvent.click(await screen.findByRole('button', { name: 'Manage tag Vacation' }))
  const dialog = within(await screen.findByRole('dialog', { name: 'Manage "Vacation"' }))
  const fetch = vi.mocked(globalThis.fetch)
  fetch.mockImplementationOnce(() =>
    Promise.resolve(
      new Response(JSON.stringify({ id: 1, name: 'Travel' }), { headers: { 'Content-Type': 'application/json' } }),
    ),
  )
  await userEvent.clear(dialog.getByLabelText('Tag name'))
  await userEvent.type(dialog.getByLabelText('Tag name'), 'Travel')
  await userEvent.click(dialog.getByRole('button', { name: 'Save name' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/tags/1', expect.objectContaining({ method: 'PUT' })))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})
