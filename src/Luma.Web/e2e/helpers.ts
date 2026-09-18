import type { Page } from '@playwright/test'

// Viewer navigation, details and view options live in the viewer's bottom menu, which
// stays open once opened. Opens it if needed and returns the requested action.
export async function viewerAction(page: Page, name: string) {
  const toggle = page.getByRole('button', { name: 'Viewer menu', exact: true })
  if (await toggle.isVisible()) await toggle.click()
  return page.getByRole('button', { name, exact: true })
}
