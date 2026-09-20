import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CachedImage } from './CachedImage'

describe('cache readiness', () => {
  it('automatically retries an unavailable generated image and clears its timer on unmount', () => {
    vi.useFakeTimers()
    try {
      const view = render(<CachedImage url="/missing-cache" alt="Holiday" />)
      const first = screen.getByRole('img')
      fireEvent.error(first)
      expect(screen.getByText('Preview unavailable')).toBeVisible()
      act(() => vi.advanceTimersByTime(3000))
      expect(screen.getByRole('img')).not.toBe(first)
      fireEvent.error(screen.getByRole('img'))
      view.unmount()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
  it('does not request pending images and shows the image when ready', () => {
    const view = render(<CachedImage url="/pending-preview" status="pending" alt="Holiday" />)
    expect(screen.getByText('Preparing preview…')).toBeVisible()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    view.rerender(<CachedImage url="/pending-preview" status="ready" alt="Holiday" />)
    expect(screen.getByRole('img')).toHaveAttribute('src', '/pending-preview')
  })
})
