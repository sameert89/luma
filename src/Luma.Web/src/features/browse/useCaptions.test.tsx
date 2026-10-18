import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { CaptionControls, useCaptions } from './useCaptions'

function Harness({ id = 1 }: { id?: number }) {
  const captions = useCaptions(id, true)
  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- The opt-in track is the subject of this test. */}
      <video data-testid="player">{captions.track}</video>
      <CaptionControls captions={captions} />
      {captions.message && <p role="status">{captions.message}</p>}
    </>
  )
}
function mount(
  tracks = [
    { id: 'sidecar', label: 'External SRT', language: 'und', kind: 'sidecar' },
    { id: 'embedded-2', label: 'English', language: 'eng', kind: 'embedded' },
  ],
) {
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ sourceKey: 'key', tracks, warning: null }), {
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fetch)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const view = render(<Harness />, {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })
  return { ...view, fetch }
}
it('does no caption work until CC is turned on and removes the track when off', async () => {
  const { container, fetch } = mount()
  expect(fetch).not.toHaveBeenCalled()
  expect(container.querySelector('track')).toBeNull()
  expect(screen.getByRole('button', { name: 'Captions', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await userEvent.click(screen.getByRole('button', { name: 'Captions', exact: true }))
  await waitFor(() =>
    expect(container.querySelector('track')).toHaveAttribute('src', '/api/media/1/captions/sidecar?key=key'),
  )
  expect(fetch).toHaveBeenCalledWith('/api/media/1/captions', expect.objectContaining({ method: 'POST' }))
  fireEvent.load(container.querySelector('track')!)
  await userEvent.click(screen.getByRole('button', { name: 'Captions', exact: true }))
  expect(container.querySelector('track')).toBeNull()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})
it('changes tracks only when selected and new videos start without captions', async () => {
  const { container, rerender, fetch } = mount()
  await userEvent.click(screen.getByRole('button', { name: 'Captions', exact: true }))
  await waitFor(() => expect(container.querySelector('track')).not.toBeNull())
  await userEvent.click(screen.getByRole('button', { name: 'Caption settings' }))
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Caption track' }), 'embedded-2')
  expect(container.querySelector('track')).toHaveAttribute('src', '/api/media/1/captions/embedded-2?key=key')
  await userEvent.click(screen.getByRole('button', { name: 'Close', exact: true }))
  rerender(<Harness id={2} />)
  expect(container.querySelector('track')).toBeNull()
  expect(fetch.mock.calls.some(call => call[0] === '/api/media/2/captions')).toBe(false)
})
it('reports unsupported or missing subtitles without interfering with playback', async () => {
  const { container } = mount([])
  const player = screen.getByTestId('player') as HTMLVideoElement
  player.currentTime = 17
  await userEvent.click(screen.getByRole('button', { name: 'Captions', exact: true }))
  expect(await screen.findByRole('status')).toHaveTextContent('No supported SRT captions found.')
  expect(player.currentTime).toBe(17)
  expect(container.querySelector('track')).toBeNull()
})
it('turning CC off aborts in-flight discovery', async () => {
  const { fetch, container } = mount()
  let signal: AbortSignal | undefined
  fetch.mockImplementation((_path: string, init: RequestInit) => {
    signal = init.signal ?? undefined
    return new Promise(() => {})
  })
  await userEvent.click(screen.getByRole('button', { name: 'Captions', exact: true }))
  await waitFor(() => expect(signal).toBeDefined())
  await userEvent.click(screen.getByRole('button', { name: 'Captions', exact: true }))
  expect(signal?.aborted).toBe(true)
  expect(container.querySelector('track')).toBeNull()
})
it('reports a track load failure without changing playback position', async () => {
  const { container } = mount()
  const player = screen.getByTestId('player') as HTMLVideoElement
  player.currentTime = 8
  await userEvent.click(screen.getByRole('button', { name: 'Captions', exact: true }))
  await waitFor(() => expect(container.querySelector('track')).not.toBeNull())
  fireEvent.error(container.querySelector('track')!)
  expect(screen.getByRole('status')).toHaveTextContent('Playback can continue')
  expect(player.currentTime).toBe(8)
})
it('keeps caption settings inside the fullscreen element', async () => {
  const { container } = mount()
  const descriptor = Object.getOwnPropertyDescriptor(document, 'fullscreenElement')
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: container })
  try {
    await userEvent.click(screen.getByRole('button', { name: 'Captions', exact: true }))
    await waitFor(() => expect(container.querySelector('track')).not.toBeNull())
    await userEvent.click(screen.getByRole('button', { name: 'Caption settings' }))
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
  } finally {
    if (descriptor) Object.defineProperty(document, 'fullscreenElement', descriptor)
    else Reflect.deleteProperty(document, 'fullscreenElement')
  }
})
