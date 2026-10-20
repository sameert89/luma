import { test, expect } from '@playwright/test'

test('file toolbar stays hidden until requested, keeps a cut clipboard across folders and queues paste', async ({
  page,
}) => {
  const posts: Record<string, unknown>[] = []
  await page.route('**/api/files/capabilities', route =>
    route.fulfill({ json: { accessConfigured: true, libraries: [{ libraryId: 1, writable: true }] } }),
  )
  await page.route('**/api/files/location?folderId=*', route =>
    route.fulfill({
      json: {
        libraryId: 1,
        relativePath: new URL(route.request().url()).searchParams.get('folderId') === '1' ? 'destination' : 'source',
      },
    }),
  )
  await page.route('**/api/files/clipboard', route =>
    route.fulfill({
      json: [
        {
          libraryId: 1,
          relativePath: 'source/photo.jpg',
          mediaId: route.request().postDataJSON().mediaIds[0],
          folderId: null,
        },
      ],
    }),
  )
  await page.route('**/api/files/operations', route => {
    posts.push(route.request().postDataJSON())
    return route.fulfill({ status: 202, json: { id: 'queued-file' } })
  })
  await page.goto('/?libraryId=1&folderId=2')
  await expect(page.getByTestId('media-cell').first()).toBeVisible()
  await expect(page.getByRole('group', { name: 'File actions' })).toHaveCount(0)
  await page.getByRole('button', { name: 'File management', exact: true }).click()
  await expect(page.getByRole('group', { name: 'File actions' })).toBeVisible()
  await page.getByRole('button', { name: 'Select media', exact: true }).click()
  await page
    .getByRole('checkbox', { name: /^Select / })
    .first()
    .check()
  await page.getByRole('button', { name: 'Cut', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Paste (1)' })).toBeEnabled()
  await page.getByRole('navigation', { name: 'Folder breadcrumb' }).getByRole('button').first().click()
  await expect(page.getByRole('button', { name: 'Open Trips', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Paste (1)' }).click()
  await expect(page.getByRole('status').filter({ hasText: '1 operation queued' })).toBeVisible()
  expect(posts).toEqual([
    { libraryId: 1, kind: 'move', source: 'source/photo.jpg', destination: 'destination/photo.jpg' },
  ])
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  const upload = page.getByRole('dialog', { name: 'Upload', exact: true })
  await expect(upload.getByText('Drop files or folders here', { exact: true })).toBeVisible()
  await expect(upload.getByRole('button', { name: 'Choose files', exact: true })).toBeVisible()
  await expect(upload.getByRole('button', { name: 'Choose folder', exact: true })).toBeVisible()
  await page.screenshot({ path: `test-results/file-upload-${test.info().project.name}.png` })
})

test('closing a navigated viewer reveals the last photo, including beyond the Gallery window', async ({ page }) => {
  await page.goto('/?libraryId=1&folderId=1&mediaType=image&sort=name&order=asc')
  const first = page
    .getByTestId('media-cell')
    .first()
    .getByRole('button', { name: /^Open / })
  await first.waitFor({ state: 'visible' })
  const firstId = await first.getAttribute('data-media-id')
  const far = await (await page.request.get('/api/media/303')).json()
  await page.route(`**/api/media/${firstId}/neighbors?**`, route =>
    route.fulfill({ json: { previous: null, next: far, pageCursor: null } }),
  )
  await first.click()
  await page.getByRole('button', { name: 'Viewer menu', exact: true }).click()
  await page.getByRole('button', { name: 'Next item', exact: true }).click()
  await expect(page.getByRole('dialog', { name: far.fileName, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close viewer', exact: true }).click()
  const current = page.locator(`button[data-media-id="${far.id}"]`)
  await expect(current).toBeInViewport()
  await expect(current).toBeFocused()
  await expect.poll(() => page.getByTestId('gallery-scroll').evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  expect(Number(await page.getByTestId('gallery-grid').getAttribute('data-retained-items'))).toBeLessThanOrEqual(120)
})

test('viewer Delete queues recycling and returns without leaving a stale viewer history entry', async ({ page }) => {
  const posts: Record<string, unknown>[] = []
  await page.route('**/api/files/capabilities', route =>
    route.fulfill({ json: { accessConfigured: true, libraries: [{ libraryId: 1, writable: true }] } }),
  )
  await page.route('**/api/files/items', route => {
    posts.push(route.request().postDataJSON())
    return route.fulfill({ status: 202, json: { id: 'queued-viewer-delete' } })
  })
  await page.goto('/?libraryId=1&folderId=1&mediaType=image&sort=name&order=asc')
  const first = page
    .getByTestId('media-cell')
    .first()
    .getByRole('button', { name: /^Open / })
  await first.waitFor({ state: 'visible' })
  const id = Number(await first.getAttribute('data-media-id'))
  await first.click()
  await page.getByRole('button', { name: 'Viewer menu', exact: true }).click()
  await page.getByRole('button', { name: 'Delete file', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'Delete file', exact: true })
  await expect(confirmation.getByRole('checkbox')).not.toBeChecked()
  expect(posts).toHaveLength(0)
  await confirmation.getByRole('button', { name: 'Move to recycle bin', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => new URL(location.href).searchParams.has('media'))).toBe(false)
  await expect.poll(() => page.evaluate(() => !!history.state?.lumaModal)).toBe(false)
  expect(posts).toEqual([{ libraryId: 1, mediaId: id, kind: 'recycle' }])
})
