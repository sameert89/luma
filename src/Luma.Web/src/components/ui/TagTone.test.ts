import { expect, it } from 'vitest'
import { tagTone, tagToneIndex } from './TagTone'

it('assigns stable pastel tones from normalized tag names', () => {
  expect(tagTone('Beach')).toEqual(tagTone('beach'))
  expect(tagTone('Cafe\u0301')).toEqual(tagTone('Caf\u00e9'))
  expect(tagToneIndex('Beach')).toBe(tagToneIndex('Beach'))
  expect(new Set(['Beach', 'Family', 'Holiday', 'Work'].map(tagToneIndex)).size).toBeGreaterThan(1)
  expect(tagTone('Beach')).toMatchObject({ '--tag-background': expect.stringMatching(/^#/) })
})
