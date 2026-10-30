import { switchExperience, openFixtureDatabase } from './helpers'
import { test, expect } from '@playwright/test'
import { viewerAction } from './helpers'
import { execFileSync } from 'node:child_process'
import { copyFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const fixture = path.resolve('../../.local/browser-fixture-v2')
test.beforeAll(async () => {
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=320x240:r=24',
    '-t',
    '4',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-threads',
    '1',
    '-movflags',
    '+faststart',
    path.join(fixture, 'media/stage6-video.mp4'),
  ])
  await writeFile(path.join(fixture, 'media/stage6-broken.mkv'), 'unsupported fixture')
  await copyFile(path.join(fixture, 'cache/palette-1.jpg'), path.join(fixture, 'media/stage6-image.jpg'))
  const db = openFixtureDatabase(path.join(fixture, 'fixture.db'))
  try {
    for (const [id, name, type, mime, extension, date] of [
      [1499, 'stage6-image.jpg', 'image', 'image/jpeg', '.jpg', '03'],
      [1495, 'stage6-video.mp4', 'video', 'video/mp4', '.mp4', '02'],
      [1490, 'stage6-broken.mkv', 'video', 'video/x-matroska', '.mkv', '01'],
    ] as const) {
      db.prepare(
        'UPDATE Media SET FolderId=2,FileName=?,RelativePath=?,PathKey=?,MediaType=?,MimeType=?,Extension=?,ModifiedAt=?,EffectiveDate=? WHERE Id=?',
      ).run(name, name, name, type, mime, extension, `2026-04-${date}T00:00:00Z`, `2026-04-${date}T00:00:00Z`, id)
    }
  } finally {
    db.close()
  }
})

test('viewer zoom, rotation, horizontal swipe and desktop motion', async ({ page }) => {
  await page.goto('/?q=stage6')
  await page.getByTestId('media-cell').first().click()
  const viewer = page.getByRole('dialog')
  await expect(viewer).toBeVisible()
  await expect(page.locator('.motion-media')).toHaveCSS('animation-name', 'luma-media-in')
  await page.keyboard.press('+')
  await (await viewerAction(page, 'View options')).click()
  const options = page.getByRole('dialog', { name: 'View options' })
  await expect(options.getByRole('button', { name: 'Reset zoom' })).toHaveText('125%')
  await options.getByRole('button', { name: 'Rotate', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(options).toHaveCount(0)
  await expect(viewer.getByRole('img')).toBeVisible()
  await expect
    .poll(() => viewer.getByRole('img').evaluate(img => img.parentElement!.style.transform))
    .toContain('rotate(90deg)')
  await (await viewerAction(page, 'View options')).click()
  await options.getByRole('button', { name: 'Reset zoom' }).click()
  await page.keyboard.press('Escape')
  await expect(viewer.getByRole('button', { name: 'Next item' })).toBeEnabled()
  const bounds = await viewer.getByRole('img').boundingBox()
  await page.mouse.move(bounds!.x + bounds!.width * 0.7, bounds!.y + bounds!.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(bounds!.x + bounds!.width * 0.3, bounds!.y + bounds!.height * 0.5, { steps: 8 })
  await page.mouse.up()
  await expect(viewer.locator('video')).toHaveCount(1)
  await page.screenshot({ path: `test-results/stage6-video-${test.info().project.name}.png` })
})

test('native video plays, seeks, changes speed and offers external access on failure', async ({ page }) => {
  await page.goto('/?q=stage6-video')
  await page.getByTestId('media-cell').first().click()
  const video = page.locator('video')
  const viewerMarker = await page.evaluate(() => history.state?.lumaModal)
  await expect.poll(() => video.evaluate(v => v.readyState)).toBeGreaterThanOrEqual(2)
  // Upright phones leave volume to the hardware keys, so the slider is desktop-only.
  if (test.info().project.name === 'desktop') {
    const volume = page.getByRole('slider', { name: 'Volume', exact: true })
    await volume.focus()
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => video.evaluate(v => v.volume)).toBe(0.05)
  }
  await page.getByRole('button', { name: 'Mute', exact: true }).click()
  await expect.poll(() => video.evaluate(v => v.muted)).toBe(true)
  await page.getByRole('button', { name: 'Unmute', exact: true }).click()
  await expect.poll(() => video.evaluate(v => v.muted)).toBe(false)
  await page.getByRole('slider', { name: 'Seek', exact: true }).focus()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => video.evaluate(v => v.currentTime)).toBeGreaterThanOrEqual(0.1)
  await video.evaluate(v => v.play())
  await expect.poll(() => video.evaluate(v => v.currentTime)).toBeGreaterThan(0)
  await video.evaluate(v => {
    v.currentTime = 2
  })
  await expect.poll(() => video.evaluate(v => v.currentTime)).toBeGreaterThanOrEqual(2)
  if (test.info().project.name === 'mobile') {
    await (await viewerAction(page, 'View options')).click()
    await page.getByRole('dialog', { name: 'View options' }).getByLabel('Playback speed').selectOption('1.5')
    await page.keyboard.press('Escape')
    await expect.poll(() => page.evaluate(() => history.state?.lumaModal)).toBe(viewerMarker)
  } else await page.getByRole('button', { name: 'Playback speed' }).click()
  expect(await video.evaluate(v => v.playbackRate)).toBe(1.5)
  await page.getByRole('button', { name: 'Close viewer', exact: true }).click()
  await expect(video).toHaveCount(0)
  // Modal disposal leaves its history entry asynchronously; settle it before a full navigation.
  await expect(page).not.toHaveURL(/media=/)
  await page.goto('/?q=stage6-broken')
  await page.getByRole('button', { name: 'Open stage6-broken.mkv', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'stage6-broken.mkv', exact: true })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('copy its stream URL')
  await (await viewerAction(page, 'View options')).click()
  await expect(page.getByRole('button', { name: 'Copy stream URL' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Download' })).toHaveAttribute('href', /download=true/)
  await expect(page.getByRole('link', { name: 'Open original' })).toHaveCount(0)
})

test('scoped reels bound media, auto-scroll, stop inactive playback and restore Gallery filters', async ({ page }) => {
  await page.goto('/?q=stage6&order=desc')
  await expect(page.getByTestId('media-cell')).toHaveCount(3)
  await page.goto('/flick?q=stage6&order=desc&mediaType=motion')
  const reels = page.getByRole('region', { name: 'Flick', exact: true })
  await expect(reels.locator('[data-reel-state="current"] video')).toHaveCount(1)
  await expect(page).toHaveURL(/mediaType=motion/)
  await expect(page).toHaveURL(/q=stage6/)
  await expect(page.getByRole('button', { name: 'Switch application, Flick', exact: true })).toBeVisible()
  await reels.getByRole('button', { name: 'Flick menu' }).click()
  await reels.getByRole('button', { name: 'Auto-scroll' }).click()
  await expect(reels.getByRole('button', { name: 'Auto-scroll' })).toHaveAttribute('aria-pressed', 'true')
  const old = await reels.locator('[data-reel-state="current"] video').elementHandle()
  await expect.poll(() => old!.evaluate(v => v.paused)).toBe(false)
  const seek = reels.getByRole('slider', { name: 'Seek video', exact: true })
  await seek.focus()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await expect(seek).toHaveAttribute('aria-valuetext', /of 0:04/)
  await reels.getByRole('button', { name: 'Auto-scroll' }).click()
  await reels.getByRole('button', { name: 'Next', exact: true }).click()
  await expect.poll(() => old!.evaluate(v => v.paused)).toBe(true)
  await expect(reels.locator('[data-reel-state="current"] video')).toHaveCount(1)
  await expect(reels.getByRole('status')).toContainText('copy its stream URL')
  expect(
    await reels.locator('[data-reel-state="current"] img, [data-reel-state="current"] video').count(),
  ).toBeLessThanOrEqual(1)
  expect(await reels.locator('link[rel=preload]').count()).toBeLessThanOrEqual(1)
  await page.screenshot({ path: `test-results/stage6-reels-${test.info().project.name}.png` })
  await switchExperience(page, 'Gallery')
  await expect.poll(() => old!.evaluate(v => !v.getAttribute('src'))).toBe(true)
  await expect(page.getByTestId('media-cell')).toHaveCount(3)
  await expect(page).toHaveURL(/q=stage6/)
  await expect(page).not.toHaveURL(/mediaType=motion/)
})

test('Back closes nested details then viewer then returns to libraries', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Sample library', exact: true }).click()
  await page.getByTestId('media-cell').first().click()
  await (await viewerAction(page, 'Media details')).click()
  await expect(page.locator('[role=dialog]')).toHaveCount(2)
  await page.goBack()
  await expect(page.locator('[role=dialog]')).toHaveCount(1)
  await page.goBack()
  await expect(page.locator('[role=dialog]')).toHaveCount(0)
  await expect(page.getByTestId('media-cell').first()).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Your libraries' })).toBeVisible()
})

test('mobile pinch zoom and pan retain swipe navigation for images and videos', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Physical touch interaction')
  await page.goto('/?q=stage6')
  await page.getByTestId('media-cell').first().click()
  const viewer = page.getByRole('dialog')
  const bounds = await viewer.getByRole('img').boundingBox()
  let x = bounds!.x + bounds!.width / 2
  let y = bounds!.y + bounds!.height / 2
  const viewerMarker = await page.evaluate(() => history.state?.lumaModal)
  async function closeOptions() {
    // Radix registers the nested dismissable layer after rendering its contents.
    // Wait until it owns interaction before sending Escape to that layer.
    await expect(page.getByRole('dialog', { name: 'View options' })).toHaveCSS('pointer-events', 'auto')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'View options' })).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => history.state?.lumaModal)).toBe(viewerMarker)
    const current = (await viewer.getByRole('img').boundingBox())!
    x = current.x + current.width / 2
    y = current.y + current.height / 2
  }
  const session = await page.context().newCDPSession(page)
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: x - 30, y, id: 0 },
      { x: x + 30, y, id: 1 },
    ],
  })
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: x - 70, y, id: 0 },
      { x: x + 70, y, id: 1 },
    ],
  })
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await (await viewerAction(page, 'View options')).click()
  const options = page.getByRole('dialog', { name: 'View options' })
  await expect(options.getByRole('button', { name: 'Reset zoom' })).not.toHaveText('100%')
  await closeOptions()
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 0 }] })
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 40, y: y + 40, id: 0 }] })
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect
    .poll(() => viewer.getByRole('img').evaluate(img => img.parentElement!.style.transform))
    .not.toContain('translate(0px, 0px)')
  await (await viewerAction(page, 'View options')).click()
  await options.getByRole('button', { name: 'Reset zoom' }).click()
  await closeOptions()
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x + 80, y, id: 0 }] })
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 80, y, id: 0 }] })
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(viewer.locator('video')).toHaveAttribute('src', '/api/media/1495/original')
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x + 80, y, id: 0 }] })
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 80, y, id: 0 }] })
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(viewer.locator('video')).toHaveAttribute('src', '/api/media/1490/original')
  await viewer.getByRole('button', { name: 'Close viewer', exact: true }).click()
  await expect(viewer).toBeHidden()
  await expect(page).not.toHaveURL(/media=/)
  await page.goto('/flick?q=stage6&mediaType=motion&order=desc')
  const reels = page.getByRole('region', { name: 'Flick', exact: true })
  await expect(reels.locator('[data-reel-state="current"] video')).toHaveAttribute('src', '/api/media/1495/original')
  const reelBounds = await reels.locator('[data-reel-state="current"] video').boundingBox()
  const reelX = reelBounds!.x + reelBounds!.width / 2
  const reelY = reelBounds!.y + reelBounds!.height / 2
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: reelX, y: reelY + 80, id: 0 }],
  })
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: reelX, y: reelY - 80, id: 0 }],
  })
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(reels.locator('[data-reel-state="current"] video')).toHaveAttribute('src', '/api/media/1490/original')
})

test('Flick promotes the same buffered video element without posters or loading overlays', async ({ page }) => {
  // Reuse the valid fixture bytes for the second clip, preserving normal Range requests.
  await page.route('**/api/media/1490/original', async route => {
    const response = await route.fetch({ url: 'http://127.0.0.1:4173/api/media/1495/original' })
    await route.fulfill({ response })
  })
  await page.goto('/flick?q=stage6&order=desc&mediaType=video')
  const reels = page.getByRole('region', { name: 'Flick', exact: true })
  const current = reels.locator('[data-reel-state="current"] video')
  await expect(current).toHaveAttribute('src', '/api/media/1495/original')
  await expect.poll(() => current.evaluate(video => !video.paused)).toBe(true)
  const prepared = reels.locator('[data-reel-id="1490"] video')
  await expect(prepared).toHaveAttribute('src', '/api/media/1490/original')
  await expect.poll(() => prepared.evaluate(video => video.readyState)).toBeGreaterThanOrEqual(3)
  await expect(prepared).toHaveJSProperty('paused', true)
  const samePlayer = await prepared.elementHandle()
  await reels.getByRole('button', { name: 'Flick menu', exact: true }).click()
  await reels.getByRole('button', { name: 'Next', exact: true }).click()
  await expect.poll(() => current.evaluate((video, expected) => video === expected, samePlayer)).toBe(true)
  await expect.poll(() => current.evaluate(video => !video.paused && video.currentTime > 0)).toBe(true)
  await expect(reels.locator('video[poster]')).toHaveCount(0)
  await expect(reels.getByTestId('buffering')).toHaveCount(0)
  expect(await reels.locator('video').count()).toBeLessThanOrEqual(3)
})

test('Flick follows a held touch between clips and reverses before release', async ({ page }) => {
  await page.route('**/api/media/1490/original', async route => {
    const response = await route.fetch({ url: 'http://127.0.0.1:4173/api/media/1495/original' })
    await route.fulfill({ response })
  })
  await page.goto('/flick?q=stage6&order=desc&mediaType=video')
  const reels = page.getByRole('region', { name: 'Flick', exact: true })
  const viewport = reels.getByTestId('reels-scroll')
  const first = reels.locator('[data-reel-id="1495"]')
  const second = reels.locator('[data-reel-id="1490"]')
  await expect(first).toHaveAttribute('data-reel-state', 'current')
  await expect.poll(() => second.locator('video').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(3)
  const original = await first.locator('video').elementHandle()
  const bounds = (await viewport.boundingBox())!
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  const x = bounds.x + bounds.width * 0.5 // The centre keeps native navigation; the right quarter adjusts volume.
  const y = bounds.y + bounds.height * 0.7
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 0 }] })
  for (let step = 1; step <= 5; step++) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y - bounds.height * 0.08 * step, id: 0 }],
    })
    await page.evaluate(() => new Promise(requestAnimationFrame))
  }
  await page.waitForTimeout(260) // hold still long enough to exercise the scroll-end fallback
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(bounds.height * 0.15)
  await expect(first).toHaveAttribute('data-reel-state', 'current')
  // Both actual video panels are on screen while the finger is held between them.
  const a = (await first.boundingBox())!
  const b = (await second.boundingBox())!
  expect(a.y).toBeLessThan(bounds.y)
  expect(a.y + a.height).toBeGreaterThan(bounds.y)
  expect(b.y).toBeLessThan(bounds.y + bounds.height)
  for (let step = 4; step >= 0; step--) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y - bounds.height * 0.08 * step, id: 0 }],
    })
    await page.evaluate(() => new Promise(requestAnimationFrame))
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(first).toHaveAttribute('data-reel-state', 'current')
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeLessThan(2)
  await expect.poll(() => first.locator('video').evaluate((video, expected) => video === expected, original)).toBe(true)
  await expect(reels.locator('video[poster]')).toHaveCount(0)
  expect(await reels.locator('video').count()).toBeLessThanOrEqual(3)
})

test('fullscreen controls cover the bottom edge and fade after pointer activation without pausing', async ({
  page,
}) => {
  await page.goto('/?q=stage6-video')
  await page.getByTestId('media-cell').first().click()
  const viewer = page.getByRole('dialog')
  const video = viewer.locator('video')
  await video.evaluate(async player => {
    player.loop = true
    await player.play()
  })
  await viewer.getByRole('button', { name: 'Fullscreen', exact: true }).click()
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true)
  const bar = viewer.getByRole('button', { name: 'Exit fullscreen', exact: true }).locator('..')
  const coverage = await bar.evaluate(element => ({
    bottom: element.getBoundingClientRect().bottom,
    stageBottom: element.parentElement!.getBoundingClientRect().bottom,
  }))
  expect(coverage.bottom).toBeGreaterThanOrEqual(coverage.stageBottom)
  // Leaving the pointer/focus on the fullscreen button must not pin the bar open.
  await expect(bar).toHaveCSS('opacity', '0', { timeout: 6000 })
  await expect(video).toHaveJSProperty('paused', false)
  const bounds = (await video.boundingBox())!
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await expect(bar).toHaveCSS('opacity', '1')
  await expect(bar).toHaveCSS('opacity', '0', { timeout: 6000 })
  await expect(video).toHaveJSProperty('paused', false)
})

test('holding 2x replaces the top bar in portrait and landscape and restores it on release', async ({ page }) => {
  for (const viewport of [
    { width: 400, height: 800 },
    { width: 900, height: 500 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/?q=stage6-video')
    await page.getByTestId('media-cell').first().click()
    const viewer = page.getByRole('dialog')
    const video = viewer.locator('video')
    await video.evaluate(async player => {
      player.loop = true
      await player.play()
    })
    const bounds = (await video.boundingBox())!
    const header = viewer.locator('header')
    await expect(header).toBeVisible()
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height * 0.4)
    await page.mouse.down()
    const boost = viewer.getByText('2×', { exact: true })
    await expect(boost).toBeVisible()
    await expect(header).toBeHidden()
    expect((await boost.boundingBox())!.y - bounds.y).toBeLessThan(40)
    await page.mouse.up()
    await expect(boost).toHaveCount(0)
    await expect(header).toBeVisible()
    await expect(viewer.getByRole('button', { name: 'Close viewer' })).toBeVisible()
  }
})

test('video arbitrary zoom preserves Fit and Fill, and mobile pinch stays on the touched region', async ({
  page,
}, info) => {
  await page.goto('/?q=stage6-video')
  await page.getByTestId('media-cell').first().click()
  const player = page.locator('video')
  await expect.poll(() => player.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2)
  const originalFit = await player.evaluate(element => getComputedStyle(element).objectFit)
  const viewerMarker = await page.evaluate(() => history.state?.lumaModal)
  await (await viewerAction(page, 'View options')).click()
  const options = page.getByRole('dialog', { name: 'View options' })
  await expect(options).toHaveCSS('pointer-events', 'auto')
  const slider = options.getByRole('slider', { name: 'Zoom', exact: true })
  await slider.focus()
  await slider.press('Home')
  await slider.press('ArrowRight')
  await expect(options.getByRole('button', { name: 'Reset zoom' })).toHaveText('101%')
  // Check rendered geometry, not just the inline transform: the entry animation
  // previously occupied the transform property on the video element itself.
  await expect
    .poll(() => player.evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).a))
    .toBeCloseTo(1.01)
  await expect(player).toHaveCSS('object-fit', originalFit)
  await options.getByRole('button', { name: /^(Fit|Fill)$/ }).click()
  await expect(options.getByRole('button', { name: 'Reset zoom' })).toHaveText('100%')
  await expect(player).toHaveCSS('object-fit', originalFit === 'contain' ? 'cover' : 'contain')
  await options.getByRole('button', { name: 'Close', exact: true }).click()
  await expect.poll(() => page.evaluate(() => history.state?.lumaModal)).toBe(viewerMarker)
  if (info.project.name === 'mobile') {
    const bounds = (await player.boundingBox())!
    const x = bounds.x + bounds.width * 0.7,
      y = bounds.y + bounds.height * 0.35
    const volume = await player.evaluate(element => element.volume)
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
    await expect
      .poll(() => player.evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).a))
      .toBeCloseTo(2)
    await expect
      .poll(async () => {
        const zoomed = (await player.boundingBox())!
        return Math.hypot(zoomed.x + zoomed.width * 0.7 - x, zoomed.y + zoomed.height * 0.35 - y)
      })
      .toBeLessThan(1)
    expect(await player.evaluate(element => element.volume)).toBe(volume)
  }
  await page.screenshot({ path: info.outputPath('video-zoom.png'), animations: 'disabled' })
})

test('Flick reserves the whole right quarter for touch volume without scrolling or seeking', async ({ page }) => {
  await page.goto('/flick?q=stage6&order=desc&mediaType=video')
  const reels = page.getByRole('region', { name: 'Flick', exact: true })
  const viewport = reels.getByTestId('reels-scroll')
  const current = reels.locator('[data-reel-state="current"]')
  const originalId = await current.getAttribute('data-reel-id')
  const player = current.locator('video')
  await expect.poll(() => player.evaluate(video => video.readyState)).toBeGreaterThanOrEqual(3)
  const lane = current.locator('[data-volume-lane]')
  await expect(lane).toBeVisible()
  const bounds = (await lane.boundingBox())!
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  const beforeScroll = await viewport.evaluate(element => element.scrollTop)
  const swipe = async (fraction: number, down: boolean) => {
    const x = bounds.x + bounds.width * fraction
    const y = bounds.y + bounds.height * (down ? 0.3 : 0.7)
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 0 }] })
    for (let step = 1; step <= 6; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y + (down ? 1 : -1) * bounds.height * 0.04 * step, id: 0 }],
      })
      await page.evaluate(() => new Promise(requestAnimationFrame))
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  // Test both the inner boundary (~76% of player width) and the outer edge.
  for (const fraction of [0.05, 0.5, 0.95]) {
    const before = await player.evaluate(video => video.volume)
    await swipe(fraction, true)
    await expect.poll(() => player.evaluate(video => video.volume)).toBeLessThan(before)
    await expect.poll(() => viewport.evaluate((element, before) => Math.abs(element.scrollTop - before), beforeScroll)).toBeLessThan(2)
    await expect(current).toHaveAttribute('data-reel-id', originalId!)
    await expect(reels.getByRole('status').filter({ hasText: /Volume/ })).toBeVisible()
    await swipe(fraction, false)
    await expect.poll(() => player.evaluate(video => video.volume)).toBeGreaterThan(before - 0.05)
  }
})
