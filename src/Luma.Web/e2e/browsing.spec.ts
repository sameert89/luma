import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('media-cell').first()).toBeVisible()
  await expect(page.getByTestId('media-cell').first().locator('img')).toBeVisible()
})

test('browses cached media, navigates the viewer, and restores position and focus', async ({ page }) => {
  const errors: string[] = []
  const cacheFailures: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => { if (response.url().includes('/cache/') && !response.ok()) cacheFailures.push(`${response.status()} ${response.url()}`) })
  const scroller = page.getByTestId('gallery-scroll')
  await scroller.evaluate(element => { element.scrollTop = 900; element.dispatchEvent(new Event('scroll')) })
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  const opened = await scroller.evaluate(element => {
    const viewport = element.getBoundingClientRect()
    const trigger = [...element.querySelectorAll<HTMLButtonElement>('button[data-media-id]')]
      .find(button => { const rect = button.getBoundingClientRect(); return rect.top >= viewport.top && rect.bottom <= viewport.bottom })
    if (!trigger) throw new Error('No fully visible media item')
    const result = { id: trigger.dataset.mediaId!, position: element.scrollTop }
    trigger.click()
    return result
  })
  const viewer = page.getByRole('dialog')
  await expect(viewer).toBeVisible()
  await expect(viewer.getByRole('img')).toBeVisible()
  const heading = viewer.getByRole('heading', { level: 2, name: 'Tags' })
  await expect(heading).toBeVisible()
  const currentTitle = await viewer.locator('header').textContent()
  const next = viewer.getByRole('button', { name: 'Next item' })
  await expect(next).toBeEnabled()
  await next.click()
  await expect(viewer.locator('header')).not.toHaveText(currentTitle ?? '')
  await page.keyboard.press('Escape')
  await expect(viewer).toBeHidden()
  await expect(page.locator(`button[data-media-id="${opened.id}"]`)).toBeFocused()
  expect(Math.abs(await scroller.evaluate(element => element.scrollTop) - opened.position)).toBeLessThan(5)
  expect(errors).toEqual([])
  expect(cacheFailures).toEqual([])
  await page.screenshot({ path: `test-results/gallery-${test.info().project.name}.png`, fullPage: true })
})

test('keeps the virtualized gallery and retained summaries bounded', async ({ page }) => {
  const scroller = page.getByTestId('gallery-scroll')
  const grid = page.getByTestId('gallery-grid')
  for (let pageNumber = 0; pageNumber < 8; pageNumber++) {
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')) })
    await page.waitForTimeout(150)
  }
  expect(await page.getByTestId('media-cell').count()).toBeLessThanOrEqual(80)
  expect(Number(await grid.getAttribute('data-retained-items'))).toBeLessThanOrEqual(300)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('searches and edits tags with keyboard-accessible controls', async ({ page }, testInfo) => {
  const search = page.getByRole('textbox', { name: 'Search media' })
  await search.fill('holiday')
  await search.press('Enter')
  await expect(page).toHaveURL(/q=holiday/)
  await expect(page.getByTestId('media-cell').first()).toBeVisible()

  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await page.getByRole('checkbox').first().check()
  await page.getByRole('button', { name: 'Edit tags' }).click()
  const editor = page.getByRole('dialog', { name: /Tag 1 items/ })
  await expect(editor).toBeVisible()
  await editor.getByRole('combobox', { name: 'Tag name' }).fill(`Browser ${testInfo.project.name}`)
  await editor.getByRole('button', { name: 'Apply to 1 items' }).click()
  await expect(editor.getByRole('status')).toHaveText('Tags saved.')
  await page.keyboard.press('Escape')
  await expect(editor).toBeHidden()
})
