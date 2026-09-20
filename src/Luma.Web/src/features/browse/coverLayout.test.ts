import { describe, expect, it } from 'vitest'
import { coverLayout, foregroundBox, mismatchOf, singleFit, type CoverImage } from './coverLayout'

const landscape = (n: number): CoverImage => ({ url: `/l${n}`, width: 320, height: 213 })
const portrait = (n: number): CoverImage => ({ url: `/p${n}`, width: 180, height: 320 })
const wideCard = 3.2
const phoneCard = 1.5

describe('album cover layout', () => {
  it('classifies aspect mismatch with the documented thresholds', () => {
    expect(mismatchOf(1, 2)).toBe(2)
    expect(mismatchOf(2, 1)).toBe(2)
    expect(singleFit(1.34)).toBe('cover')
    expect(singleFit(1.35)).toBe('smart-cover')
    expect(singleFit(2.24)).toBe('smart-cover')
    expect(singleFit(2.25)).toBe('blurred-foreground')
  })

  it('builds a 3–5 tile mosaic for three or more automatic images, sized to the card', () => {
    const five = [1, 2, 3, 4, 5].map(landscape)
    expect(coverLayout({ images: five, override: false, mode: 'smart', containerAspect: wideCard })).toMatchObject({
      kind: 'mosaic',
      tiles: { length: 5 },
    })
    expect(coverLayout({ images: five, override: false, mode: 'smart', containerAspect: 2 })).toMatchObject({
      kind: 'mosaic',
      tiles: { length: 4 },
    })
    expect(coverLayout({ images: five, override: false, mode: 'smart', containerAspect: phoneCard })).toMatchObject({
      kind: 'mosaic',
      tiles: { length: 3 },
    })
    expect(
      coverLayout({ images: five.slice(0, 3), override: false, mode: 'smart', containerAspect: wideCard }),
    ).toMatchObject({ kind: 'mosaic', tiles: { length: 3 } })
    // A narrow phone card keeps three legible tiles even when its shape could fit more.
    expect(
      coverLayout({ images: five, override: false, mode: 'smart', containerAspect: 1.8, containerWidth: 172 }),
    ).toMatchObject({ kind: 'mosaic', tiles: { length: 3 } })
  })

  it('leads the mosaic with the image that suits the large tile best', () => {
    // A 3-tile hero on a phone card is 1:1; the square image needs the least cropping there.
    const square = { url: '/square', width: 320, height: 320 }
    const layout = coverLayout({
      images: [portrait(1), landscape(2), square],
      override: false,
      mode: 'smart',
      containerAspect: phoneCard,
    })
    expect(layout?.kind === 'mosaic' && layout.tiles.map(tile => tile.url)).toEqual(['/square', '/p1', '/l2'])
  })

  it('adapts a single image to the card: cover, mild crop, or enlarged over a blurred backdrop', () => {
    expect(coverLayout({ images: [landscape(1)], override: false, mode: 'smart', containerAspect: 1.6 })).toMatchObject(
      { fit: 'cover' },
    )
    expect(
      coverLayout({ images: [landscape(1)], override: false, mode: 'smart', containerAspect: wideCard }),
    ).toMatchObject({ fit: 'smart-cover', scale: 1.4 })
    // A portrait photo in a wide desktop banner: mismatch 5.7, never a postage stamp.
    expect(
      coverLayout({ images: [portrait(1), portrait(2)], override: false, mode: 'smart', containerAspect: wideCard }),
    ).toMatchObject({ fit: 'blurred-foreground', scale: 1.25 })
  })

  it('keeps a manual cover as the single chosen image in smart mode, still drawn adaptively', () => {
    const layout = coverLayout({ images: [portrait(9)], override: true, mode: 'smart', containerAspect: wideCard })
    expect(layout).toMatchObject({ kind: 'single', image: { url: '/p9' }, fit: 'blurred-foreground' })
  })

  it('always fills the card in cropped mode, for automatic and manual covers alike', () => {
    for (const override of [false, true])
      expect(
        coverLayout({
          images: [portrait(1), landscape(2), landscape(3)],
          override,
          mode: 'cropped',
          containerAspect: wideCard,
        }),
      ).toMatchObject({ kind: 'single', image: { url: '/p1' }, fit: 'cover' })
  })

  it('has no cover without usable images', () => {
    expect(coverLayout({ images: [], override: false, mode: 'smart', containerAspect: wideCard })).toBeNull()
    expect(
      coverLayout({
        images: [{ url: '/x', width: 0, height: 0 }],
        override: false,
        mode: 'cropped',
        containerAspect: wideCard,
      }),
    ).toBeNull()
  })

  it('positions the foreground without stretching: its box keeps the image aspect ratio', () => {
    const imageAspect = 180 / 320
    const box = foregroundBox(imageAspect, wideCard, 1.25)
    expect((box.width / box.height) * wideCard).toBeCloseTo(imageAspect)
    expect(box.height).toBeCloseTo(125)
    expect(box.left).toBeCloseTo((100 - box.width) / 2)
    // Taller than the card: the crop favours the upper part, where faces usually are.
    expect(box.top).toBeCloseTo(-10)
    // Scale equal to the mismatch reproduces object-fit: cover exactly.
    const cover = foregroundBox(2, 1, 2)
    expect([cover.width, cover.height, cover.top]).toEqual([200, 100, 0])
  })
})
