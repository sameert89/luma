import { test, expect } from '@playwright/test'
import { switchExperience } from './helpers'

test('applications retain independent queries and an empty Flick always has an exit', async ({ page }) => {
  await page.route('**/api/media**', route =>
    route.fulfill({ json: { items: [], nextCursor: null, previousCursor: null } }),
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
  await page.getByRole('textbox', { name: 'Search comics' }).fill('moon')
  await expect(page).toHaveURL(/\/panels\?q=moon/)
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Search comics' })).toHaveValue('moon')
  await switchExperience(page, 'Gallery')
  await expect(page).toHaveURL(/q=photos/)
})
