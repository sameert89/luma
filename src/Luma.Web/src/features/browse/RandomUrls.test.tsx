import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { RandomUrls } from './RandomUrls'

it('generates content URLs from visible filters and exposes only supported random content types', async () => {
  render(
    <RandomUrls
      filters={{
        libraryId: 1,
        folderId: 2,
        tag: ['A', 'B'],
        tagMode: 'any',
        collectionTag: 'C',
        recursive: true,
        q: 'trip',
        mediaType: 'video',
        groupBy: 'folder',
        sort: 'shuffle',
        seed: 'seed',
        cursor: 'old',
        limit: 60,
      }}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Random media URL' }))
  const field = screen.getByRole('textbox', { name: 'Generated URL' }) as HTMLInputElement
  const params = new URL(field.value).searchParams
  expect(params.get('folderId')).toBe('2')
  expect(params.getAll('tag')).toEqual(['A', 'B'])
  expect(params.get('tagMode')).toBe('any')
  expect(params.get('collectionTag')).toBe('C')
  expect(params.get('q')).toBe('trip')
  expect(params.get('mediaType')).toBe('image')
  for (const key of ['cursor', 'limit', 'groupBy', 'sort', 'seed']) expect(params.has(key)).toBe(false)
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Random media type' }), 'gif')
  expect(new URL(field.value).searchParams.get('mediaType')).toBe('gif')
  expect(screen.getByRole('link', { name: 'Open random media' })).toHaveAttribute('href', field.value)
})
