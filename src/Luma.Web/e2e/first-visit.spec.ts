import { test, expect } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] } })

test('first visit shows release notes once and returns to usable navigation', async ({ page }) => {
  await page.goto('/gallery')
  const notes = page.getByRole('dialog', { name: /^What’s new in Luma/ })
  await expect(notes).toBeVisible()
  await notes.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(notes).toBeHidden()
  await expect(page.getByRole('button', { name: 'Switch application, Gallery' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Your libraries' })).toBeVisible()
  await expect(notes).toHaveCount(0)
})
