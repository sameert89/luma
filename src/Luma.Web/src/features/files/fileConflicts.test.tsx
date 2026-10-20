import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { ApiError } from '../../lib/api/client'
import { FileConflictDialog } from './FileConflictDialog'
import { chooseConflict, conflictBatch, conflictSnapshot, waitForFileSlot, withFileConflict } from './fileConflicts'

const collision = () => new ApiError(409, { code: 'destination_exists', title: 'Already exists', traceId: 'test' })
afterEach(() => { while (conflictSnapshot().length) chooseConflict('skip', false); vi.useRealTimers() })

test('Replace retries only after explicit confirmation and carries the overwrite choice', async () => {
  render(<FileConflictDialog />)
  const action = vi.fn(async (replace: boolean) => { if (!replace) throw collision(); return { id: 'queued' } })
  const result = withFileConflict(action, { batch: conflictBatch(), target: 'photos/photo.jpg' })
  expect(await screen.findByRole('dialog', { name: 'An item already exists' })).toHaveTextContent('photos/photo.jpg')
  expect(action).toHaveBeenCalledTimes(1)
  await userEvent.click(screen.getByRole('button', { name: 'Replace' }))
  expect(await result).toEqual({ id: 'queued' })
  expect(action.mock.calls.map(([replace]) => replace)).toEqual([false, true])
})

test('Skip all resolves simultaneous conflicts in one batch and does not affect the next batch', async () => {
  render(<FileConflictDialog />)
  const action = vi.fn(async () => { throw collision() })
  const batch = conflictBatch()
  const first = withFileConflict(action, { batch, target: 'one.jpg' })
  const second = withFileConflict(action, { batch, target: 'two.jpg' })
  await screen.findByRole('dialog', { name: 'An item already exists' })
  await userEvent.click(screen.getByRole('checkbox', { name: 'Apply to all remaining conflicts in this batch' }))
  await userEvent.click(screen.getByRole('button', { name: 'Skip' }))
  expect(await Promise.all([first, second])).toEqual([null, null])
  expect(await withFileConflict(action, { batch, target: 'three.jpg' })).toBeNull()
  const next = withFileConflict(action, { batch: conflictBatch(), target: 'four.jpg' })
  expect(await screen.findByRole('dialog')).toHaveTextContent('four.jpg')
  await userEvent.click(screen.getByRole('button', { name: 'Skip' }))
  expect(await next).toBeNull()
})

test('cancelling a pending conflict dismisses it without retrying the mutation', async () => {
  render(<FileConflictDialog />)
  const controller = new AbortController()
  const action = vi.fn(async () => { throw collision() })
  const result = withFileConflict(action, { batch: conflictBatch(), target: 'one.jpg', signal: controller.signal })
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
  await screen.findByRole('dialog')
  await act(async () => controller.abort())
  await rejected
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(action).toHaveBeenCalledOnce()
})

test('temporary path reservations wait automatically and remain cancellable', async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const action = vi.fn(async () => { throw new ApiError(409, { code: 'path_busy', traceId: 'test' }) })
  const result = waitForFileSlot(action, controller.signal)
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
  await vi.advanceTimersByTimeAsync(500)
  expect(action).toHaveBeenCalledTimes(2)
  controller.abort()
  await rejected
})
