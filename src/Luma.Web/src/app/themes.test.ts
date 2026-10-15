import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { themes } from './themes'

// Vitest runs from the web project's root; the stylesheet is read as a file rather than
// imported, because what matters is the text the browser is given.
const css = readFileSync(resolve(process.cwd(), 'src/app/styles.css'), 'utf8')
const canvasOf = (id: string) =>
  [...css.matchAll(new RegExp(`\\[data-theme='${id}'\\][^{]*\\{([^}]*)\\}`, 'g'))]
    .flatMap(block => [...block[1].matchAll(/--color-canvas:\s*([^;]+);/g)])
    .map(match => match[1].trim())

// The build writes each theme's manifest from this list while the page paints from the
// stylesheet, so a colour changed in one place and not the other would reach an installed app
// as a status bar that no longer matches the app under it.
it('gives every theme the canvas colour its stylesheet paints', () => {
  for (const theme of themes) expect(canvasOf(theme.id), `[data-theme='${theme.id}']`).toEqual([theme.canvas])
})

it('leaves no theme in the stylesheet out of the list', () => {
  const styled = new Set(
    [...css.matchAll(/\[data-theme='([a-z]+)'\][^{]*\{([^}]*)\}/g)]
      .filter(block => block[2].includes('--color-canvas:'))
      .map(block => block[1]),
  )
  expect([...styled].sort()).toEqual(themes.map(theme => theme.id).sort())
})

it('keeps the new palettes readable for text and accent controls', () => {
  const luminance = (hex: string) => {
    const rgb = [1, 3, 5]
      .map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
      .map(value => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
  }
  const contrast = (a: string, b: string) =>
    (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)
  for (const id of ['sakura', 'celestial', 'manga']) {
    const block = css.match(new RegExp(`\\[data-theme='${id}'\\]\\s*\\{([^}]+)\\}`))![1]
    const colors = Object.fromEntries(
      [...block.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]+);/g)].map(match => [match[1], match[2]]),
    )
    expect(contrast(colors.ink, colors.canvas), `${id} text`).toBeGreaterThanOrEqual(4.5)
    expect(contrast(colors.muted, colors.surface), `${id} secondary text`).toBeGreaterThanOrEqual(4.5)
    expect(contrast(colors['on-accent'], colors.accent), `${id} buttons`).toBeGreaterThanOrEqual(4.5)
  }
})
