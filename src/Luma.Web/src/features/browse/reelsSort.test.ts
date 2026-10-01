import { expect, it } from 'vitest'
import { reelsSortFields, sameSort } from './reelsSort'

it('keeps the library order when told to', () => {
  expect(reelsSortFields({ sort: 'library', order: 'desc' }, { sort: 'name', order: 'asc' })).toEqual({
    sort: 'name',
    order: 'asc',
    seed: undefined,
  })
})

it('replaces the library order with the chosen one', () => {
  expect(reelsSortFields({ sort: 'size', order: 'asc' }, { sort: 'name', order: 'desc' })).toEqual({
    sort: 'size',
    order: 'asc',
    seed: undefined,
  })
})

it('writes the app default as no sort at all, so it adds no filter chips', () => {
  expect(reelsSortFields({ sort: 'modified', order: 'desc' }, { sort: 'name', order: 'asc' })).toEqual({
    sort: undefined,
    order: undefined,
    seed: undefined,
  })
})

it('shuffles afresh on every visit', () => {
  const first = reelsSortFields({ sort: 'shuffle', order: 'desc' }, {})
  const second = reelsSortFields({ sort: 'shuffle', order: 'desc' }, {})
  expect(first.sort).toBe('shuffle')
  expect(first.order).toBeUndefined()
  expect(first.seed).toMatch(/^[0-9a-f]{32}$/)
  expect(sameSort(first, second)).toBe(false)
})
