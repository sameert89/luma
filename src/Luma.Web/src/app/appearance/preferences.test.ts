import { describe, expect, it } from 'vitest'
import { backgroundImage, defaults, readAppearance, sanitizeAppearance } from './preferences'

describe('appearance preferences', () => {
  it('rejects stored CSS, unknown enum values and nonfinite ranges', () => {
    localStorage.setItem(
      'luma-appearance-v2',
      JSON.stringify({
        background: 'url(https://outside.test)',
        color: 'red; background: url(x)',
        blur: 900,
        opacity: -1,
        darkness: 'bad',
        scale: 'external',
        motion: 'forced',
        splashes: 'yes',
      }),
    )
    expect(readAppearance()).toEqual({ ...defaults, blur: 24, opacity: 0 })
    expect(sanitizeAppearance({ blur: NaN, opacity: Infinity })).toEqual(defaults)
    expect(backgroundImage(readAppearance(), null)).toBeUndefined()
    localStorage.removeItem('luma-appearance-v2')
  })
  it('keeps corruption and unavailable custom files on the theme canvas', () => {
    localStorage.setItem('luma-appearance-v2', '{')
    expect(readAppearance()).toEqual(defaults)
    expect(backgroundImage({ ...defaults, background: 'custom' }, null)).toBeUndefined()
    localStorage.removeItem('luma-appearance-v2')
  })
})
