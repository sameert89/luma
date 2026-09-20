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
