import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Modal } from './Modal'

describe('modal history integration', () => {
  it('opens without secure-context crypto APIs', async () => {
    const originalCrypto = globalThis.crypto
    vi.stubGlobal('crypto', {})
    history.replaceState({}, '', location.href)
    const onOpenChange = vi.fn()

    try {
      render(<Modal open onOpenChange={onOpenChange} title="Filters" description="Filter media."><button type="button">Ready</button></Modal>)

      expect(screen.getByRole('dialog', { name: 'Filters' })).toBeVisible()
      expect(history.state?.lumaModal).toMatch(/^luma-modal-/)
      await userEvent.keyboard('{Escape}')
      expect(onOpenChange).toHaveBeenCalledWith(false)
    } finally {
      vi.stubGlobal('crypto', originalCrypto)
    }
  })
})

it('releases overlays and body interaction locks immediately through repeated and nested close cycles', async () => {
  const change = vi.fn()
  const ui = (outer: boolean, inner: boolean) => <><Modal open={outer} onOpenChange={change} title="Viewer" description="Media"><button type="button">Play</button></Modal><Modal open={inner} onOpenChange={change} title="Options" description="Controls"><button type="button">Fit</button></Modal></>
  const { rerender } = render(ui(false, false))
  for (let cycle = 0; cycle < 5; cycle++) {
    rerender(ui(true, false))
    await screen.findByRole('dialog', { name: 'Viewer' })
    rerender(ui(true, true))
    expect(await screen.findByRole('dialog', { name: 'Options' })).toBeVisible()
    rerender(ui(true, false))
    expect(screen.queryByRole('dialog', { name: 'Options' })).not.toBeInTheDocument()
    rerender(ui(false, false))
    expect(document.querySelector('[data-motion]')).toBeNull()
    expect(document.querySelector('.motion-overlay')).toBeNull()
    await waitFor(() => expect(document.body.style.pointerEvents).not.toBe('none'))
    expect(document.body.hasAttribute('data-scroll-locked')).toBe(false)
  }
})

it('keeps a modal opened while a closing modal is still leaving its history entry', async () => {
  history.replaceState({}, '', location.href)
  const menuChange = vi.fn()
  const viewerChange = vi.fn()
  const ui = (menu: boolean, viewer: boolean) => <><Modal open={menu} onOpenChange={menuChange} title="Folder actions" description="Menu"><button type="button">Start slideshow</button></Modal><Modal open={viewer} onOpenChange={viewerChange} title="Viewer" description="Media"><button type="button">Play</button></Modal></>
  // Browsers finish a history traversal a little later, as a separate task.
  const back = history.back.bind(history)
  const delayed = vi.spyOn(history, 'back').mockImplementation(() => { setTimeout(back, 20) })
  const { rerender } = render(ui(true, false))
  await waitFor(() => expect(history.state?.lumaModal).toMatch(/^luma-modal-/))
  rerender(ui(false, false))
  // The menu's entry is being left (history.back is pending) when the viewer opens.
  await new Promise(resolve => setTimeout(resolve, 0))
  rerender(ui(false, true))
  await waitFor(() => expect(history.state?.lumaModal).toMatch(/^luma-modal-/))
  await new Promise(resolve => setTimeout(resolve, 50))
  expect(viewerChange).not.toHaveBeenCalledWith(false)
  expect(screen.getByRole('dialog', { name: 'Viewer' })).toBeVisible()
  delayed.mockRestore()
})

it('dismissing a sheet by tapping outside it does not press what is behind it', async () => {
  const change = vi.fn()
  const behind = vi.fn()
  render(<><button type="button" onClick={behind}>Open folder</button><Modal open onOpenChange={change} title="Folder actions" description="Actions"><button type="button">Rescan</button></Modal></>)

  fireEvent.pointerDown(screen.getByRole('dialog', { name: 'Folder actions' }))
  expect(change).toHaveBeenCalledWith(false)

  // The click that completes that tap lands on the control underneath and must be ignored.
  // The dialog is open, so everything behind it is hidden from the accessibility tree.
  const underneath = screen.getByText('Open folder')
  fireEvent.click(underneath)
  expect(behind).not.toHaveBeenCalled()

  // Only that one click: the next is an ordinary press again.
  fireEvent.click(underneath)
  expect(behind).toHaveBeenCalledTimes(1)
})
