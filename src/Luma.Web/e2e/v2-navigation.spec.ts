import { test, expect } from '@playwright/test'
import { switchExperience } from './helpers'

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
  await page.getByRole('combobox', { name: 'Search comics' }).fill('moon')
  await page.getByRole('combobox', { name: 'Search comics' }).press('Enter')
  await expect(page).toHaveURL(/\/panels\?q=moon/)
  await page.reload()
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
  const warning = page.getByRole('status').filter({ hasText: 'Read-only media' })
  await expect(warning).toBeVisible()
  await warning.getByRole('button', { name: 'Details' }).click()
  await expect(page).toHaveURL(/settings.*from=flick/)
  await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeInViewport()
  await page.getByRole('button', { name: 'Back to Flick', exact: true }).click()
  await expect(page).toHaveURL(/\/flick/)
  await expect(warning).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Search media' }).fill('clip')
  await page.getByRole('combobox', { name: 'Search media' }).press('Enter')
  await expect(page).toHaveURL(/q=clip/)
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Filters and sorting' })).toBeVisible()
})
