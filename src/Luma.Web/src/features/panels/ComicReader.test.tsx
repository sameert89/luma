import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ComicReader } from './ComicReader'
import { useReadingSession } from './useReadingSession'
import type { Comic } from './api'
vi.mock('./useReadingSession', () => ({
  useReadingSession: vi.fn(() => ({ error: '', flush: vi.fn().mockResolvedValue(undefined) })),
}))
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
  it('resumes saved preferences, keeps page rendering bounded and uses RTL keyboard navigation', async () => {
    const exit = vi.fn()
    render(<ComicReader comic={comic} onExit={exit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reader settings' }))
    expect(screen.getByRole('combobox', { name: 'Page fit' })).toHaveValue('width')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('button', { name: 'Go to page' })).toHaveTextContent('22 / 5000')
    expect(screen.getAllByRole('img')).toHaveLength(1)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByRole('button', { name: 'Go to page' })).toHaveTextContent('23 / 5000')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByRole('button', { name: 'Go to page' })).toHaveTextContent('22 / 5000')
    expect(useReadingSession).toHaveBeenLastCalledWith(1, 21, 'rtl', { mode: 'single', fit: 'width' })
    fireEvent.keyDown(window, { key: 'Escape' })
    await vi.waitFor(() => expect(exit).toHaveBeenCalledOnce())
  })
  it('clamps page selection and reports a page failure while preserving the exit', () => {
    render(<ComicReader comic={{ ...comic, settings: 'invalid' }} onExit={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Go to page' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Go to page' }), { target: { value: '9000' } })
    expect(screen.getByRole('spinbutton', { name: 'Go to page' })).toHaveValue(5000)
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
    fireEvent.error(screen.getByRole('img'))
    expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded')
    expect(screen.getByRole('button', { name: 'Exit reader' })).toBeVisible()
  })
})
