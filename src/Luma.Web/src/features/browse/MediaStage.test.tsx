import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { MediaStage } from './MediaStage'
import type { Media } from './api'

const image = { id: 1, fileName: 'image.jpg', mediaType: 'image', width: 640, height: 480, preview: { url: '/cached.jpg', status: 'ready' } } as Media

describe('media viewing', () => {
  it('pauses before opening the viewer and resumes only previously playing reels when the viewer closes', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    let paused = false
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => { paused = true })
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(() => paused)
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    const openViewer = vi.fn(() => expect(paused).toBe(true))
    const item = { ...image, mediaType: 'video' }
    try {
      const { rerender } = render(<MediaStage item={item} reels onNavigate={vi.fn()} onOpenViewer={openViewer} />)
      await userEvent.click(screen.getByRole('button', { name: 'More options' }))
      await userEvent.click(screen.getByRole('button', { name: 'Open in viewer' }))
      expect(openViewer).toHaveBeenCalledWith(item)
      expect(pause).toHaveBeenCalled()
      const playCalls = play.mock.calls.length
      rerender(<MediaStage item={item} reels suspended onNavigate={vi.fn()} />)
      expect(play).toHaveBeenCalledTimes(playCalls)
      rerender(<MediaStage item={item} reels onNavigate={vi.fn()} />)
      await waitFor(() => expect(play).toHaveBeenCalledTimes(playCalls + 1))

      // A manually paused reel must remain paused across another viewer visit.
      rerender(<MediaStage item={item} reels suspended onNavigate={vi.fn()} />)
      rerender(<MediaStage item={item} reels onNavigate={vi.fn()} />)
      expect(play).toHaveBeenCalledTimes(playCalls + 1)
    } finally { vi.restoreAllMocks() }
  })

  it('keeps options outside the slide and resets photo transforms and original access across repeated navigation', async () => {
    const { rerender } = render(<MediaStage item={image} onNavigate={vi.fn()} />)
    const options = screen.getByRole('button', { name: 'More options' })
    expect(options.closest('.motion-media')).toBeNull()
    await userEvent.keyboard('+r1')
    expect(screen.getByRole('img')).toHaveAttribute('src', '/api/media/1/original')
    for (const id of [2, 3, 4, 5]) {
      rerender(<MediaStage item={{ ...image, id, fileName: `${id}.jpg`, preview: { ...image.preview, url: `/cached-${id}.jpg` } }} onNavigate={vi.fn()} />)
      expect(screen.getByRole('button', { name: 'More options' })).toBe(options)
      const photo = screen.getByRole('img')
      expect(photo).toHaveAttribute('src', `/cached-${id}.jpg`)
      expect(photo.parentElement?.style.transform).toContain('scale(1) rotate(0deg)')
      fireEvent.load(photo)
      expect(photo).not.toHaveClass('motion-preview')
    }
  })

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
  it('pauses reels on a centre tap, likes on a double tap and reveals seeking from the bottom strip', async () => {
    vi.useFakeTimers()
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockReturnValue(false)
    const onLike = vi.fn()
    try {
      const { container } = render(<MediaStage item={{ ...image, mediaType: 'video' }} reels muted onNavigate={vi.fn()} onLike={onLike} />)
      const stage = container.querySelector('[data-testid="reels-seek"]')!.parentElement!
      vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ top: 0, left: 0, width: 400, height: 800 } as DOMRect)
      const seek = () => container.querySelector('[data-testid="reels-seek"]')!

      expect(seek()).toHaveAttribute('data-visible', 'false')
      tap(stage, 200, 760)
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })
      expect(seek()).toHaveAttribute('data-visible', 'true')
      expect(pause).not.toHaveBeenCalled()
      await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
      expect(seek()).toHaveAttribute('data-visible', 'false')

      tap(stage, 200, 400)
      await act(async () => { await vi.advanceTimersByTimeAsync(400) })
      expect(pause).toHaveBeenCalledTimes(1)

      tap(stage, 200, 400)
      tap(stage, 202, 402)
      await act(async () => { await vi.advanceTimersByTimeAsync(400) })
      expect(onLike).toHaveBeenCalledTimes(1)
      // The double tap must not also toggle playback on its way through.
      expect(pause).toHaveBeenCalledTimes(1)
      expect(play).toHaveBeenCalled()
    } finally { vi.restoreAllMocks(); vi.useRealTimers() }
  })
})

function tap(element: Element, clientX: number, clientY: number) {
  const options = { pointerId: 1, clientX, clientY, bubbles: true }
  element.setPointerCapture = () => {}
  act(() => {
    element.dispatchEvent(new PointerEvent('pointerdown', options))
    element.dispatchEvent(new PointerEvent('pointerup', options))
  })
}
