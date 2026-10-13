import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { FileAccess } from './FileAccess'
import { mutationHeaders, setMutationToken } from '../../lib/api/mutationAccess'
vi.mock('../browse/api', () => ({ request: vi.fn().mockResolvedValue(undefined), errorMessage: () => 'Unauthorized' }))
beforeEach(() => {
  localStorage.clear()
  setMutationToken('')
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
