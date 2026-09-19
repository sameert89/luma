import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { GalleryActions } from './GalleryActions'

it('keeps slideshow and filter controls inside the three-dot panel and toggles filter visibility', async () => {
  const toggle = vi.fn()
  const slideshow = vi.fn()
  const props = { selecting: false, onSelect: vi.fn(), onSlideshow: slideshow, onRefresh: vi.fn(), filtersVisible: true, onToggleFilters: toggle, onFilters: vi.fn(), onClearFilters: vi.fn() }
  const { rerender } = render(<GalleryActions {...props} />)
  expect(screen.queryByRole('button', { name: 'Start slideshow' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Gallery actions' }))
  await userEvent.click(screen.getByRole('button', { name: 'Hide filters' }))
  expect(toggle).toHaveBeenCalledOnce()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  rerender(<GalleryActions {...props} filtersVisible={false} />)
  await userEvent.click(screen.getByRole('button', { name: 'Gallery actions' }))
  expect(screen.getByRole('button', { name: 'Show filters' })).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Start slideshow' }))
  expect(slideshow).toHaveBeenCalledOnce()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
