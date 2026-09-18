import { test, expect } from '@playwright/test'
import { viewerAction } from './helpers'

test('serves an installable manifest, icons, favicon and service worker', async ({ page, request }) => {
  await page.goto('/')
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  const manifest = await (await request.get(href!)).json()
  expect(manifest.display).toBe('standalone')
  expect(manifest.icons.some((icon: { purpose: string }) => icon.purpose === 'maskable')).toBe(true)
  for (const icon of manifest.icons as { src: string }[]) expect((await request.get(icon.src)).ok()).toBe(true)
  const favicon = await request.get('/favicon.ico')
  expect(favicon.ok()).toBe(true)
  expect(favicon.headers()['content-type']).toContain('image')
  const svg = await page.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute('href')
  expect((await request.get(svg!)).ok()).toBe(true)
  expect((await request.get('/sw.js')).ok()).toBe(true)
})

test('folders can be hidden from every view and shown again from settings', async ({ page }) => {
  const navigation = page.getByRole('navigation', { name: 'Primary navigation' })
  try {
    await page.goto('/?q=photo-0000020')
    await expect(page.getByTestId('media-cell')).toHaveCount(1)
    await page.goto('/?libraryId=1&folderId=1')
    await page.getByRole('button', { name: 'Folder actions for Trips' }).click()
    await page.getByRole('button', { name: 'Hide folder' }).click()
    await page.getByRole('dialog', { name: 'Hide folder' }).getByRole('button', { name: 'Hide folder' }).click()
    await expect(page.getByRole('button', { name: 'Open Trips' })).toHaveCount(0)
    await page.goto('/?q=photo-0000020')
    await expect(page.getByText('No media to show')).toBeVisible()

    await navigation.getByRole('button', { name: 'Settings', exact: true }).click()
    const hidden = page.getByRole('region', { name: 'Hidden folders' })
    await hidden.getByRole('button', { name: 'Show Trips' }).click()
    await expect(hidden.getByText('No folders are hidden.')).toBeVisible()
    await page.goto('/?q=photo-0000020')
    await expect(page.getByTestId('media-cell')).toHaveCount(1)
  } finally {
    await page.request.put('/api/folders/2/hidden', { data: { hidden: false } })
  }
})

test('reels keep rating and the menu within thumb reach and loop by default', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Reels', exact: true }).click()
  await expect(page).toHaveURL(/mediaType=motion/)
  const reels = page.getByRole('region', { name: 'Reels', exact: true })
  await expect(reels.locator('video')).toHaveJSProperty('loop', true)
  const like = reels.getByRole('button', { name: 'Like', exact: true })
  const dislike = reels.getByRole('button', { name: 'Dislike', exact: true })
  const menu = reels.getByRole('button', { name: 'Reels menu' })
  await expect(like).toBeVisible()
  await expect(dislike).toBeVisible()
  const viewport = page.viewportSize()!
  const [likeBox, dislikeBox, menuBox] = [await like.boundingBox(), await dislike.boundingBox(), await menu.boundingBox()]
  expect(menuBox!.x + menuBox!.width).toBeGreaterThan(viewport.width * 0.8)
  expect(menuBox!.y).toBeGreaterThan(viewport.height * 0.5)
  // Dislike sits directly beside Like on the same row.
  expect(Math.abs(dislikeBox!.y - likeBox!.y)).toBeLessThan(2)
  expect(dislikeBox!.x).toBeGreaterThan(likeBox!.x)
  await dislike.click()
  await expect(dislike).toHaveAttribute('aria-pressed', 'true')
  await dislike.click()
  await expect(dislike).toHaveAttribute('aria-pressed', 'false')
  await menu.click()
  await expect(reels.getByRole('button', { name: 'Filters', exact: true })).toBeInViewport()
})

test('video controls stack on upright phones and stay on one row elsewhere', async ({ page }, testInfo) => {
  await page.goto('/?mediaType=video')
  await page.getByTestId('media-cell').first().click()
  const viewer = page.getByRole('dialog')
  const seek = viewer.getByRole('slider', { name: 'Seek', exact: true })
  const play = viewer.getByRole('button', { name: 'Play', exact: true })
  const [seekBox, playBox] = [await seek.boundingBox(), await play.boundingBox()]
  if (testInfo.project.name === 'mobile') {
    expect(seekBox!.width).toBeGreaterThan(page.viewportSize()!.width * 0.85)
    expect(seekBox!.y + seekBox!.height).toBeLessThanOrEqual(playBox!.y + 1)
    await expect(viewer.getByRole('slider', { name: 'Volume', exact: true })).toBeHidden()
  } else {
    expect(Math.abs((seekBox!.y + seekBox!.height / 2) - (playBox!.y + playBox!.height / 2))).toBeLessThan(4)
    await expect(viewer.getByRole('slider', { name: 'Volume', exact: true })).toBeVisible()
  }
  // One action row for photos and videos: rating beside the menu, navigation inside it.
  const menu = viewer.getByRole('button', { name: 'Viewer menu', exact: true })
  const [likeBox, menuBox] = [await viewer.getByRole('button', { name: 'Like', exact: true }).boundingBox(), await menu.boundingBox()]
  expect(Math.abs(likeBox!.y - menuBox!.y)).toBeLessThan(2)
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(playBox!.y)
  await expect(await viewerAction(page, 'Watch on Reels')).toBeVisible()
  await expect(viewer.getByRole('button', { name: 'Next item', exact: true }).locator('svg')).toHaveClass(/lucide-chevron-right/)
})

test('fullscreen offers a visible exit and slideshows advance on their own', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Element fullscreen and pointer idling are desktop interactions')
  await page.addInitScript(() => localStorage.setItem('luma-slideshow-seconds', '3'))
  await page.goto('/?mediaType=image&sort=name&order=asc')
  await page.getByRole('button', { name: 'Start slideshow' }).click()
  const viewer = page.getByRole('dialog')
  await expect(viewer.getByRole('button', { name: 'Slideshow' })).toHaveAttribute('aria-pressed', 'true')
  // Fixture names repeat, so compare the image address rather than its name.
  const first = await viewer.getByRole('img').getAttribute('src')
  await expect(viewer.getByRole('img')).not.toHaveAttribute('src', first!, { timeout: 8000 })
  // A running slideshow hides its chrome once the pointer rests; moving it brings it back.
  const toggle = viewer.getByRole('button', { name: 'Slideshow' })
  const box = (await toggle.boundingBox())!
  await page.mouse.move(box.x - 40, box.y + 40)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')

  await (await viewerAction(page, 'View options')).click()
  await page.getByRole('dialog', { name: 'View options' }).getByRole('button', { name: 'Fullscreen', exact: true }).click()
  const exit = viewer.getByRole('button', { name: 'Exit fullscreen' })
  await expect(exit).toBeVisible()
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true)
  await exit.click()
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false)
  await expect(exit).toHaveCount(0)
})
