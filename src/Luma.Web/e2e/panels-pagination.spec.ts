import { test, expect } from '@playwright/test'

test('comic pages start at the top and reader navigation restores the bookshelf position', async ({ page }, info) => {
  const comic = (id: number) => ({
    id,
    libraryId: 1,
    title: `Comic ${id}`,
    series: '',
    author: '',
    description: '',
    format: 'zip',
    pageCount: 2,
    pageIndex: 0,
    state: 'unread',
    readingSeconds: 0,
    direction: 'ltr',
    settings: '{}',
    lastReadAt: null,
    favourite: false,
    coverUrl: null,
    coverPage: 0,
  })
  await page.route('**/api/panels/sources', route =>
    route.fulfill({
      json: { configured: true, locations: [{ libraryId: 1, relativePath: '', imageFolders: false }] },
    }),
  )
  await page.route('**/api/panels/folders?**', route => route.fulfill({ json: { items: [], nextCursor: null } }))
  await page.route('**/api/panels/comics?**', async route => {
    const cursor = Number(new URL(route.request().url()).searchParams.get('cursor'))
    // Force a loading frame so restoration also covers uncached pages.
    await new Promise(resolve => setTimeout(resolve, 100))
    await route.fulfill({
      json: {
        items: Array.from({ length: 30 }, (_, index) => comic(cursor + index + 1)),
        nextCursor: cursor < 60 ? cursor + 30 : null,
      },
    })
  })
  await page.route(/\/api\/panels\/comics\/\d+$/, route =>
    route.fulfill({
      json: comic(Number(new URL(route.request().url()).pathname.split('/').at(-1))),
    }),
  )
  await page.route('**/api/panels/comics/*/progress', route => route.fulfill({ status: 204 }))
  await page.route('**/api/panels/comics/*/pages/**', route =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="white"/></svg>',
    }),
  )
  await page.goto('/panels?libraryId=1&path=')
  const shelf = () =>
    page
      .getByRole('button', { name: 'Read Comic 31', exact: true })
      .locator('xpath=ancestor::div[contains(@class,"overflow-auto")][1]')
  const next = page.getByRole('button', { name: 'Next page', exact: true })
  const previous = page.getByRole('button', { name: 'Previous page', exact: true })
  await expect(previous).toBeDisabled()
  await next.click()
  await expect(page.getByRole('button', { name: 'Read Comic 31', exact: true })).toBeVisible()
  await expect(shelf()).toHaveJSProperty('scrollTop', 0)
  await expect(page.getByText('Page 2', { exact: true })).toBeVisible()
  const target = page.getByRole('button', { name: 'Read Comic 46', exact: true })
  await target.scrollIntoViewIfNeeded()
  const offset = await shelf().evaluate(element => element.scrollTop)
  expect(offset).toBeGreaterThan(100)
  await target.click()
  await page.getByRole('button', { name: 'Exit reader', exact: true }).click()
  await expect(target).toBeVisible()
  await expect(shelf()).toHaveJSProperty('scrollTop', offset)
  await target.click()
  await expect(page.getByRole('button', { name: 'Exit reader', exact: true })).toBeVisible()
  await page.goBack()
  await expect(target).toBeVisible()
  await expect(shelf()).toHaveJSProperty('scrollTop', offset)
  await next.scrollIntoViewIfNeeded()
  await expect(next).toBeEnabled()
  // Clicking can focus/scroll the button after scrollIntoViewIfNeeded. Capture
  // the real departure offset before React handles navigation, not an earlier one.
  await next.evaluate(button => {
    button.addEventListener(
      'click',
      () => {
        document.documentElement.dataset.panelsDepartureScroll = String(button.closest('.overflow-auto')!.scrollTop)
      },
      { capture: true, once: true },
    )
  })
  await next.click()
  const beforeNext = Number(await page.locator('html').getAttribute('data-panels-departure-scroll'))
  expect(beforeNext).toBeGreaterThan(100)
  await expect(page.getByRole('button', { name: 'Read Comic 61', exact: true })).toBeVisible()
  await expect(next).toBeDisabled()
  await expect(page.getByText('Page 3', { exact: true })).toBeVisible()
  await previous.click()
  await expect(page.getByRole('button', { name: 'Read Comic 31', exact: true })).toBeVisible()
  await expect(shelf()).toHaveJSProperty('scrollTop', 0)
  await next.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('panels-pagination.png'), animations: 'disabled' })
  await page.goBack()
  await expect(page.getByText('Page 3', { exact: true })).toBeVisible()
  await page.goBack()
  await expect(target).toBeVisible()
  await expect(shelf()).toHaveJSProperty('scrollTop', beforeNext)
})
