import type { Page } from '@playwright/test'

// Viewer navigation, details and view options live in the viewer's bottom menu, which
// stays open once opened. Opens it if needed and returns the requested action.
export async function viewerAction(page: Page, name: string) {
  const toggle = page.getByRole('button', { name: 'Viewer menu', exact: true })
  if (await toggle.isVisible()) await toggle.click()
  return page.getByRole('button', { name, exact: true })
}

// Gallery commands are grouped behind the current folder's or result set's action menu.
export async function galleryAction(page: Page, name: string) {
  const action = page.getByRole('button', { name, exact: true })
  if (await action.isVisible().catch(() => false)) return action
  const folder = page.getByRole('button', { name: /^Folder actions for / }).first()
  if (await folder.isVisible().catch(() => false)) await folder.click()
  else await page.getByRole('button', { name: 'Gallery actions', exact: true }).click()
  return page.getByRole('dialog').getByRole('button', { name, exact: true })
}
