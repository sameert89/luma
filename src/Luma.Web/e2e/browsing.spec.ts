import { test, expect } from '@playwright/test'
import { galleryAction, viewerAction } from './helpers'
import { DatabaseSync } from 'node:sqlite'
import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your libraries' })).toBeVisible()
  await expect(page.getByTestId('media-cell')).toHaveCount(0)
  const cover = page.getByRole('button', { name: 'Open Sample library', exact: true }).locator('img').first()
  await expect(cover).toBeVisible()
  await expect.poll(() => cover.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await page.screenshot({ animations: 'disabled', path: `test-results/libraries-${test.info().project.name}.png`, fullPage: true })
  await page.getByRole('button', { name: 'Open Sample library', exact: true }).click()
  await expect(page.getByTestId('media-cell').first()).toBeVisible()
  await expect(page.getByTestId('media-cell').first().locator('img')).toBeVisible()
  await expect.poll(() => page.getByTestId('media-cell').first().locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
})

test('anchors mobile search to its icon and closes it with the cross', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Mobile search reveal')
  const open = page.getByRole('button', { name: 'Open search' })
  const filters = page.getByRole('button', { name: 'Filters', exact: true })
  const filterPosition = await filters.boundingBox()
  const buttonPosition = await open.boundingBox()
  expect(buttonPosition!.x).toBeGreaterThan(page.viewportSize()!.width / 2)
  await open.click()
  const search = page.getByRole('textbox', { name: 'Search media' })
  await expect(search).toBeFocused()
  await expect(page.getByRole('button', { name: 'Close search' })).toBeVisible()
  await expect.poll(async () => (await filters.boundingBox())?.x).toBe(filterPosition!.x)
  await search.fill('holiday')
  await page.screenshot({ animations: 'disabled', path: 'test-results/search-mobile.png' })
  // With text entered the cross clears it first; the next cross closes the field.
  await expect(page.getByRole('button', { name: 'Close search' })).toBeHidden()
  await page.getByRole('button', { name: 'Clear search' }).click()
  await expect(search).toHaveValue('')
  await page.getByRole('button', { name: 'Close search' }).click()
  await expect(open).toBeVisible()
  await expect(search).toBeHidden()
})

test('previews distinct light and dark themes and scrolls settings clear of navigation', async ({ page }, testInfo) => {
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('region', { name: 'Theme settings' })
  for (const [name, theme] of [['White', 'light'], ['Red & white', 'crimson'], ['Orange & black', 'ember'], ['Cinema red', 'cinema'], ['Midnight blue', 'midnight'], ['OLED black', 'oled'], ['Forest', 'forest'], ['Dark', 'obsidian']]) {
    const button = settings.getByRole('button', { name, exact: true })
    await button.scrollIntoViewIfNeeded()
    await button.click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await expect(button).toHaveAttribute('aria-pressed', 'true')
    await page.screenshot({ animations: 'disabled', path: `test-results/theme-${theme}-${testInfo.project.name}.png` })
    if (theme === 'cinema' || theme === 'midnight') {
      const navigation = page.getByRole('navigation', { name: 'Primary navigation' })
      await navigation.getByRole('button', { name: 'Library', exact: true }).click()
      await expect(page.getByTestId('media-cell').first()).toBeVisible()
      await page.screenshot({ animations: 'disabled', path: `test-results/gallery-${theme}-${testInfo.project.name}.png` })
      await navigation.getByRole('button', { name: 'Settings', exact: true }).click()
    }
  }
  const last = settings.getByRole('button', { name: 'Red & white', exact: true })
  await last.scrollIntoViewIfNeeded()
  if (testInfo.project.name === 'mobile') {
    const card = await last.boundingBox()
    const navigation = await page.getByRole('navigation', { name: 'Primary navigation' }).boundingBox()
    expect(card!.y + card!.height).toBeLessThanOrEqual(navigation!.y)
  }
})

test('cancelling preparation stops the busy indicator even with paused jobs', async ({ page }) => {
  let cancelled = false
  await page.route('**/api/indexing', route => route.fulfill({ json: { libraries: [{ id: 1, latestScanId: 901 }] } }))
  await page.route('**/api/scans/901', route => route.fulfill({ json: { id: 901, libraryId: 1, state: cancelled ? 'cancelled' : 'completed', discovered: 1500, ready: 1000, pending: 500, processing: 0, failed: 0 } }))
  await page.route('**/api/tasks', route => route.fulfill({ json: cancelled ? [] : [{ id: 'scan-901', kind: 'indexing', state: 'running', processed: 1000, pending: 500, failed: 0 }] }))
  await page.route('**/api/tasks/scan-901/cancel', async route => { cancelled = true; await route.fulfill({ status: 204 }) })
  // Opening status triggers the shared query without waiting for its polling interval.
  await page.getByRole('button', { name: 'Rescan Sample library', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Cancel scan' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel scan' }).click()
  await expect.poll(() => cancelled).toBe(true)
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Rescan Sample library', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'View scan progress for Sample library' })).toHaveCount(0)
})

test('selection is visible and its full checkbox target can be tapped', async ({ page }) => {
  await (await galleryAction(page, 'Select media')).click()
  const checkbox = page.getByRole('checkbox').first()
  const bounds = await checkbox.boundingBox()
  expect(bounds!.width).toBeGreaterThanOrEqual(44)
  expect(bounds!.height).toBeGreaterThanOrEqual(44)
  await checkbox.click({ position: { x: 3, y: 3 } })
  await expect(checkbox).toBeChecked()
  await page.screenshot({ animations: 'disabled', path: `test-results/selection-${test.info().project.name}.png` })
  await (await galleryAction(page, 'Done selecting')).click()
  await expect(page.getByRole('checkbox')).toHaveCount(0)
})

test('Collections favourites clear browse filters and keeps a persisted like across refresh and navigation', async ({ page }) => {
  const item = page.getByTestId('media-cell').first().locator('button[data-media-id]')
  const id = await item.getAttribute('data-media-id')
  await item.click()
  const viewer = page.getByRole('dialog')
  const like = viewer.getByRole('button', { name: 'Like', exact: true })
  if (await like.getAttribute('aria-pressed') === 'true') { await like.click(); await expect(like).toHaveAttribute('aria-pressed', 'false') }
  await like.click()
  await expect(like).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(viewer).toBeHidden()
  const nav = page.getByRole('navigation', { name: 'Primary navigation' })
  await nav.getByRole('button', { name: 'Collections', exact: true }).click()
  await page.getByRole('button', { name: 'Open favourites', exact: true }).click()
  await expect(page).not.toHaveURL(/folderId|libraryId/)
  const saved = page.locator(`button[data-media-id="${id}"]`)
  await expect(saved).toBeVisible()
  await (await galleryAction(page, 'Refresh collection')).click()
  await expect(saved).toBeVisible()
  await nav.getByRole('button', { name: 'Settings', exact: true }).click()
  await nav.getByRole('button', { name: 'Collections', exact: true }).click()
  await page.getByRole('button', { name: 'Open favourites', exact: true }).click()
  await expect(saved).toBeVisible()
  // Restore the fixture preference for subsequent tests.
  await page.request.put(`/api/media/${id}/preference`, { data: { preference: 'neutral' } })
})

test('dialog motion supports entering, exiting and reduced motion', async ({ page }) => {
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Filters and sorting' })
  await expect(dialog.getByRole('combobox', { name: 'Media type' })).toBeVisible()
  await expect(dialog.locator('[data-motion-panel]')).toHaveCSS('animation-duration', '0.18s')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'Filters', exact: true })).toBeFocused()
  await expect(page.locator('.motion-overlay')).toHaveCount(0)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  await expect(dialog.locator('[data-motion-panel]')).toHaveCSS('animation-name', 'none')
  await expect(dialog.getByRole('combobox', { name: 'Media type' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await page.getByTestId('media-cell').first().locator('button[data-media-id]').click()
  await expect(page.locator('.motion-media')).toHaveCSS('animation-name', 'none')
  await expect(page.getByRole('button', { name: 'Close viewer', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
})

test('opening an unindexed folder discovers its files and prepares previews without a library scan', async ({ page }, testInfo) => {
  const fixture = path.resolve('../../.local/browser-fixture-v2')
  const relative = `On-demand-${testInfo.project.name}-${Date.now()}`
  await mkdir(path.join(fixture, 'media', relative), { recursive: true })
  await copyFile(path.join(fixture, 'cache', 'palette-1.jpg'), path.join(fixture, 'media', relative, 'new-photo.jpg'))
  const db = new DatabaseSync(path.join(fixture, 'fixture.db'))
  let folderId: number
  try {
    db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON')
    const row = db.prepare(`INSERT INTO Folders(LibraryId,ParentId,RelativePath,PathKey,LastSeenScanId)
      VALUES(1,1,?,?,1) ON CONFLICT(LibraryId,PathKey) DO UPDATE SET DirectIndexedAt=NULL RETURNING Id`).get(relative, relative)!
    folderId = Number(row.Id)
    db.prepare('INSERT OR IGNORE INTO FolderAncestry VALUES(1,?)').run(folderId)
    db.prepare('INSERT OR IGNORE INTO FolderAncestry VALUES(?,?)').run(folderId, folderId)
  } finally { db.close() }
  let libraryScans = 0
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/libraries\/\d+\/scans$/.test(request.url())) libraryScans++ })
  await page.goto(`/?libraryId=1&folderId=${folderId}`)
  const cell = page.getByTestId('media-cell').filter({ has: page.getByRole('button', { name: 'Open new-photo.jpg', exact: true }) })
  await expect(cell).toBeVisible({ timeout: 20000 })
  await expect(cell.locator('img')).toBeVisible({ timeout: 20000 })
  await expect.poll(() => cell.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await cell.getByRole('button').click()
  await expect(page.getByRole('dialog').getByRole('img')).toBeVisible()
  expect(libraryScans).toBe(0)
  await page.keyboard.press('Escape')
  await page.screenshot({ animations: 'disabled', path: `test-results/on-demand-${testInfo.project.name}.png` })
})

test('requires confirmation before starting a rescan and exposes mobile progress', async ({ page }, testInfo) => {
  let requested = false
  await page.route('**/api/libraries/1/scans', async route => {
    requested = true
    await route.fulfill({ status: 202, json: { id: 900 } })
  })
  await page.route('**/api/indexing', async route => {
    if (!requested) return route.continue()
    await route.fulfill({ json: { libraries: [{ id: 1, name: 'Sample library', latestScanId: 900 }], cachePressure: false } })
  })
  await page.route('**/api/scans/900', route => route.fulfill({ json: { id: 900, libraryId: 1, state: 'running', discovered: 1500, ready: 1000, pending: 500, processing: 0, failed: 0 } }))
  const rescan = page.getByRole('button', { name: 'Rescan Sample library', exact: true })
  await rescan.click()
  const confirmation = page.getByRole('dialog', { name: 'Background tasks' })
  await expect(confirmation).toContainText('significant disk and CPU resources')
  expect(requested).toBe(false)
  await confirmation.getByRole('button', { name: 'Not now' }).click()
  expect(requested).toBe(false)
  await rescan.click()
  await confirmation.getByRole('button', { name: 'Start rescan' }).click()
  const progress = page.getByRole('button', { name: 'View scan progress for Sample library' })
  await expect(progress).toBeVisible()
  expect(requested).toBe(true)
  await progress.click()
  await expect(page.getByRole('dialog', { name: 'Background tasks' }).getByRole('status')).toContainText('Checking folders for changes')
  await page.screenshot({ animations: 'disabled', path: `test-results/scanning-${testInfo.project.name}.png` })
})

test('browses cached media, navigates the viewer, and restores position and focus', async ({ page }) => {
  const errors: string[] = []
  const cacheFailures: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => { if (response.url().includes('/cache/') && !response.ok()) cacheFailures.push(`${response.status()} ${response.url()}`) })
  const scroller = page.getByTestId('gallery-scroll')
  await scroller.evaluate(element => { const grid = element.querySelector('[data-testid=gallery-grid]')!; element.scrollTop += grid.getBoundingClientRect().top - element.getBoundingClientRect().top + 900; element.dispatchEvent(new Event('scroll')) })
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
  await expect(viewer.locator('img,video')).toBeVisible()
  await page.screenshot({ animations: 'disabled', path: `test-results/viewer-${test.info().project.name}.png`, fullPage: true })
  await (await viewerAction(page, 'Media details')).click()
  const details = page.getByRole('dialog', { name: 'Media details' })
  await expect(details.getByRole('heading', { level: 2, name: 'Tags' })).toBeVisible()
  await page.keyboard.press('Escape')
  const currentTitle = await viewer.locator('header').textContent()
  const next = await viewerAction(page, 'Next item')
  await expect(next).toBeEnabled()
  await next.click()
  await expect(viewer.locator('header')).not.toHaveText(currentTitle ?? '')
  await expect(viewer.locator('.motion-media')).toHaveAttribute('data-direction', 'next')
  await expect(viewer.locator('.motion-media')).toHaveCSS('animation-duration', '0.18s')
  await expect(viewer.locator('img,video')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(viewer).toBeHidden()
  await expect(page.locator(`button[data-media-id="${opened.id}"]`)).toBeFocused()
  expect(Math.abs(await scroller.evaluate(element => element.scrollTop) - opened.position)).toBeLessThan(5)
  expect(errors).toEqual([])
  expect(cacheFailures).toEqual([])
  await page.screenshot({ animations: 'disabled', path: `test-results/gallery-${test.info().project.name}.png`, fullPage: true })
})

test('keeps the mobile filter sheet inside the viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Mobile-specific layout check')
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Filters and sorting' })
  await expect(dialog).toBeVisible()
  await page.screenshot({ animations: 'disabled', path: `test-results/filters-${testInfo.project.name}.png`, fullPage: true })
  expect(await dialog.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return rect.left >= 0 && rect.right <= window.innerWidth && element.scrollWidth <= element.clientWidth
  })).toBe(true)
  await expect(dialog.getByRole('button', { name: 'Apply filters' })).toBeVisible()
})

test('keeps the virtualized gallery and retained summaries bounded', async ({ page }) => {
  const scroller = page.getByTestId('gallery-scroll')
  const grid = page.getByTestId('gallery-grid')
  let loadedPages = 1
  page.on('response', response => {
    const url = new URL(response.url())
    if (url.pathname === '/api/media' && url.searchParams.has('cursor') && response.ok()) loadedPages++
  })
  for (let pageNumber = 0; pageNumber < 8; pageNumber++) {
    const previous = loadedPages
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')) })
    await expect.poll(() => loadedPages).toBeGreaterThan(previous)
  }
  expect(loadedPages).toBeGreaterThan(5)
  expect(await page.getByTestId('media-cell').count()).toBeLessThanOrEqual(80)
  expect(Number(await grid.getAttribute('data-retained-items'))).toBeLessThanOrEqual(300)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('searches and edits tags with keyboard-accessible controls', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: 'Open search' }).click()
  const search = page.getByRole('textbox', { name: 'Search media' })
  await search.fill('holiday')
  await search.press('Enter')
  await expect(page).toHaveURL(/q=holiday/)
  await expect(page.getByTestId('media-cell').first()).toBeVisible()

  await (await galleryAction(page, 'Select media')).click()
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
