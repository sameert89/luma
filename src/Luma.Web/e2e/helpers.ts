import type { Page } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'

// Direct fixture writes execute the same SQLite triggers as server writes.
export function openFixtureDatabase(path: string) {
  const db = new DatabaseSync(path)
  const key = (value: string) => value.normalize('NFC').toUpperCase().normalize('NFC')
  const folderName = (value: string) => value.slice(value.lastIndexOf('/') + 1)
  db.function('luma_key', { deterministic: true }, key)
  db.function('luma_reverse', { deterministic: true }, (value: string) => [...value].reverse().join(''))
  db.function(
    'luma_ticks',
    { deterministic: true },
    (value: string) => BigInt(Date.parse(value)) * 10000n + 621355968000000000n,
  )
  db.function('luma_folder_key', { deterministic: true }, (value: string) => key(folderName(value)))
  db.function('luma_sort_key', { deterministic: true }, (value: string) =>
    folderName(value)
      .normalize('NFD')
      .replace(/\p{Mn}/gu, '')
      .normalize('NFC')
      .toUpperCase()
      .replace(/\d+/g, digits => {
        const significant = digits.replace(/^0+/, '') || '0'
        return String(Math.min(significant.length, 999)).padStart(3, '0') + significant
      }),
  )
  db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON')
  return db
}

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

export async function switchExperience(page: Page, name: 'Gallery' | 'Flick' | 'Panels') {
  await page.getByRole('button', { name: /^Switch application,/ }).click()
  await page.getByRole('dialog', { name: 'Luma applications' }).getByRole('button', { name, exact: true }).click()
}

export async function openHeaderSearch(page: Page, name = 'Search media') {
  const field = page.getByRole('combobox', { name })
  if (!(await field.isVisible())) await page.getByRole('button', { name: 'Open search', exact: true }).click()
  return field
}
