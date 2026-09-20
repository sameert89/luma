import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Toast, useToast } from './Toast'

function Probe() {
  const { toast, show, dismiss } = useToast()
  return (
    <>
      <button type="button" onClick={() => show('Could not refresh', 'danger')}>
        Fail
      </button>
      <Toast toast={toast} onDismiss={dismiss} />
    </>
  )
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('shows a message briefly and takes it away again', () => {
  render(<Probe />)
  fireEvent.click(screen.getByRole('button', { name: 'Fail' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Could not refresh')

  act(() => void vi.advanceTimersByTime(5000))
  expect(screen.getByRole('alert')).toBeVisible()
  act(() => void vi.advanceTimersByTime(1500))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('can be dismissed before it leaves on its own', () => {
  render(<Probe />)
  fireEvent.click(screen.getByRole('button', { name: 'Fail' }))
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()

  // The timer from the dismissed message cannot take a later one away with it.
  fireEvent.click(screen.getByRole('button', { name: 'Fail' }))
  act(() => void vi.advanceTimersByTime(5000))
  expect(screen.getByRole('alert')).toBeVisible()
})
