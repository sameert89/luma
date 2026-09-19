import { useSyncExternalStore } from 'react'
import type { components } from '../../lib/api/generated'

// Three separate concerns:
//   cover selection      which media represent a folder (server: automatic newest, or the manual pick)
//   cover override       whether the person picked that media themselves (server: coverOverride)
//   cover rendering mode how the selection is drawn (this device's Settings choice)
// Precedence: a manual override fixes the selection; the rendering mode only decides how it is drawn.
export type CoverImage = components['schemas']['CoverImage']
export type CoverRenderingMode = 'smart' | 'cropped'
export type SingleFit = 'cover' | 'smart-cover' | 'blurred-foreground'
export type CoverLayout =
  // scale: foreground size relative to "contain" (1 = whole image visible, mismatch = object-fit: cover).
  | { kind: 'single'; image: CoverImage; fit: SingleFit; scale: number }
  | { kind: 'mosaic'; tiles: CoverImage[] }

const storageKey = 'luma-album-covers'
const listeners = new Set<() => void>()
let current: CoverRenderingMode = (() => { try { return localStorage.getItem(storageKey) === 'cropped' ? 'cropped' : 'smart' } catch { return 'smart' } })()

export function setCoverRenderingMode(mode: CoverRenderingMode) {
  current = mode
  try { localStorage.setItem(storageKey, mode) } catch { /* the choice still applies to this visit */ }
  for (const listener of listeners) listener()
}
export function useCoverRenderingMode() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => current)
}

/** How far apart two aspect ratios are, as a factor of at least 1. */
export const mismatchOf = (imageAspect: number, containerAspect: number) => Math.max(imageAspect / containerAspect, containerAspect / imageAspect)

// Crop limits keep 320 px thumbnails from being zoomed until they blur.
const smartCropScale = 1.4
const foregroundScale = 1.25

export function singleFit(mismatch: number): SingleFit {
  if (mismatch < 1.35) return 'cover'
  if (mismatch < 2.25) return 'smart-cover'
  return 'blurred-foreground'
}

// Below this card width, four or five tiles shrink to unreadable slivers on phones.
const compactCardWidth = 240
/** Tiles a mosaic can show legibly in a card of this shape and CSS width. */
export const mosaicCapacity = (containerAspect: number, containerWidth = Infinity) =>
  containerWidth < compactCardWidth ? 3 : containerAspect >= 2.4 ? 5 : containerAspect >= 1.7 ? 4 : 3
/** Aspect ratio of the large leading tile: two of three columns, or two of four. */
export const heroAspect = (containerAspect: number, count: number) => containerAspect * (count === 3 ? 2 / 3 : 1 / 2)

export function coverLayout({ images, override, mode, containerAspect, containerWidth }: {
  images: readonly CoverImage[]; override: boolean; mode: CoverRenderingMode; containerAspect: number; containerWidth?: number
}): CoverLayout | null {
  const suitable = images.filter(image => image.width > 0 && image.height > 0)
  if (suitable.length === 0) return null
  const aspect = (image: CoverImage) => image.width / image.height
  // A manual cover is one chosen image: never replaced by a mosaic of others.
  if (mode === 'smart' && !override && suitable.length >= 3) {
    const count = Math.min(mosaicCapacity(containerAspect, containerWidth), suitable.length)
    const tiles = suitable.slice(0, count)
    // Lead with the image that fits the large tile best, so it needs the least cropping.
    const hero = heroAspect(containerAspect, count)
    const lead = tiles.reduce((best, image) => mismatchOf(aspect(image), hero) < mismatchOf(aspect(best), hero) ? image : best)
    return { kind: 'mosaic', tiles: [lead, ...tiles.filter(image => image !== lead)] }
  }
  const image = suitable[0]
  const mismatch = mismatchOf(aspect(image), containerAspect)
  if (mode === 'cropped') return { kind: 'single', image, fit: 'cover', scale: mismatch }
  const fit = singleFit(mismatch)
  const scale = fit === 'cover' ? mismatch : Math.min(mismatch, fit === 'smart-cover' ? smartCropScale : foregroundScale)
  return { kind: 'single', image, fit, scale }
}

/**
 * Foreground box as percentages of the card: the "contain" size multiplied by scale, centred
 * horizontally and, when the image is taller than the card, biased upward where faces usually are.
 */
export function foregroundBox(imageAspect: number, containerAspect: number, scale: number) {
  const width = (imageAspect >= containerAspect ? 100 : imageAspect / containerAspect * 100) * scale
  const height = (imageAspect >= containerAspect ? containerAspect / imageAspect * 100 : 100) * scale
  return { width, height, left: (100 - width) / 2, top: (100 - height) * (height > 100 ? 0.4 : 0.5) }
}
