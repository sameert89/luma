import { act, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, type ReactNode } from 'react'
import { MediaStage } from './MediaStage'
import type { Media } from './api'

function render(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return rtlRender(ui, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> })
}

const image = { id: 1, fileName: 'image.jpg', mediaType: 'image', width: 640, height: 480, preview: { url: '/cached.jpg', status: 'ready' } } as Media

describe('media viewing', () => {
  it('shows the original over its thumbnail until a preview exists and does not swap mid-visit', () => {
    const pending = { ...image, extension: '.jpg', thumbnail: { url: '/thumb.webp', status: 'ready' }, preview: { url: '/cached.jpg', status: 'pending' } } as Media
    const { rerender } = render(<MediaStage item={pending} onNavigate={vi.fn()} />)
    const photo = screen.getByRole('img', { name: 'image.jpg' })
    expect(photo).toHaveAttribute('src', '/api/media/1/original')
    expect(photo.style.backgroundImage).toContain('/thumb.webp')
    rerender(<MediaStage item={{ ...pending, preview: { ...pending.preview, status: 'ready' } }} onNavigate={vi.fn()} />)
    expect(screen.getByRole('img', { name: 'image.jpg' })).toHaveAttribute('src', '/api/media/1/original')
    // The next photo, whose preview is ready, uses the prepared preview.
    rerender(<MediaStage item={{ ...pending, id: 2, preview: { ...pending.preview, status: 'ready' } }} onNavigate={vi.fn()} />)
    expect(screen.getByRole('img', { name: 'image.jpg' })).toHaveAttribute('src', '/cached.jpg')
    // Browsers cannot show a TIFF original, so it waits for its preview.
    rerender(<MediaStage item={{ ...pending, id: 3, extension: '.tiff' }} onNavigate={vi.fn()} />)
    expect(screen.getByText('Preparing preview…')).toBeInTheDocument()
  })

  it('hides the options trigger during element and native video fullscreen and restores it on exit', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    let fullscreen: Element | null = null
    const descriptor = Object.getOwnPropertyDescriptor(document, 'fullscreenElement')
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen })
    try {
      const { container } = render(<MediaStage item={{ ...image, mediaType: 'video' }} onNavigate={vi.fn()} />)
      expect(screen.getByRole('button', { name: 'More options' })).toBeVisible()
      fullscreen = container.querySelector('video')!
      fireEvent(document, new Event('fullscreenchange'))
      expect(screen.queryByRole('button', { name: 'More options' })).not.toBeInTheDocument()
      fullscreen = null
      fireEvent(document, new Event('fullscreenchange'))
      expect(screen.getByRole('button', { name: 'More options' })).toBeVisible()
      fireEvent(container.querySelector('video')!, new Event('webkitbeginfullscreen'))
      expect(screen.queryByRole('button', { name: 'More options' })).not.toBeInTheDocument()
      fireEvent(container.querySelector('video')!, new Event('webkitendfullscreen'))
      expect(screen.getByRole('button', { name: 'More options' })).toBeVisible()
    } finally {
      if (descriptor) Object.defineProperty(document, 'fullscreenElement', descriptor)
      else Reflect.deleteProperty(document, 'fullscreenElement')
      vi.restoreAllMocks()
    }
  })

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
      const video = container.querySelector('video')!
      Object.defineProperty(video, 'duration', { configurable: true, value: 120 })
      fireEvent.durationChange(video)
      const slider = screen.getByRole('slider', { name: 'Seek video' })

      expect(seek()).toHaveAttribute('data-visible', 'false')
      expect(slider).toHaveClass('pointer-events-none')
      tap(stage, 200, 760)
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })
      expect(seek()).toHaveAttribute('data-visible', 'true')
      expect(video.currentTime).toBe(0)
      expect(slider).not.toHaveClass('pointer-events-none')
      fireEvent.change(slider, { target: { value: '30' } })
      expect(video.currentTime).toBe(30)
      expect(pause).not.toHaveBeenCalled()
      await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
      expect(seek()).toHaveAttribute('data-visible', 'false')
      fireEvent.change(slider, { target: { value: '60' } })
      expect(video.currentTime).toBe(30)
      expect(seek()).toHaveAttribute('data-visible', 'true')
      act(() => slider.focus())
      await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
      expect(seek()).toHaveAttribute('data-visible', 'true')
      act(() => slider.blur())
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
  it('skips on side double taps, plays at 2× while held and shows buffering only for real stalls', async () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockReturnValue(false)
    try {
      const { container } = render(<MediaStage item={{ ...image, mediaType: 'video' }} onNavigate={vi.fn()} />)
      const video = container.querySelector('video')!
      const stage = video.parentElement!
      vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ top: 0, left: 0, width: 900, height: 600 } as DOMRect)
      Object.defineProperty(video, 'duration', { configurable: true, value: 120 })
      video.currentTime = 50

      tap(stage, 850, 300); tap(stage, 852, 302)
      expect(video.currentTime).toBe(60)
      // Further taps inside the window keep skipping, as in streaming players.
      tap(stage, 850, 300)
      expect(video.currentTime).toBe(70)
      await act(async () => { await vi.advanceTimersByTimeAsync(400) })
      tap(stage, 40, 300); tap(stage, 42, 300)
      expect(video.currentTime).toBe(60)
      await act(async () => { await vi.advanceTimersByTimeAsync(400) })
      expect(pause).not.toHaveBeenCalled()

      // A single centre tap toggles playback once the double-tap window closes.
      tap(stage, 450, 300)
      await act(async () => { await vi.advanceTimersByTimeAsync(400) })
      expect(pause).toHaveBeenCalledTimes(1)

      const hold = { pointerId: 2, clientX: 450, clientY: 300, bubbles: true }
      act(() => { stage.dispatchEvent(new PointerEvent('pointerdown', hold)) })
      await act(async () => { await vi.advanceTimersByTimeAsync(500) })
      expect(video.playbackRate).toBe(2)
      expect(screen.getByText('2×')).toBeInTheDocument()
      act(() => { stage.dispatchEvent(new PointerEvent('pointerup', hold)) })
      expect(video.playbackRate).toBe(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(400) })
      // Releasing a hold is not a tap.
      expect(pause).toHaveBeenCalledTimes(1)

      fireEvent.waiting(video)
      await act(async () => { await vi.advanceTimersByTimeAsync(100) })
      fireEvent.playing(video)
      await act(async () => { await vi.advanceTimersByTimeAsync(400) })
      expect(screen.queryByTestId('buffering')).not.toBeInTheDocument()
      fireEvent.waiting(video)
      await act(async () => { await vi.advanceTimersByTimeAsync(400) })
      expect(screen.getByTestId('buffering')).toBeInTheDocument()
      fireEvent.playing(video)
      expect(screen.queryByTestId('buffering')).not.toBeInTheDocument()
    } finally { vi.restoreAllMocks(); vi.useRealTimers() }
  })
  it('stacks the scrubber above compact controls and throttles seeking while dragging', async () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    try {
      const { container } = render(<MediaStage item={{ ...image, mediaType: 'video' }} onNavigate={vi.fn()} />)
      const video = container.querySelector('video')!
      Object.defineProperty(video, 'duration', { configurable: true, value: 100 })
      fireEvent.durationChange(video)
      const seek = screen.getByRole('slider', { name: 'Seek' })
      expect(seek).toHaveClass('seek', 'phone-portrait:order-first', 'phone-portrait:basis-full')
      expect(screen.getByRole('slider', { name: 'Volume' })).not.toHaveClass('phone-portrait:hidden')

      const assigned: number[] = []
      Object.defineProperty(video, 'currentTime', { configurable: true, get: () => assigned.at(-1) ?? 0, set: value => { assigned.push(value) } })
      fireEvent.pointerDown(seek)
      fireEvent.change(seek, { target: { value: '10' } })
      fireEvent.change(seek, { target: { value: '20' } })
      fireEvent.change(seek, { target: { value: '30' } })
      expect(assigned).toEqual([10])
      expect(seek).toHaveAttribute('aria-valuetext', '0:30 of 1:40')
      fireEvent.pointerUp(seek)
      expect(assigned.at(-1)).toBe(30)
      await act(async () => { await vi.advanceTimersByTimeAsync(500) })
      expect(assigned).toEqual([10, 30])
      // Keyboard seeking stays immediate.
      fireEvent.change(seek, { target: { value: '45' } })
      expect(assigned.at(-1)).toBe(45)
    } finally { vi.restoreAllMocks(); vi.useRealTimers() }
  })
  it('auto-hides fullscreen controls during playback and always offers a visible exit', async () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    let fullscreen: Element | null = null
    const descriptor = Object.getOwnPropertyDescriptor(document, 'fullscreenElement')
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen })
    try {
      const { container, rerender } = render(<MediaStage item={{ ...image, mediaType: 'video' }} onNavigate={vi.fn()} />)
      const video = container.querySelector('video')!
      fullscreen = video.parentElement
      act(() => { document.dispatchEvent(new Event('fullscreenchange')) })
      const bar = screen.getByRole('button', { name: 'Exit fullscreen' }).parentElement!
      fireEvent.play(video)
      await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
      expect(bar).toHaveClass('opacity-0')
      act(() => { window.dispatchEvent(new Event('pointermove')) })
      expect(bar).not.toHaveClass('opacity-0')
      // Paused video keeps its controls up.
      fireEvent.pause(video)
      await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
      expect(bar).not.toHaveClass('opacity-0')

      // Photos (and reels) get a standalone exit control in fullscreen.
      rerender(<MediaStage item={image} onNavigate={vi.fn()} />)
      const exit = screen.getByRole('button', { name: 'Exit fullscreen' })
      await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
      expect(exit).toHaveClass('opacity-0')
      fullscreen = null
      act(() => { document.dispatchEvent(new Event('fullscreenchange')) })
      expect(screen.queryByRole('button', { name: 'Exit fullscreen' })).not.toBeInTheDocument()
    } finally {
      if (descriptor) Object.defineProperty(document, 'fullscreenElement', descriptor)
      else Reflect.deleteProperty(document, 'fullscreenElement')
      vi.restoreAllMocks(); vi.useRealTimers()
    }
  })
  it('animates GIFs from the original and loops reels when asked', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    try {
      const { unmount } = render(<MediaStage item={{ ...image, fileName: 'loop.gif', extension: '.gif' }} onNavigate={vi.fn()} />)
      expect(screen.getByRole('img')).toHaveAttribute('src', '/api/media/1/original')
      unmount()
      render(<MediaStage item={{ ...image, mediaType: 'video' }} reels loop muted onNavigate={vi.fn()} />)
      expect(screen.getByLabelText('image.jpg')).toHaveProperty('loop', true)
    } finally { vi.restoreAllMocks() }
  })
  it('likes on a centre double tap only once a third tap cannot follow, and dislikes on a triple tap', async () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    const onLike = vi.fn()
    const onDislike = vi.fn()
    try {
      const { container } = render(<MediaStage item={{ ...image, mediaType: 'video' }} reels muted onNavigate={vi.fn()} onLike={onLike} onDislike={onDislike} />)
      const stage = container.querySelector('[data-testid="reels-seek"]')!.parentElement!
      vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ top: 0, left: 0, width: 400, height: 800 } as DOMRect)

      tap(stage, 200, 400); tap(stage, 200, 400)
      // The heart shows at once, but the like waits for the triple-tap window.
      expect(container.querySelector('.lucide-heart.motion-like')).not.toBeNull()
      expect(onLike).not.toHaveBeenCalled()
      await act(async () => { await vi.advanceTimersByTimeAsync(400) })
      expect(onLike).toHaveBeenCalledTimes(1)

      tap(stage, 200, 400); tap(stage, 200, 400); tap(stage, 200, 400)
      expect(onDislike).toHaveBeenCalledTimes(1)
      expect(container.querySelector('.lucide-heart-crack.motion-like')).not.toBeNull()
      await act(async () => { await vi.advanceTimersByTimeAsync(400) })
      // The triple tap replaces the pending like instead of sending both.
      expect(onLike).toHaveBeenCalledTimes(1)
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

it('zooms photos at a double-tapped region, suppresses navigation while panning, and resets on another double tap', () => {
  const navigate = vi.fn()
  const { container } = render(<MediaStage item={image} onNavigate={navigate} />)
  const stage = container.querySelector('.touch-none') as HTMLElement
  vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 800, right: 400, bottom: 800, x: 0, y: 0, toJSON: () => ({}) })
  tap(stage, 300, 400); tap(stage, 300, 400)
  const transform = screen.getByRole('img').parentElement!
  expect(transform.style.transform).toContain('scale(2.5)')
  expect(transform.style.transform).toContain('translate(-150px, 0px)')
  fireEvent.pointerDown(stage, { pointerId: 1, clientX: 300, clientY: 400 })
  fireEvent.pointerMove(stage, { pointerId: 1, clientX: 200, clientY: 400 })
  fireEvent.pointerUp(stage, { pointerId: 1, clientX: 200, clientY: 400 })
  expect(navigate).not.toHaveBeenCalled()
  tap(stage, 200, 400); tap(stage, 200, 400)
  expect(transform.style.transform).toContain('scale(1)')
  expect(transform.style.transform).toContain('translate(0px, 0px)')
})

it('pinches from a fixed two-finger anchor and cannot navigate on either finger release', () => {
  const navigate = vi.fn()
  const { container } = render(<MediaStage item={image} onNavigate={navigate} />)
  const stage = container.querySelector('.touch-none') as HTMLElement
  stage.setPointerCapture = () => {}
  vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 800, right: 400, bottom: 800, x: 0, y: 0, toJSON: () => ({}) })
  fireEvent.pointerDown(stage, { pointerId: 1, clientX: 100, clientY: 400 })
  fireEvent.pointerDown(stage, { pointerId: 2, clientX: 200, clientY: 400 })
  fireEvent.pointerMove(stage, { pointerId: 2, clientX: 300, clientY: 400 })
  expect(screen.getByRole('img').parentElement!.style.transform).toContain('scale(2)')
  fireEvent.pointerUp(stage, { pointerId: 2, clientX: 300, clientY: 400 })
  fireEvent.pointerUp(stage, { pointerId: 1, clientX: 100, clientY: 400 })
  expect(navigate).not.toHaveBeenCalled()
})

it('uses right-side swipes for volume in the normal player without seeking or navigating', () => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  const navigate = vi.fn()
  const { container } = render(<MediaStage item={{ ...image, mediaType: 'video' }} onNavigate={navigate} />)
  const stage = container.querySelector('.touch-none') as HTMLElement
  stage.setPointerCapture = () => {}
  vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 800, right: 400, bottom: 800, x: 0, y: 0, toJSON: () => ({}) })
  const player = container.querySelector('video')!
  fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 350, clientY: 300 })
  fireEvent.pointerMove(stage, { pointerId: 1, clientX: 350, clientY: 380 })
  fireEvent.pointerUp(stage, { pointerId: 1, clientX: 350, clientY: 380 })
  expect(player.volume).toBeCloseTo(0.5)
  expect(player.currentTime).toBe(0)
  expect(screen.getByRole('status')).toHaveTextContent('Volume 50%')
  expect(navigate).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

it('offers persisted resume and start-over choices only for a partially watched normal video', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  const progress = { mediaId: 1, positionSeconds: 754, durationSeconds: 1000, watchedSeconds: 60, state: 'in_progress', updatedAt: '2026' }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(progress))))
  const { container, rerender } = render(<MediaStage item={{ ...image, mediaType: 'video', watchProgress: progress }} onNavigate={vi.fn()} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Resume from 12:34' }))
  expect(container.querySelector('video')!.currentTime).toBe(754)
  expect(screen.queryByRole('button', { name: 'Start from beginning' })).not.toBeInTheDocument()
  rerender(<MediaStage item={{ ...image, id: 2, mediaType: 'video', watchProgress: { ...progress, mediaId: 2 } }} onNavigate={vi.fn()} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Start from beginning' }))
  expect(container.querySelector('video')!.currentTime).toBe(0)
  vi.restoreAllMocks()
})

it('keeps right-side vertical swipes available for Reels navigation without changing volume', () => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  const navigate = vi.fn()
  const { container } = render(<MediaStage item={{ ...image, mediaType: 'video' }} reels muted onNavigate={navigate} />)
  const stage = container.querySelector('.touch-none') as HTMLElement
  stage.setPointerCapture = () => {}
  vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 800, right: 400, bottom: 800, x: 0, y: 0, toJSON: () => ({}) })
  fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 350, clientY: 500 })
  fireEvent.pointerMove(stage, { pointerId: 1, clientX: 350, clientY: 300 })
  fireEvent.pointerUp(stage, { pointerId: 1, clientX: 350, clientY: 300 })
  expect(container.querySelector('video')!.volume).toBe(1)
  expect(screen.queryByText(/Volume \d+%/)).not.toBeInTheDocument()
  expect(navigate).toHaveBeenCalledWith('next')
  vi.restoreAllMocks()
})
