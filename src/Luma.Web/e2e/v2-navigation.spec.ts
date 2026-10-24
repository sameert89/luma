import { test, expect } from '@playwright/test'
import { openHeaderSearch, switchExperience } from './helpers'

test('applications retain independent queries and an empty Flick always has an exit', async ({ page }) => {
  await page.route('**/api/media**', route =>
    route.fulfill({ json: { items: [], nextCursor: null, previousCursor: null } }),
  )
  await page.route('**/api/panels/sources', route =>
    route.fulfill({ json: { configured: true, locations: [{ libraryId: 1, relativePath: '', imageFolders: false }] } }),
  )
  await page.goto('/gallery/search?q=photos')
  await switchExperience(page, 'Flick')
  await expect(page).toHaveURL(/\/flick/)
  await expect(page).not.toHaveURL(/q=photos/)
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Switch application, Flick' })).toBeVisible()
  await switchExperience(page, 'Gallery')
  await expect(page).toHaveURL(/q=photos/)
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible()
  await switchExperience(page, 'Panels')
  await openHeaderSearch(page, 'Search comics')
  await page.getByRole('combobox', { name: 'Search comics' }).fill('moon')
  await page.getByRole('combobox', { name: 'Search comics' }).press('Enter')
  await expect(page).toHaveURL(/\/panels\?q=moon/)
  await page.reload()
  await openHeaderSearch(page, 'Search comics')
  await expect(page.getByRole('combobox', { name: 'Search comics' })).toHaveValue('moon')
  await switchExperience(page, 'Gallery')
  await expect(page).toHaveURL(/q=photos/)
})

test('Flick search, settings return and boot warning work without covering player controls', async ({ page }) => {
  await page.route('**/api/files/storage-status', route =>
    route.fulfill({
      json: {
        bootId: 'browser-warning-test',
        accessConfigured: false,
        libraries: [
          {
            libraryId: 1,
            name: 'Photos',
            configuredWritable: false,
            canWrite: false,
            warning: 'Read-only media: use a :rw mount to enable file management.',
          },
        ],
      },
    }),
  )
  await page.goto('/flick')
  const warning = page.getByRole('status').filter({ hasText: 'Your media is read-only' })
  await expect(warning).toBeVisible()
  await warning.getByRole('button', { name: 'Details' }).click()
  await expect(page).toHaveURL(/settings.*from=flick/)
  await expect(page.getByRole('checkbox', { name: 'Enable file management', exact: true })).toBeInViewport()
  await page.getByRole('button', { name: 'Back to Flick', exact: true }).click()
  await expect(page).toHaveURL(/\/flick/)
  await expect(warning).toHaveCount(0)
  await openHeaderSearch(page, 'Search media')
  await page.getByRole('combobox', { name: 'Search media' }).fill('clip')
  await page.getByRole('combobox', { name: 'Search media' }).press('Enter')
  await expect(page).toHaveURL(/q=clip/)
  const closeSearch = page.getByRole('button', { name: 'Close search', exact: true })
  if (await closeSearch.isVisible()) await closeSearch.click()
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Filters and sorting' })).toBeVisible()
})

test('Panels exposes discovery, browses folders and keeps reader tools in popups', async ({ page }) => {
  const comic = {
    id: 9,
    libraryId: 1,
    title: 'DBZ volume 1',
    series: 'Dragon Ball',
    author: '',
    description: '',
    format: 'zip',
    pageCount: 10,
    pageIndex: 2,
    state: 'reading',
    readingSeconds: 0,
    direction: 'ltr',
    settings: '{}',
    lastReadAt: null,
    favourite: false,
    coverUrl: null,
    coverPage: 0,
  }
  await page.route('**/api/panels/sources', route =>
    route.fulfill({
      json: {
        configured: true,
        locations: [
          {
            libraryId: 1,
            relativePath: 'Base',
            imageFolders: false,
            excludeFromGallery: true,
            coverUrls: ['/comic-cover-1.svg', '/comic-cover-2.svg', '/comic-cover-3.svg'],
          },
        ],
      },
    }),
  )
  await page.route('**/api/panels/continue-reading', route => route.fulfill({ json: [comic] }))
  await page.route('**/comic-cover-*.svg', route =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"/>',
    }),
  )
  await page.route('**/api/tasks', route =>
    route.fulfill({
      json: [
        {
          id: 'comic-1',
          kind: 'comics',
          state: 'running',
          createdAt: '2026-10-19',
          processed: 3,
          failed: 0,
          pending: 0,
        },
      ],
    }),
  )
  await page.route('**/api/panels/folders?**', route => {
    const path = new URL(route.request().url()).searchParams.get('path')
    return route.fulfill({
      json: {
        items:
          path === 'Base'
            ? [{ name: 'Manga', relativePath: 'Base/Manga' }]
            : path === 'Base/Manga'
              ? [{ name: 'DBZ', relativePath: 'Base/Manga/DBZ' }]
              : [],
        nextCursor: null,
      },
    })
  })
  await page.route('**/api/panels/comics?**', route =>
    route.fulfill({
      json: {
        items: new URL(route.request().url()).searchParams.get('path') === 'Base/Manga/DBZ' ? [comic] : [],
        nextCursor: null,
      },
    }),
  )
  await page.route('**/api/panels/comics/9', route => route.fulfill({ json: comic }))
  await page.route('**/api/panels/comics/9/progress', route => route.fulfill({ status: 204 }))
  await page.goto('/panels')
  await expect(page.getByText(/Looking through your comics… 3 checked/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Background jobs, running' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Continue reading' })).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Reading progress for DBZ volume 1' })).toHaveAttribute(
    'value',
    '3',
  )
  await expect(page.getByRole('button', { name: 'Open Base', exact: true }).locator('[data-cover]')).toHaveAttribute(
    'data-cover',
    'mosaic-3',
  )
  await page.getByRole('button', { name: 'Open Base', exact: true }).click()
  await page.getByRole('button', { name: 'Open Manga', exact: true }).click()
  await page.getByRole('button', { name: 'Open DBZ', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Comic locations', exact: true })).toHaveCount(1)
  await expect(page.getByText('Loading comics…', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Read DBZ volume 1' }).click()
  await expect(page.getByRole('button', { name: 'Background jobs, running' })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Page fit' })).toHaveCount(0)
  const counter = page.getByRole('button', { name: 'Go to page', exact: true })
  await expect(counter).toHaveText('3 / 10')
  const bounds = await counter.boundingBox()
  expect(bounds!.width).toBeLessThan(160)
  await page.getByRole('button', { name: 'Reader settings' }).click()
  await expect(page.getByRole('dialog', { name: 'Reader settings' })).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await counter.click()
  await expect(page.getByRole('dialog', { name: 'Go to page' })).toBeVisible()
  await page.getByRole('spinbutton', { name: 'Go to page' }).fill('8')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(counter).toHaveText('8 / 10')
})
