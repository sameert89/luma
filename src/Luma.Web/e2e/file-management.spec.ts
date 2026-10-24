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
  await page.route('**/api/files/items', route => {
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
  await expect(page.getByRole('status').filter({ hasText: 'Added 1 task' })).toBeVisible()
  expect(posts).toEqual([
    { libraryId: 1, kind: 'move', mediaId: expect.any(Number), destination: 'destination/photo.jpg' },
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

test('viewer Delete queues recycling and advances in the same player', async ({ page }) => {
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
  const neighbors = await (
    await page.request.get(`/api/media/${id}/neighbors?libraryId=1&folderId=1&mediaType=image&sort=name&order=asc`)
  ).json()
  await first.click()
  const player = await page.locator('[data-motion=viewer]').elementHandle()
  await page.getByRole('button', { name: 'Viewer menu', exact: true }).click()
  await page.getByRole('button', { name: 'Delete file', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'Delete file', exact: true })
  await expect(confirmation.getByRole('checkbox')).not.toBeChecked()
  expect(posts).toHaveLength(0)
  await confirmation.getByRole('button', { name: 'Move to recycle bin', exact: true }).click()
  await expect(page.getByRole('dialog', { name: neighbors.next.fileName, exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  expect(await player!.evaluate(element => element.isConnected)).toBe(true)
  expect(await page.evaluate(() => !!history.state?.lumaModal)).toBe(true)
  expect(posts).toEqual([{ libraryId: 1, mediaId: id, kind: 'recycle' }])
})

test('file management stays available in search and tag results and Rename queues from toolbar and viewer', async ({
  page,
}) => {
  const posts: Record<string, unknown>[] = []
  await page.route('**/api/files/capabilities', route =>
    route.fulfill({ json: { accessConfigured: true, libraries: [{ libraryId: 1, writable: true }] } }),
  )
  await page.route('**/api/files/clipboard', route =>
    route.fulfill({
      json: route
        .request()
        .postDataJSON()
        .mediaIds.map((mediaId: number) => ({ libraryId: 1, relativePath: 'photo.jpg', mediaId, folderId: null })),
    }),
  )
  await page.route('**/api/files/items', route => {
    posts.push(route.request().postDataJSON())
    return route.fulfill({ status: 202, json: { id: 'queued-rename' } })
  })
  for (const query of ['q=photo', 'tag=Vacation']) {
    await page.goto(`/?${query}`)
    await page.getByRole('button', { name: 'File management', exact: true }).click()
    await expect(page.getByRole('group', { name: 'File actions' })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Select media', exact: true }).click()
  await page
    .getByRole('checkbox', { name: /^Select / })
    .first()
    .check()
  await page.getByRole('button', { name: 'Rename', exact: true }).click()
  const rename = page.getByRole('dialog', { name: 'Rename', exact: true })
  await expect(rename.getByRole('textbox', { name: 'Name' })).toHaveValue('photo.jpg')
  await rename.getByRole('textbox', { name: 'Name' }).fill('renamed.jpg')
  await rename.getByRole('button', { name: 'Rename', exact: true }).click()
  await expect(rename).toBeHidden()
  await page
    .getByTestId('media-cell')
    .first()
    .getByRole('button', { name: /^Open / })
    .click()
  await page.getByRole('button', { name: 'Viewer menu', exact: true }).click()
  await page.getByRole('button', { name: 'Rename file', exact: true }).click()
  await expect(rename.getByRole('textbox', { name: 'Name' })).toHaveValue('photo.jpg')
  await rename.getByRole('textbox', { name: 'Name' }).fill('viewer-renamed.jpg')
  await rename.getByRole('button', { name: 'Rename', exact: true }).click()
  await expect(rename).toBeHidden()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  expect(posts.map(post => [post.kind, post.destination])).toEqual([
    ['move', 'renamed.jpg'],
    ['move', 'viewer-renamed.jpg'],
  ])
})

test('Flick menu deletion advances, falls back and empties without reopening queued reels', async ({ page }) => {
  const posts: Record<string, unknown>[] = []
  const items = await Promise.all([5, 10, 15].map(async id => (await page.request.get(`/api/media/${id}`)).json()))
  await page.route('**/api/files/capabilities', route =>
    route.fulfill({ json: { accessConfigured: true, libraries: [{ libraryId: 1, writable: true }] } }),
  )
  await page.route('**/api/media/*/neighbors?**', route => {
    const id = Number(new URL(route.request().url()).pathname.split('/').at(-2))
    const index = items.findIndex(item => item.id === id)
    return route.fulfill({ json: { previous: items[index - 1] ?? null, next: items[index + 1] ?? null } })
  })
  await page.route('**/api/files/items', route => {
    posts.push(route.request().postDataJSON())
    return route.fulfill({ status: 202, json: { id: 'queued-flick-delete' } })
  })
  await page.goto('/flick?view=reels&libraryId=1&mediaType=video&sort=name&order=asc&media=10')
  await expect(page.getByLabel(items[1].fileName, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Flick menu', exact: true }).click()
  const flick = page.getByRole('region', { name: 'Flick', exact: true })
  await expect(flick.getByRole('button', { name: 'Filters', exact: true })).toHaveCount(0)
  const stage = await flick.elementHandle()
  for (const next of [items[2], items[0]]) {
    await page.getByRole('button', { name: 'Delete file', exact: true }).click()
    const confirmation = page.getByRole('dialog', { name: 'Delete file', exact: true })
    await expect(confirmation.getByRole('checkbox')).not.toBeChecked()
    await confirmation.getByRole('button', { name: 'Move to recycle bin', exact: true }).click()
    await expect(page.getByLabel(next.fileName, { exact: true })).toBeVisible()
    expect(await stage!.evaluate(element => element.isConnected)).toBe(true)
  }
  await page.getByRole('button', { name: 'Delete file', exact: true }).click()
  await page.getByRole('button', { name: 'Move to recycle bin', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'No reels to show', exact: true })).toBeVisible()
  expect(posts.map(post => post.mediaId)).toEqual([10, 15, 5])
  await expect.poll(() => page.evaluate(() => !!history.state?.lumaModal)).toBe(false)
})

for (const choice of ['Replace', 'Skip'] as const) {
  test(`upload conflict ${choice.toLowerCase()} applies to the batch after closing the upload window`, async ({
    page,
  }) => {
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const requests: Record<string, unknown>[] = []
    await page.route('**/api/files/capabilities', route =>
      route.fulfill({ json: { accessConfigured: true, libraries: [{ libraryId: 1, writable: true }] } }),
    )
    await page.route('**/api/files/location?folderId=*', route =>
      route.fulfill({ json: { libraryId: 1, relativePath: '' } }),
    )
    await page.route('**/api/files/uploads', async route => {
      const body = route.request().postDataJSON()
      requests.push(body)
      if (!body.replaceExisting) {
        await gate
        return route.fulfill({
          status: 409,
          contentType: 'application/problem+json',
          json: { code: 'destination_exists', title: 'Already exists', traceId: 'test' },
        })
      }
      return route.fulfill({ json: { id: body.requestId, state: 'waitingForClient', committedOffset: 0 } })
    })
    await page.route('**/api/files/uploads/*/finalize*', route =>
      route.fulfill({ json: { id: 'session', state: 'finalizing', committedOffset: 0, operationId: 'publication' } }),
    )
    await page.route('**/api/files/operations/publication', route =>
      route.fulfill({ json: { id: 'publication', state: 'completed' } }),
    )
    await page.goto('/?libraryId=1&folderId=1')
    await page.getByRole('button', { name: 'File management', exact: true }).click()
    await page.getByRole('button', { name: 'Upload', exact: true }).click()
    const upload = page.getByRole('dialog', { name: 'Upload', exact: true })
    await upload.getByLabel('Choose upload files', { exact: true }).setInputFiles([
      { name: 'existing-a.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(0) },
      { name: 'existing-b.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(0) },
    ])
    await expect.poll(() => requests.length).toBe(2)
    await upload.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(upload).toBeHidden()
    release()
    const conflict = page.getByRole('dialog', { name: 'This name is already taken', exact: true })
    await expect(conflict).toBeVisible()
    await conflict.getByRole('checkbox', { name: 'Use this choice for all remaining conflicts' }).check()
    await conflict.getByRole('button', { name: choice, exact: true }).click()
    await expect(conflict).toBeHidden()
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('luma-upload-sessions-v1') ?? '[]').length))
      .toBe(0)
    expect(requests.filter(request => request.replaceExisting).length).toBe(choice === 'Replace' ? 2 : 0)
    await expect.poll(() => page.evaluate(() => !!history.state?.lumaModal)).toBe(false)
  })
}

for (const [kind, choice] of [
  ['Cut', 'Replace'],
  ['Copy', 'Skip'],
] as const) {
  test(`paste from ${kind.toLowerCase()} supports ${choice.toLowerCase()} for all destination conflicts`, async ({
    page,
  }) => {
    const requests: Record<string, unknown>[] = []
    await page.route('**/api/files/capabilities', route =>
      route.fulfill({ json: { accessConfigured: true, libraries: [{ libraryId: 1, writable: true }] } }),
    )
    await page.route('**/api/files/location?folderId=*', route =>
      route.fulfill({ json: { libraryId: 1, relativePath: '' } }),
    )
    await page.route('**/api/files/clipboard', route =>
      route.fulfill({
        json: route
          .request()
          .postDataJSON()
          .mediaIds.map((mediaId: number, index: number) => ({
            libraryId: 1,
            mediaId,
            folderId: null,
            relativePath: `source/photo-${index}.jpg`,
          })),
      }),
    )
    await page.route('**/api/files/items', route => {
      const body = route.request().postDataJSON()
      requests.push(body)
      return body.replaceExisting
        ? route.fulfill({ status: 202, json: { id: 'queued' } })
        : route.fulfill({
            status: 409,
            contentType: 'application/problem+json',
            json: { code: 'destination_exists', title: 'Already exists', traceId: 'test' },
          })
    })
    await page.goto('/?libraryId=1&folderId=1')
    await page.getByRole('button', { name: 'File management', exact: true }).click()
    await page.getByRole('button', { name: 'Select media', exact: true }).click()
    const cells = page.getByTestId('media-cell')
    await cells.nth(0).getByRole('checkbox').check()
    await cells.nth(1).getByRole('checkbox').check()
    await page.getByRole('button', { name: kind, exact: true }).click()
    await page.getByRole('button', { name: 'Paste (2)', exact: true }).click()
    const conflict = page.getByRole('dialog', { name: 'This name is already taken', exact: true })
    await conflict.getByRole('checkbox', { name: 'Use this choice for all remaining conflicts' }).check()
    await conflict.getByRole('button', { name: choice, exact: true }).click()
    await expect(conflict).toBeHidden()
    await expect(
      page.getByRole('status').filter({ hasText: choice === 'Replace' ? 'Added 2 tasks' : '2 skipped' }),
    ).toBeVisible()
    expect(requests.filter(request => request.replaceExisting).length).toBe(choice === 'Replace' ? 2 : 0)
  })
}
