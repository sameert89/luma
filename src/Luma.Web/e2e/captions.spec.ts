import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdir, readdir, writeFile, access, rm } from 'node:fs/promises'
import path from 'node:path'
import { openFixtureDatabase } from './helpers'

const fixture = path.resolve('../../.local/browser-fixture-v2')
let captionFolder: string | undefined
test.afterEach(async ({ page }) => {
  await page.close()
  if (!captionFolder) return
  const db = openFixtureDatabase(path.join(fixture, 'fixture.db'))
  try {
    // Keep scan/cache foreign keys intact while removing this clip from later browse queries.
    db.prepare(
      "UPDATE Media SET Availability='missing' WHERE FolderId IN (SELECT Id FROM Folders WHERE RelativePath=?)",
    ).run(captionFolder)
  } finally {
    db.close()
    await rm(path.join(fixture, 'media', captionFolder), { recursive: true, force: true })
    captionFolder = undefined
  }
})
test('CC is opt-in, displays matching SRT and keeps generated files in cache', async ({ page, request }, testInfo) => {
  const relative = `Captions-${testInfo.project.name}-${Date.now()}`
  captionFolder = relative
  const folder = path.join(fixture, 'media', relative)
  await mkdir(folder, { recursive: true })
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=128x96:r=4',
    '-t',
    '2',
    '-c:v',
    'libx264',
    '-threads',
    '1',
    '-pix_fmt',
    'yuv420p',
    path.join(folder, 'movie.mp4'),
  ])
  await writeFile(path.join(folder, 'movie.srt'), '1\n00:00:00,000 --> 00:00:02,000\nHello from cached SRT\n')
  const db = openFixtureDatabase(path.join(fixture, 'fixture.db'))
  let folderId: number
  try {
    folderId = Number(
      db
        .prepare(
          'INSERT INTO Folders(LibraryId,ParentId,RelativePath,PathKey,LastSeenScanId) VALUES(1,1,?,?,1) RETURNING Id',
        )
        .get(relative, relative)!.Id,
    )
    db.prepare('INSERT INTO FolderAncestry VALUES(1,?)').run(folderId)
    db.prepare('INSERT INTO FolderAncestry VALUES(?,?)').run(folderId, folderId)
  } finally {
    db.close()
  }
  expect((await request.post(`/api/folders/${folderId}/index`)).ok()).toBe(true)
  let id = 0
  await expect
    .poll(async () => {
      const result = await request.get(`/api/media?libraryId=1&folderId=${folderId}`)
      const body = await result.json()
      id = body.items[0]?.id ?? 0
      return id
    })
    .toBeGreaterThan(0)
  const captionRequests: string[] = []
  page.on('request', req => {
    if (req.url().includes('/captions')) captionRequests.push(req.url())
  })
  await page.goto(`/gallery?libraryId=1&folderId=${folderId}&media=${id}`)
  const video = page.locator('video')
  await expect(video).toBeVisible()
  const cc = page.getByRole('button', { name: 'Captions', exact: true })
  await expect(cc).toHaveAttribute('aria-pressed', 'false')
  expect(captionRequests).toHaveLength(0)
  await cc.click()
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) =>
        [...element.textTracks].some(track => track.mode === 'showing' && track.cues?.length === 1),
      ),
    )
    .toBe(true)
  expect(captionRequests.some(url => url.includes('/captions/sidecar?'))).toBe(true)
  await page.screenshot({ path: `test-results/captions-${testInfo.project.name}.png`, animations: 'disabled' })
  await cc.click()
  await expect(video.locator('track')).toHaveCount(0)
  expect((await readdir(folder)).sort()).toEqual(['movie.mp4', 'movie.srt'])
  const verify = openFixtureDatabase(path.join(fixture, 'fixture.db'))
  try {
    const cached = verify
      .prepare("SELECT RelativePath,RawRelativePath FROM CaptionCache WHERE MediaId=? AND TrackId='sidecar'")
      .get(id)!
    expect(cached.RelativePath).toMatch(/^captions[/\\]/)
    expect(cached.RawRelativePath).toMatch(/^captions[/\\]/)
    await access(path.join(fixture, 'cache', String(cached.RelativePath)))
    await access(path.join(fixture, 'cache', String(cached.RawRelativePath)))
  } finally {
    verify.close()
  }
})
