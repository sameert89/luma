import { test, expect, type Locator, type Page } from '@playwright/test'

async function openComic(page: Page, fit: string, mode = 'single') {
  await page.route('**/api/panels/sources', route =>
    route.fulfill({
      json: { configured: true, locations: [{ libraryId: 1, relativePath: '', imageFolders: false }] },
    }),
  )
  await page.route('**/api/panels/comics/99', route =>
    route.fulfill({
      json: {
        id: 99,
        libraryId: 1,
        title: 'Zoom comic',
        series: '',
        author: '',
        description: '',
        format: 'zip',
        pageCount: 2,
        pageIndex: 0,
        state: 'reading',
        readingSeconds: 0,
        direction: 'ltr',
        settings: JSON.stringify({ mode, fit }),
        lastReadAt: null,
        favourite: false,
        coverUrl: null,
        coverPage: 0,
      },
    }),
  )
  await page.route('**/api/panels/comics/99/progress', route => route.fulfill({ status: 204 }))
  await page.route('**/api/panels/comics/99/pages/**', route =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="white"/><rect x="250" y="100" width="100" height="100" fill="red"/></svg>',
    }),
  )
  await page.goto('/panels?comic=99')
  const image = page.getByRole('img', { name: 'Zoom comic, page 1', exact: true })
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  const stage = page.getByRole('group', { name: 'Comic page gestures' })
  await stage.evaluate(async element => {
    // Take coordinates after entry animations settle, as a reader sees them.
    for (let parent: Element | null = element; parent; parent = parent.parentElement) {
      await Promise.all(
        parent
          .getAnimations()
          .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
          .map(animation => animation.finished.catch(() => {})),
      )
    }
  })
  return { image, stage }
}

async function region(image: Locator, stage: Locator) {
  const viewport = (await stage.boundingBox())!
  const bounds = (await image.boundingBox())!
  const point = { x: viewport.x + viewport.width * 0.7, y: viewport.y + viewport.height * 0.35 }
  return { point, u: (point.x - bounds.x) / bounds.width, v: (point.y - bounds.y) / bounds.height }
}

async function expectAnchor(image: Locator, anchor: Awaited<ReturnType<typeof region>>) {
  await expect
    .poll(async () => {
      const bounds = (await image.boundingBox())!
      return Math.hypot(
        bounds.x + bounds.width * anchor.u - anchor.point.x,
        bounds.y + bounds.height * anchor.v - anchor.point.y,
      )
    })
    .toBeLessThan(1)
}

for (const fit of ['screen', 'width']) {
  test(`comic ${fit} zoom stays on the tapped and pinched region`, async ({ page }, info) => {
    const { image, stage } = await openComic(page, fit)
    if (fit === 'width')
      await stage.evaluate(element => {
        element.scrollTop = 80
      })
    let anchor = await region(image, stage)
    if (info.project.name === 'mobile') {
      await page.touchscreen.tap(anchor.point.x, anchor.point.y)
      await page.touchscreen.tap(anchor.point.x, anchor.point.y)
    } else {
      await page.mouse.dblclick(anchor.point.x, anchor.point.y)
    }
    await expect(image).toHaveAttribute('style', /scale\(2\)/)
    await expectAnchor(image, anchor)
    if (info.project.name === 'mobile') {
      await page.touchscreen.tap(anchor.point.x, anchor.point.y)
      await page.touchscreen.tap(anchor.point.x, anchor.point.y)
    } else {
      await page.mouse.dblclick(anchor.point.x, anchor.point.y)
    }
    await expect(image).toHaveAttribute('style', /scale\(1\)/)
    if (info.project.name === 'desktop') {
      anchor = await region(image, stage)
      const width = await page.evaluate(() => window.innerWidth)
      await page.mouse.move(anchor.point.x, anchor.point.y)
      await page.keyboard.down('Control')
      await page.mouse.wheel(0, -200)
      await page.keyboard.up('Control')
      await expect(image).toHaveAttribute('style', /scale\(2\)/)
      await expectAnchor(image, anchor)
      expect(await page.evaluate(() => window.innerWidth)).toBe(width)
    }
    if (info.project.name === 'mobile') {
      anchor = await region(image, stage)
      const { x, y } = anchor.point
      const session = await page.context().newCDPSession(page)
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [
          { x: x - 20, y, id: 0 },
          { x: x + 20, y, id: 1 },
        ],
      })
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: x - 40, y, id: 0 },
          { x: x + 40, y, id: 1 },
        ],
      })
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect(image).toHaveAttribute('style', /scale\(2\)/)
      await expectAnchor(image, anchor)
      await expect(page.getByRole('button', { name: 'Go to page', exact: true })).toHaveText('1 / 2')
    }
    await page.screenshot({ path: info.outputPath(`comic-region-zoom-${fit}.png`), animations: 'disabled' })
  })
}

test('reader Back remains usable when a progress request stalls', async ({ page }) => {
  await openComic(page, 'screen')
  await page.unroute('**/api/panels/comics/99/progress')
  await page.route('**/api/panels/comics/99/progress', async route => {
    // Keep the response pending past the navigation deadline, without failing or
    // aborting it: this is the connection state that used to trap the reader.
    await new Promise(resolve => setTimeout(resolve, 2500))
    await route.fulfill({ status: 204 }).catch(() => {})
  })
  await page.getByRole('button', { name: 'Next page', exact: true }).click()
  await page.getByRole('button', { name: 'Exit reader', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Exit reader', exact: true })).toHaveCount(0)
  await expect(page).not.toHaveURL(/comic=/)
})

test('continuous comic zoom stays on a region near the end of a scrolled comic', async ({ page }, info) => {
  const { stage } = await openComic(page, 'width', 'continuous')
  await stage.evaluate(element => {
    element.scrollTop = element.scrollHeight - element.clientHeight - 50
  })
  const image = page.getByRole('img', { name: 'Zoom comic, page 2', exact: true })
  await expect(image).toBeVisible()
  const anchor = await region(image, stage)
  if (info.project.name === 'mobile') {
    const { x, y } = anchor.point
    const session = await page.context().newCDPSession(page)
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: x - 20, y, id: 0 },
        { x: x + 20, y, id: 1 },
      ],
    })
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: x - 40, y, id: 0 },
        { x: x + 40, y, id: 1 },
      ],
    })
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } else {
    await page.mouse.move(anchor.point.x, anchor.point.y)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -200)
    await page.keyboard.up('Control')
  }
  await expectAnchor(image, anchor)
})
