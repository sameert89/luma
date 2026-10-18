import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { FileAccess } from './FileAccess'
import { mutationHeaders, setMutationToken } from '../../lib/api/mutationAccess'
import { request } from '../browse/api'
vi.mock('../browse/api', () => ({ request: vi.fn().mockResolvedValue(undefined), errorMessage: () => 'Unauthorized' }))
beforeEach(() => {
  localStorage.clear()
  setMutationToken('')
})
test('a failed writable mount warns while leaving the tab unlocked', async () => {
  vi.mocked(request).mockImplementation(async (path: string) =>
    path.endsWith('storage-check')
      ? [{ libraryId: 1, name: 'Photos', warning: 'Change :ro to :rw. Browsing continues.' }]
      : undefined,
  )
  render(<FileAccess />)
  await userEvent.type(screen.getByLabelText('Administrator access token'), 'administrator-secret')
  await userEvent.click(screen.getByRole('button', { name: 'Unlock file management' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Photos: Change :ro to :rw')
  expect(screen.getByRole('button', { name: 'Lock file management' })).toBeEnabled()
  expect(mutationHeaders('/api/files/access').Authorization).toBe('Bearer administrator-secret')
})
test('unlocking uses a token in memory and locking removes it', async () => {
  const user = userEvent.setup()
  render(<FileAccess />)
  await user.type(screen.getByLabelText('Administrator access token'), 'a-long-administrator-secret')
  await user.click(screen.getByRole('button', { name: 'Unlock file management' }))
  expect(mutationHeaders('/api/files/operations').Authorization).toBe('Bearer a-long-administrator-secret')
  expect(localStorage.length).toBe(0)
  expect(mutationHeaders('/api/media')).toEqual({})
  await user.click(screen.getByRole('button', { name: 'Lock file management' }))
  expect(mutationHeaders('/api/files/operations')).toEqual({})
})
