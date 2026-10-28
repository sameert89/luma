import { test, expect } from '@playwright/test'

test('Panels exposes sorting, starts in reading order and remembers changes on reload', async ({ page }) => {
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
  await expect(sort).toHaveValue('title')
  await expect(direction).toHaveValue('asc')
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Comic 1', 'Comic 2', 'Comic 120'])
  await direction.selectOption('desc')
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Comic 120', 'Comic 2', 'Comic 1'])
  await sort.selectOption('modified')
  await page.reload()
  await expect(sort).toHaveValue('modified')
  await expect(direction).toHaveValue('desc')
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Comic 120', 'Comic 2', 'Comic 1'])
})
