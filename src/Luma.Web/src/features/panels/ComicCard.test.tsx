import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ComicCard } from './ComicCard'
import type { Comic } from './api'
const comic = {
  id: 1,
  title: 'A long comic title',
  format: 'pdf',
  series: '',
  pageCount: 41,
  pageIndex: 21,
  state: 'reading',
  tags: [
    { id: 1, name: 'Action' },
    { id: 2, name: 'Hindi' },
  ],
  tagCount: 5,
} as Comic
it('has independent cover/details actions, compact tags and theme-colored rounded progress', () => {
  const open = vi.fn(),
    details = vi.fn()
  render(<ComicCard comic={comic} onOpen={open} onDetails={details} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit details for A long comic title' }))
  expect(details).toHaveBeenCalledOnce()
  expect(open).not.toHaveBeenCalled()
  expect(screen.getByText('Action')).toBeVisible()
  expect(screen.getByLabelText('3 more tags')).toHaveTextContent('+3')
  const progress = screen.getByRole('progressbar')
  expect(progress).toHaveAttribute('aria-valuenow', '22')
  expect(progress.firstElementChild).toHaveClass('bg-accent', 'rounded-full')
  fireEvent.click(screen.getByRole('button', { name: 'Read A long comic title' }))
  expect(open).toHaveBeenCalledOnce()
})
it('reserves the same tag and title space for books with no metadata', () => {
  const { container } = render(
    <>
      <ComicCard comic={comic} onOpen={vi.fn()} />
      <ComicCard comic={{ ...comic, title: 'Short', tags: [], tagCount: 0 }} onOpen={vi.fn()} />
    </>,
  )
  const cards = container.querySelectorAll('article')
  expect(cards[0].className).toBe(cards[1].className)
  expect(cards[0].querySelector('h2')?.className).toBe(cards[1].querySelector('h2')?.className)
  expect(cards[1].querySelector('.h-7')).toBeInTheDocument()
})
