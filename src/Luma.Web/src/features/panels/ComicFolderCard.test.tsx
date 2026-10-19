import { act, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { setCoverRenderingMode } from '../browse/coverLayout'
import { ComicFolderCard } from './ComicFolderCard'

afterEach(() => setCoverRenderingMode('smart'))
it('uses Gallery smart mosaics and responds to the shared cover preference', () => {
  const { container } = render(
    <ComicFolderCard name="Manga" covers={['/cover-a', '/cover-b', '/cover-c']} onOpen={() => {}} />,
  )
  expect(container.querySelector('[data-cover]')?.getAttribute('data-cover')).toBe('mosaic-3')
  expect(screen.getByRole('button', { name: 'Open Manga' })).toBeVisible()
  act(() => setCoverRenderingMode('cropped'))
  expect(container.querySelector('[data-cover]')?.getAttribute('data-cover')).toBe('cover')
})
