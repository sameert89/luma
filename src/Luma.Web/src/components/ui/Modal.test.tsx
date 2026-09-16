import { render, screen } from '@testing-library/react'
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
