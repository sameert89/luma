import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ComicReader } from './ComicReader'
import { useReadingSession } from './useReadingSession'
import type { Comic } from './api'
vi.mock('./useReadingSession', () => ({ useReadingSession: vi.fn(() => '') }))
const comic: Comic = {
  id: 1,
  libraryId: 1,
  title: 'Book',
  series: '',
  author: '',
  description: '',
  format: 'zip',
  pageCount: 5000,
  pageIndex: 21,
  state: 'reading',
  readingSeconds: 20,
  direction: 'rtl',
  settings: '{"mode":"single","fit":"width"}',
  lastReadAt: null,
  favourite: false,
  coverUrl: null,
  coverPage: 0,
}
describe('comic reader', () => {
  it('resumes saved preferences, keeps page rendering bounded and uses RTL keyboard navigation', () => {
    const exit = vi.fn()
    render(<ComicReader comic={comic} onExit={exit} />)
    expect(screen.getByRole('combobox', { name: 'Page fit' })).toHaveValue('width')
    expect(screen.getByRole('spinbutton', { name: 'Go to page' })).toHaveValue(22)
    expect(screen.getAllByRole('img')).toHaveLength(1)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByRole('spinbutton', { name: 'Go to page' })).toHaveValue(23)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByRole('spinbutton', { name: 'Go to page' })).toHaveValue(22)
    expect(useReadingSession).toHaveBeenLastCalledWith(1, 21, 'rtl', { mode: 'single', fit: 'width' })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(exit).toHaveBeenCalledOnce()
  })
  it('clamps page selection and reports a page failure while preserving the exit', () => {
    render(<ComicReader comic={{ ...comic, settings: 'invalid' }} onExit={() => {}} />)
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Go to page' }), { target: { value: '9000' } })
    expect(screen.getByRole('spinbutton', { name: 'Go to page' })).toHaveValue(5000)
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
    fireEvent.error(screen.getByRole('img'))
    expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded')
    expect(screen.getByRole('button', { name: 'Exit reader' })).toBeVisible()
  })
})
