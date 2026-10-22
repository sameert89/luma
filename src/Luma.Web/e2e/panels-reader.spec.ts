import { test, expect } from '@playwright/test'

test('comic progress survives exit/reopen, pinch zoom persists, and continuous pages meet without gaps', async ({
  page,
}, info) => {
  let saved = 2
  const comic = () => ({
    id: 9,
    libraryId: 1,
    title: 'Reader regression',
    series: '',
    author: '',
    description: '',
    format: 'zip',
    pageCount: 10,
    pageIndex: saved,
    state: 'reading',
    readingSeconds: 1.5,
    direction: 'ltr',
    settings: '{}',
    lastReadAt: '2026-10-19',
    favourite: false,
    coverUrl: null,
    coverPage: 0,
  })
  await page.route('**/api/panels/comics/9', route => route.fulfill({ json: comic() }))
  await page.route('**/api/panels/comics/9/progress', async route => {
    saved = route.request().postDataJSON().pageIndex
    await route.fulfill({ status: 204 })
  })
  await page.route('**/api/panels/comics/9/pages/**', route =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="white"/></svg>',
    }),
  )
  await page.goto('/panels?comic=9')
  const counter = page.getByRole('button', { name: 'Go to page', exact: true })
  await expect(counter).toHaveText('3 / 10')
  await counter.click()
  await page.getByRole('spinbutton', { name: 'Go to page' }).fill('8')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect.poll(() => page.evaluate(() => history.state?.lumaModal)).toBeFalsy()
  await page.getByRole('button', { name: 'Exit reader', exact: true }).click()
  await expect.poll(() => saved).toBe(7)
  await expect(counter).toHaveCount(0)
  await page.goBack()
  await expect(counter).toHaveText('8 / 10')
  if (info.project.name === 'mobile') {
    const image = page.getByRole('img', { name: 'Reader regression, page 8', exact: true })
    const box = (await image.boundingBox())!
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2
    const touch = await page.context().newCDPSession(page)
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: x - 30, y, id: 0 },
        { x: x + 30, y, id: 1 },
      ],
    })
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: x - 70, y, id: 0 },
        { x: x + 70, y, id: 1 },
      ],
    })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(image).toHaveCSS('transform', /matrix\(2\./)
    await expect(counter).toHaveText('8 / 10')
  }
  await page.getByRole('button', { name: 'Reader settings', exact: true }).click()
  const mode = page.getByRole('combobox', { name: 'Reading mode' })
  const control = (await mode.boundingBox())!,
    arrow = (await mode.locator('..').locator('svg').boundingBox())!
  expect(control.x + control.width - arrow.x - arrow.width).toBeGreaterThan(8)
  await mode.selectOption('continuous')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect.poll(() => page.evaluate(() => history.state?.lumaModal)).toBeFalsy()
  const first = page.getByRole('img', { name: 'Reader regression, page 8', exact: true })
  const next = page.getByRole('img', { name: 'Reader regression, page 9', exact: true })
  await expect(first).toHaveJSProperty('complete', true)
  await expect(next).toHaveJSProperty('complete', true)
  await expect
    .poll(async () => {
      const a = (await first.boundingBox())!,
        b = (await next.boundingBox())!
      return Math.abs(b.y - a.y - a.height)
    })
    .toBeLessThan(1)
  await expect(counter).toHaveText('8 / 10')
})
