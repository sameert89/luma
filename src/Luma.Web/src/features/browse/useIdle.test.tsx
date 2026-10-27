import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useIdle } from './useIdle'
function Player({ enabled = true }: { enabled?: boolean }) {
  const hidden = useIdle(enabled)
  return (
    <div data-chrome data-hidden={hidden}>
      <button>Fullscreen</button>
    </div>
  )
}
afterEach(() => vi.useRealTimers())
it('fades after pointer activation despite persistent focus, then wakes and fades again', () => {
  vi.useFakeTimers()
  render(<Player />)
  const button = screen.getByRole('button')
  fireEvent.pointerDown(button, { pointerType: 'touch' })
  button.focus()
  fireEvent.pointerUp(button)
  act(() => vi.advanceTimersByTime(3100))
  expect(button.parentElement).toHaveAttribute('data-hidden', 'true')
  fireEvent.pointerMove(button)
  expect(button.parentElement).toHaveAttribute('data-hidden', 'false')
  act(() => vi.advanceTimersByTime(3100))
  expect(button.parentElement).toHaveAttribute('data-hidden', 'true')
})
it('keeps keyboard-focused and actively held controls visible but releases them correctly', () => {
  vi.useFakeTimers()
  render(<Player />)
  const button = screen.getByRole('button')
  fireEvent.keyDown(window, { key: 'Tab' })
  button.focus()
  act(() => vi.advanceTimersByTime(3100))
  expect(button.parentElement).toHaveAttribute('data-hidden', 'false')
  fireEvent.pointerDown(button)
  act(() => vi.advanceTimersByTime(3100))
  expect(button.parentElement).toHaveAttribute('data-hidden', 'false')
  fireEvent.pointerCancel(button)
  act(() => vi.advanceTimersByTime(3100))
  expect(button.parentElement).toHaveAttribute('data-hidden', 'true')
})
