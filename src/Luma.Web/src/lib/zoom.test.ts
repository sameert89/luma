import { expect, it } from 'vitest'
import { zoomPan } from './zoom'

it('keeps an off-center content point under the same finger at any starting scale and pan', () => {
  const oldPan = { x: -70, y: 30 }
  const from = { x: 120, y: -90 }
  const next = zoomPan(oldPan, 1.5, 3.7, from)
  expect((from.x - next.x) / 3.7).toBeCloseTo((from.x - oldPan.x) / 1.5)
  expect((from.y - next.y) / 3.7).toBeCloseTo((from.y - oldPan.y) / 1.5)
})

it('follows a moving pinch midpoint without changing the content point beneath it', () => {
  const from = { x: -130, y: 80 }
  const to = { x: -80, y: 120 }
  const pan = { x: 30, y: -20 }
  const next = zoomPan(pan, 2, 4, from, to)
  expect((to.x - next.x) / 4).toBe((from.x - pan.x) / 2)
  expect((to.y - next.y) / 4).toBe((from.y - pan.y) / 2)
})
