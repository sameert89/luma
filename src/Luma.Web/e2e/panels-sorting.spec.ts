import { test, expect } from '@playwright/test'

test('Panels exposes sorting, starts in reading order and remembers changes on reload', async ({ page }, info) => {
  await page.route('**/api/panels/sources', route =>
    route.fulfill({ json: { configured: true, locations: [{ libraryId: 1, relativePath: '', imageFolders: false }] } }),
  )
  await page.route('**/api/panels/folders?**', route => route.fulfill({ json: { items: [], nextCursor: null } }))
  await page.route('**/api/panels/comics?**', route => {
    const query = new URL(route.request().url()).searchParams
    const numbers = query.get('order') === 'desc' ? [120, 2, 1] : [1, 2, 120]
    return route.fulfill({
      json: {
        items: numbers.map(number => ({
          id: number,
          libraryId: 1,
          title: `Comic ${number}`,
          series: '',
          author: '',
          description: '',
          format: 'zip',
          pageCount: 2,
          pageIndex: 0,
          state: 'unread',
          readingSeconds: 0,
          direction: 'ltr',
          settings: '{}',
          lastReadAt: null,
          favourite: false,
          coverUrl: null,
          coverPage: 0,
        })),
        nextCursor: null,
      },
    })
  })
  await page.goto('/panels?libraryId=1&path=')
  const sort = page.getByRole('combobox', { name: 'Sort by', exact: true })
  const direction = page.getByRole('combobox', { name: 'Sort direction', exact: true })
  await expect(sort).toHaveCount(0)
  await expect(direction).toHaveCount(0)
  const title = page.getByRole('heading', { name: 'Comic library', exact: true })
  const locations = page.getByRole('button', { name: 'Comic locations', exact: true })
  const a = (await title.boundingBox())!,
    b = (await locations.boundingBox())!
  expect(Math.abs(a.y + a.height / 2 - b.y - b.height / 2)).toBeLessThan(5)
  await page.getByRole('button', { name: 'Filters', exact: true }).click({ trial: true })
  await page.screenshot({ path: info.outputPath('panels-header.png'), animations: 'disabled' })
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Comic 1', 'Comic 2', 'Comic 120'])
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Filters and sorting' })
  await expect(dialog).toBeVisible()
  await expect(sort).toHaveValue('title')
  await expect(direction).toHaveValue('asc')
  await expect(dialog.getByRole('combobox', { name: 'Reading status' })).toBeVisible()
  await page.screenshot({ path: info.outputPath('panels-filters.png'), animations: 'disabled' })
  await direction.selectOption('desc')
  await sort.selectOption('modified')
  await expect(dialog).toBeVisible()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('luma-panels-sort')!).order)).toBe('asc')
  await dialog.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => history.state?.lumaModal)).toBeFalsy()
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Comic 120', 'Comic 2', 'Comic 1'])
  await page.reload()
  await expect(sort).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Comic 120', 'Comic 2', 'Comic 1'])
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  await expect(sort).toHaveValue('modified')
  await expect(direction).toHaveValue('desc')
  await sort.selectOption('added')
  await page.goBack()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/panels\?libraryId=1&path=$/)
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  await expect(sort).toHaveValue('modified')
  await dialog.getByRole('button', { name: 'Reset filters', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Comic 1', 'Comic 2', 'Comic 120'])
})
