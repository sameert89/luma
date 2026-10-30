import { test, expect } from '@playwright/test'

test('comic cards align without tags, show cover details and use theme accent progress', async ({ page }, info) => {
  const comics = ['Short', 'A much longer comic title that wraps to two lines'].map((title, index) => ({
    id: index + 801,
    libraryId: 1,
    title,
    series: '',
    author: '',
    description: '',
    format: 'pdf',
    pageCount: 41,
    pageIndex: 20,
    state: 'reading',
    readingSeconds: 30,
    direction: 'ltr',
    settings: '{}',
    lastReadAt: null,
    favourite: false,
    coverUrl: null,
    coverPage: 0,
    tags: index
      ? [
          { id: 1, name: 'Action' },
          { id: 2, name: 'A very long tag that should truncate' },
        ]
      : [],
    tagCount: index ? 5 : 0,
  }))
  await page.route('**/api/panels/sources', route =>
    route.fulfill({ json: { configured: true, locations: [{ libraryId: 1, relativePath: '' }] } }),
  )
  await page.route('**/api/panels/refresh', route => route.fulfill({ status: 204 }))
  await page.route('**/api/panels/folders?**', route => route.fulfill({ json: { items: [], nextCursor: null } }))
  await page.route('**/api/panels/comics?**', route => route.fulfill({ json: { items: comics, nextCursor: null } }))
  await page.route('**/api/panels/recently-added', route => route.fulfill({ json: comics }))
  await page.route('**/api/panels/continue-reading', route => route.fulfill({ json: comics }))
  await page.route('**/api/panels/comics/802', route => route.fulfill({ json: comics[1] }))
  await page.route('**/api/panels/comics/802/tags', route => route.fulfill({ json: comics[1].tags }))
  await page.goto('/panels?libraryId=1&path=')
  const cards = page.locator('article').filter({ has: page.getByRole('button', { name: /^Read / }) })
  await expect(cards).toHaveCount(2)
  const sizes = await cards.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height))
  expect(Math.abs(sizes[0] - sizes[1])).toBeLessThan(1)
  await expect(cards.nth(1).getByText('+3', { exact: true })).toBeVisible()
  const details = cards.nth(1).getByRole('button', { name: /^Edit details/ })
  const cover = await cards.nth(1).locator('.aspect-book').boundingBox()
  const control = await details.boundingBox()
  expect(control!.y).toBeGreaterThanOrEqual(cover!.y)
  expect(control!.y + control!.height).toBeLessThan(cover!.y + cover!.height)
  const accentMatches = await cards
    .first()
    .getByRole('progressbar')
    .evaluate(element => {
      const probe = document.createElement('div')
      probe.style.backgroundColor = 'var(--color-accent)'
      document.body.append(probe)
      const same =
        getComputedStyle(element.firstElementChild!).backgroundColor === getComputedStyle(probe).backgroundColor
      probe.remove()
      return same
    })
  expect(accentMatches).toBe(true)
  await page.screenshot({ path: info.outputPath('comic-cards.png'), animations: 'disabled' })
  await details.click()
  await expect(page.getByRole('dialog', { name: 'Comic details', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Bookshelf', exact: true }).click()
  const recent = page.getByRole('region', { name: 'Recently added' })
  const continuing = page.getByRole('region', { name: 'Continue reading' })
  await expect(recent.getByRole('button', { name: /^Read / })).toHaveCount(2)
  expect(
    await recent
      .locator('article')
      .first()
      .evaluate(element => element.getBoundingClientRect().width),
  ).toBe(
    await continuing
      .locator('article')
      .first()
      .evaluate(element => element.getBoundingClientRect().width),
  )
})
