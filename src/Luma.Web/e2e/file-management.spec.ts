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
