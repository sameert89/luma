import { test, expect, type Page } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, utimes } from 'node:fs/promises'
import path from 'node:path'

const fixture = path.resolve('../../.local/browser-fixture-v2')

// A playable clip of a known length, so seeking has a real duration to report.
test.beforeAll(() => {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=green:s=320x240:r=24', '-t', '4',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-threads', '1', '-movflags', '+faststart',
    path.join(fixture, 'media/feedback-clip.mp4')])
  const db = new DatabaseSync(path.join(fixture, 'fixture.db'))
  db.function('luma_key', { deterministic: true }, (value: string) => value.normalize('NFC').toUpperCase())
  db.function('luma_reverse', { deterministic: true }, (value: string) => [...value].reverse().join(''))
  db.function('luma_ticks', { deterministic: true }, (value: string) => BigInt(Date.parse(value)) * 10000n + 621355968000000000n)
  try {
    db.prepare(`UPDATE Media SET FolderId=2,FileName='feedback-clip.mp4',RelativePath='feedback-clip.mp4',
      PathKey='feedback-clip.mp4',MediaType='video',MimeType='video/mp4',Extension='.mp4' WHERE Id=1480`).run()
  } finally { db.close() }
})

async function displayedOrder(page: Page) {
  return page.locator('[data-testid="media-cell"] button[data-media-id]').evaluateAll(
    buttons => buttons.map(button => Number(button.getAttribute('data-media-id'))))
}

test('asks for previews in the order the gallery shows them', async ({ page }) => {
  // Unprepared previews are reported for a settled result page, so the request the
  // gallery makes can be compared with what is on screen.
  await page.route('**/api/media?*', async route => {
    const response = await route.fetch()
    const page_ = await response.json() as { items: { thumbnail: { status: string }; preview: { status: string } }[] }
    for (const item of page_.items) { item.thumbnail.status = 'pending'; item.preview.status = 'pending' }
    await route.fulfill({ response, json: page_ })
  })
  const batches: number[][] = []
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/api/media/priority'))
      batches.push((request.postDataJSON() as { ids: number[] }).ids)
  })
  await page.goto('/?libraryId=1&folderId=1')
  await expect(page.getByTestId('media-cell').first()).toBeVisible()
  await expect.poll(() => batches.length, { timeout: 15000 }).toBeGreaterThan(0)

  const displayed = await displayedOrder(page)
  expect(displayed.length).toBeGreaterThan(3)
  // Newest first is not media-ID order, so an ID-ordered batch would be a real regression.
  expect(displayed).not.toEqual([...displayed].sort((left, right) => left - right))
  for (const ids of batches) {
    expect(ids.length).toBeLessThanOrEqual(200)
    // What is on screen is asked for first, and in the order it appears.
    expect(ids.slice(0, displayed.length)).toEqual(displayed)
  }
})

test('prepares an unindexed folder starting from what is on screen', async ({ page }, testInfo) => {
  const relative = `Priority-${testInfo.project.name}-${Date.now()}`
  await mkdir(path.join(fixture, 'media', relative), { recursive: true })
  // Copied from a registered cache entry, which cache maintenance keeps. Newest first is the
  // reverse of the discovery order, so media IDs cannot stand in for what is on screen.
  const source = path.join(fixture, 'cache', '01', '1', '1-1-preview.jpg')
  for (let index = 0; index < 8; index++) {
    const file = path.join(fixture, 'media', relative, `photo-${index}.jpg`)
    await copyFile(source, file)
    const stamp = new Date(Date.UTC(2026, 0, 1 + index))
    await utimes(file, stamp, stamp)
  }
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

  await page.goto(`/?libraryId=1&folderId=${folderId}`)
  await expect(page.getByTestId('media-cell')).toHaveCount(8, { timeout: 20000 })
  const displayed = await displayedOrder(page)
  expect(displayed).not.toEqual([...displayed].sort((left, right) => left - right))
  const first = page.getByTestId('media-cell').first().locator('img')
  await expect(first).toBeVisible({ timeout: 20000 })
  await expect.poll(() => first.evaluate(image => (image as HTMLImageElement).naturalWidth), { timeout: 20000 }).toBeGreaterThan(0)
})

test('reels reveal seeking from its strip and fade it again', async ({ page }) => {
  await page.goto('/?q=feedback&order=desc')
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Reels', exact: true }).click()
  const reels = page.getByRole('region', { name: 'Reels', exact: true })
  await expect(reels.locator('video')).toHaveCount(1)
  const strip = reels.getByTestId('reels-seek')
  const seek = reels.getByRole('slider', { name: 'Seek video', exact: true })
  await expect(seek).toBeEnabled()
  await expect(strip).toHaveAttribute('data-visible', 'false')
  await expect(strip).toHaveCSS('opacity', '0')

  const bounds = (await reels.locator('video').boundingBox())!
  // Above the mobile navigation, inside the strip that holds the seek control.
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height - 100)
  await expect(strip).toHaveAttribute('data-visible', 'true')
  await expect(strip).toHaveCSS('opacity', '1')
  await expect(strip).toHaveAttribute('data-visible', 'false', { timeout: 6000 })

  // Keyboard users reach the same control without the gesture.
  await seek.focus()
  await expect(strip).toHaveCSS('opacity', '1')
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await expect(seek).toHaveAttribute('aria-valuetext', /of 0:04/)
})

test('double tapping a reel likes it without toggling playback', async ({ page }) => {
  await page.goto('/?mediaType=video&preference=neutral')
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Reels', exact: true }).click()
  const reels = page.getByRole('region', { name: 'Reels', exact: true })
  await expect(reels.locator('video')).toHaveCount(1)
  await reels.getByRole('button', { name: 'Reels menu' }).click()
  await expect(reels.getByRole('button', { name: 'Like', exact: true })).toHaveAttribute('aria-pressed', 'false')

  const bounds = (await reels.locator('video').boundingBox())!
  // Clear of the centred play affordance, the control column and the seek strip.
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height * 0.35)
  await page.mouse.down(); await page.mouse.up()
  await page.mouse.down(); await page.mouse.up()
  await expect(reels.getByRole('button', { name: 'Unlike', exact: true })).toHaveAttribute('aria-pressed', 'true')
  // The like is persisted, not only reflected in the reels control.
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Collections', exact: true }).click()
  await page.getByRole('button', { name: 'Open favourites', exact: true }).click()
  await expect(page.getByTestId('media-cell').first()).toBeVisible()
})

test('reels keep their own filters when switching modes', async ({ page }) => {
  const navigation = page.getByRole('navigation', { name: 'Primary navigation' })
  await page.goto('/?libraryId=1&folderId=1')
  await navigation.getByRole('button', { name: 'Reels', exact: true }).click()
  const reels = page.getByRole('region', { name: 'Reels', exact: true })
  await reels.getByRole('button', { name: 'Reels menu' }).click()
  await reels.getByRole('button', { name: 'Filters', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Search and filters' })
  await sheet.getByLabel('Media type').selectOption('image')
  await sheet.getByLabel('Sort direction').selectOption('asc')
  await sheet.getByRole('button', { name: 'Apply filters' }).click()
  await expect(page).toHaveURL(/mediaType=image/)
  await expect(page).toHaveURL(/order=asc/)

  await navigation.getByRole('button', { name: 'Search', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search media' }).fill('photo')
  await page.getByRole('textbox', { name: 'Search media' }).press('Enter')
  await expect(page).toHaveURL(/q=photo/)
  await expect(page.getByTestId('media-cell').first()).toBeVisible()

  await navigation.getByRole('button', { name: 'Reels', exact: true }).click()
  await expect(page).toHaveURL(/mediaType=image/)
  await expect(page).toHaveURL(/order=asc/)
  await expect(page).not.toHaveURL(/q=photo/)
})
