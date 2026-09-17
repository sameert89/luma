import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { MediaStage } from './MediaStage'
import type { Media } from './api'

const image = { id: 1, fileName: 'image.jpg', mediaType: 'image', width: 640, height: 480, preview: { url: '/cached.jpg', status: 'ready' } } as Media

describe('media viewing', () => {
  it('uses cached images until explicit original access and supports keyboard zoom and rotation', async () => {
    render(<MediaStage item={image} onNavigate={vi.fn()} />)
    expect(screen.getByRole('img')).toHaveAttribute('src', '/cached.jpg')
    await userEvent.keyboard('+')
    await userEvent.click(screen.getByRole('button', { name: 'More options' }))
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toHaveTextContent('125%')
    await userEvent.click(screen.getByRole('button', { name: 'Rotate' }))
    expect(document.querySelector('img')?.parentElement?.style.transform).toContain('rotate(90deg)')
    await userEvent.click(screen.getByRole('button', { name: 'Actual size' }))
    expect(document.querySelector('img')).toHaveAttribute('src', '/api/media/1/original')
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute('href', '/api/media/1/original?download=true')
    expect(screen.queryByRole('link', { name: 'Open original' })).not.toBeInTheDocument()
  })
  it('keeps fit or fill after changing items', async () => {
    localStorage.clear()
    const { unmount } = render(<MediaStage item={image} onNavigate={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'More options' }))
    await userEvent.click(screen.getByRole('button', { name: 'Fill' }))
    unmount()
    render(<MediaStage item={{ ...image, id: 2, fileName: 'next.jpg' }} onNavigate={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'More options' }))
    expect(screen.getByRole('button', { name: 'Fit' })).toBeVisible()
  })
  it('defaults normal media to fit but reels to fill and allows toggling reels back to fit', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    localStorage.clear()
    try {
      const { unmount } = render(<MediaStage item={image} onNavigate={vi.fn()} />)
      expect(screen.getByRole('img')).toHaveClass('object-contain')
      unmount()
      const reels = render(<MediaStage item={{ ...image, mediaType: 'video' }} reels muted onNavigate={vi.fn()} />)
      const video = screen.getByLabelText('image.jpg')
      expect(video).toHaveClass('object-cover')
      await userEvent.click(screen.getByRole('button', { name: 'More options' }))
      await userEvent.click(screen.getByRole('button', { name: 'Fit' }))
      expect(video).toHaveClass('object-contain')
      reels.unmount()
    } finally { vi.restoreAllMocks() }
  })
  it('retains playback after StrictMode setup, handles blocked autoplay, and releases inactive playback', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('blocked'))
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    try {
      const { container, unmount } = render(<StrictMode><MediaStage item={{ ...image, mediaType: 'video' }} reels muted onNavigate={vi.fn()} /></StrictMode>)
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Autoplay was blocked'))
      const video = container.querySelector('video')!
      expect(video).toHaveAttribute('src', '/api/media/1/original')
      expect(video.controls).toBe(false)
      expect(video.muted).toBe(true)
      expect(screen.queryByRole('button', { name: 'Playback speed' })).not.toBeInTheDocument()
      expect(screen.getByRole('slider', { name: 'Seek video' })).toBeVisible()
      expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument()
      fireEvent.error(video)
      expect(screen.getByRole('status')).toHaveTextContent('external player')
      await userEvent.click(screen.getByRole('button', { name: 'More options' }))
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Playback speed' }), '2')
      expect(video.playbackRate).toBe(2)
      unmount()
      expect(pause).toHaveBeenCalled()
      expect(load).toHaveBeenCalled()
      expect(video).not.toHaveAttribute('src')
      expect(play).toHaveBeenCalled()
    } finally { vi.restoreAllMocks() }
  })
})
