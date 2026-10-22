import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppIntroduction, AppearanceSettings, useAppearance } from './Appearance'
import { defaults } from './preferences'
const store = vi.hoisted(() => ({ loadBackground: vi.fn(), saveBackground: vi.fn(), removeBackground: vi.fn() }))
vi.mock('./backgroundStore', () => store)
beforeEach(() => {
  localStorage.removeItem('luma-appearance-v2')
  sessionStorage.clear()
  store.loadBackground.mockResolvedValue(null)
  store.removeBackground.mockResolvedValue(null)
})
afterEach(() => {
  vi.useRealTimers()
})
describe('appearance controls', () => {
  it('persists motion and background preferences separately from file-management authority', async () => {
    function Settings() {
      return <AppearanceSettings appearance={useAppearance()} />
    }
    render(<Settings />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Background' }), 'gradient')
    expect(screen.getByLabelText('Second gradient color')).toBeVisible()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Animations' }), 'off')
    await waitFor(() => expect(document.documentElement.dataset.animation).toBe('off'))
    expect(JSON.parse(localStorage.getItem('luma-appearance-v2')!).motion).toBe('off')
    expect(JSON.parse(localStorage.getItem('luma-appearance-v2')!).background).toBe('gradient')
  })
  it('keeps a failed custom image save visible without selecting a missing file', async () => {
    store.saveBackground.mockRejectedValueOnce(new Error('Storage full'))
    const hook = renderHook(useAppearance)
    await act(async () => {
      await hook.result.current.image(new File(['data'], 'background.png', { type: 'image/png' }))
    })
    expect(hook.result.current.error).toBe('Storage full')
    expect(hook.result.current.value.background).toBe('none')
    expect(hook.result.current.busy).toBe(false)
  })
})
describe('application introductions', () => {
  it('is dismissible, does not repeat in a session and has independent app identity', async () => {
    const view = render(<AppIntroduction experience="gallery" appearance={defaults} />)
    expect(screen.getByRole('status')).toHaveTextContent('Luma Gallery')
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss introduction' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    view.rerender(<AppIntroduction experience="flick" appearance={defaults} />)
    expect(screen.getByRole('status')).toHaveTextContent('Luma Flick')
    view.rerender(<AppIntroduction experience="gallery" appearance={defaults} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
  it('skips introductions when animations are disabled or the device requests reduced motion', () => {
    const view = render(<AppIntroduction experience="panels" appearance={{ ...defaults, motion: 'off' }} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    view.rerender(<AppIntroduction experience="panels" appearance={defaults} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
