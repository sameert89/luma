import { test, expect } from '@playwright/test'
import { viewerAction } from './helpers'

test('requested themes persist across cached gallery search viewer and photo reels', async ({ page }) => {
  for (const theme of ['obsidian', 'light', 'catppuccin', 'ember', 'crimson']) {
    await page.goto('/')
    await page.evaluate(value => localStorage.setItem('luma-theme', value), theme)
    await page.goto('/?q=photo&mediaType=image')
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await expect(page.getByTestId('media-cell').first()).toBeVisible()
    await page.getByTestId('media-cell').first().click()
    const viewer = page.getByRole('dialog')
    await expect(viewer.getByRole('img')).toBeVisible()
    await expect.poll(() => viewer.getByRole('img').evaluate(image => image.naturalWidth)).toBeGreaterThan(0)
    await viewer.getByRole('button', { name: 'Close viewer', exact: true }).click()
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Reels', exact: true }).click()
    const reels = page.getByRole('region', { name: 'Reels', exact: true })
    await reels.getByRole('button', { name: 'Reels menu' }).click()
    await reels.getByRole('button', { name: 'Filters', exact: true }).click()
    await page.getByRole('combobox', { name: 'Media type', exact: true }).selectOption('image')
    await page.getByRole('button', { name: 'Apply filters' }).click()
    await expect(reels.getByRole('img')).toBeVisible()
    await expect.poll(() => reels.getByRole('img').evaluate(image => image.naturalWidth)).toBeGreaterThan(0)
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  }
})

test('pages through direct child folders with a bounded card count', async ({ page }) => {
  await page.route('**/api/folders?*', route => {
    const second = new URL(route.request().url()).searchParams.get('cursor') === 'second'
    return route.fulfill({ json: { current: { id: 1, libraryId: 1, name: 'Sample library' }, ancestors: [], items: Array.from({ length: second ? 3 : 48 }, (_, index) => ({ id: index + (second ? 50 : 2), libraryId: 1, parentId: 1, name: `Album ${index + (second ? 49 : 1)}` })), nextCursor: second ? null : 'second', previousCursor: second ? 'first' : null } })
  })
  await page.goto('/?libraryId=1&folderId=1')
  const folders = page.getByRole('region', { name: 'Folders', exact: true })
  // Each card is opened by its cover button, labelled with the folder name.
  const cards = folders.getByRole('button', { name: /^Open Album \d+$/ })
  await expect(cards).toHaveCount(48)
  await folders.getByRole('button', { name: 'Next folders' }).click()
  await expect(cards).toHaveCount(3)
  await expect(folders.getByRole('button', { name: 'Open Album 51', exact: true })).toBeVisible()
  await folders.getByRole('button', { name: 'Previous folders' }).click()
  await expect(cards).toHaveCount(48)
})

test('scopes a search and exposes all advanced sort and filter choices on mobile and desktop', async ({ page }) => {
  await page.goto('/?q=photo')
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  await page.getByRole('combobox', { name: 'Library', exact: true }).selectOption('1')
  await page.getByRole('combobox', { name: 'Sort by' }).selectOption('name')
  await page.getByRole('combobox', { name: 'Group by' }).selectOption('type')
  await page.getByRole('combobox', { name: 'Match tags' }).selectOption('any')
  await page.getByRole('combobox', { name: 'Availability', exact: true }).selectOption('all')
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await expect(page).toHaveURL(/q=photo/)
  await expect(page).toHaveURL(/libraryId=1/)
  await expect(page).toHaveURL(/sort=name/)
  await expect(page).toHaveURL(/groupBy=type/)
  await expect(page.getByTestId('gallery-grid').getByRole('heading', { name: 'Photos', exact: true })).toHaveCount(1)
  await expect(page.getByTestId('gallery-grid')).toHaveAttribute('data-retained-items', /\d+/)
})

test('reels honour photos and mixed-media selections and navigate the active query', async ({ page }) => {
  await page.goto('/?q=photo')
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Reels', exact: true }).click()
  const reels = page.getByRole('region', { name: 'Reels', exact: true })
  await reels.getByRole('button', { name: 'Reels menu' }).click()
  await reels.getByRole('button', { name: 'Filters', exact: true }).click()
  await page.getByRole('combobox', { name: 'Media type', exact: true }).selectOption('image')
  await page.getByRole('combobox', { name: 'Sort by' }).selectOption('shuffle')
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await expect(reels.getByRole('img')).toHaveCount(1)
  await expect(reels.locator('video')).toHaveCount(0)
  await expect(page).toHaveURL(/mediaType=image/)
  const original = await reels.getByRole('img').getAttribute('alt')
  // Applying filters remounts Reels (a fresh query), so the menu collapses again.
  await reels.getByRole('button', { name: 'Reels menu' }).click()
  await reels.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(reels.getByRole('img')).not.toHaveAttribute('alt', original!)
  await reels.getByRole('button', { name: 'Filters', exact: true }).click()
  await page.getByRole('combobox', { name: 'Media type', exact: true }).selectOption('')
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await expect(page).not.toHaveURL(/mediaType=/)
  await expect(reels.locator('img,video')).toHaveCount(1)
})

test('collections provide tags and favourites, with tag rename and delete', async ({ page }, testInfo) => {
  // A tag this test creates and only this test uses: the fixture is shared with other
  // specs and projects, so renaming or deleting a seeded tag would corrupt their data.
  const original = `Typo-${testInfo.project.name}-${Date.now()}`
  await page.goto('/?libraryId=1&folderId=1')
  await page.getByTestId('media-cell').first().click()
  await (await viewerAction(page, 'Media details')).click()
  const details = page.getByRole('dialog', { name: 'Media details' })
  await details.getByRole('combobox', { name: 'Tag name' }).fill(original)
  await details.getByRole('button', { name: 'Add tag' }).click()
  await expect(details.getByRole('button', { name: `Remove tag ${original}`, exact: true })).toBeVisible()
  await page.goBack()
  await expect(page.locator('[role=dialog]')).toHaveCount(1)
  await page.goBack()
  await expect(page.locator('[role=dialog]')).toHaveCount(0)

  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Collections', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Favourites' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Tags', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Vacation', exact: true }).click()
  await expect(page).toHaveURL(/tag=Vacation/)
  await expect(page.getByTestId('media-cell').first()).toBeVisible()

  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Collections', exact: true }).click()
  const fixed = `Fixed-${testInfo.project.name}-${Date.now()}`
  await page.getByRole('button', { name: `Manage tag ${original}`, exact: true }).click()
  const manage = page.getByRole('dialog', { name: `Manage "${original}"` })
  await manage.getByLabel('Tag name').fill(fixed)
  await manage.getByRole('button', { name: 'Save name' }).click()
  await expect(manage).toBeHidden()
  await expect(page.getByRole('button', { name: fixed, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: original, exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: `Manage tag ${fixed}`, exact: true }).click()
  await page.getByRole('dialog', { name: `Manage "${fixed}"` }).getByRole('button', { name: 'Delete tag' }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByRole('button', { name: fixed, exact: true })).toHaveCount(0)
})

test('custom covers can be selected from the viewer details', async ({ page }) => {
  await page.goto('/?mediaType=image&limit=60')
  await page.getByTestId('media-cell').first().click()
  await (await viewerAction(page, 'Media details')).click()
  const details = page.getByRole('dialog', { name: 'Media details' })
  try {
    await details.getByRole('button', { name: 'Use as library cover' }).click()
    await expect(details.getByRole('status')).toContainText('Cover saved')
    await details.getByRole('button', { name: 'Use as folder cover' }).click()
    await expect(details.getByRole('status')).toContainText('Cover saved')
  } finally {
    // Covers are chosen explicitly in the UI; the API reset keeps later tests on automatic covers.
    for (const folder of [1, 2]) await page.request.put(`/api/folders/${folder}/cover`, { data: { mediaId: null } })
  }
})

test('direct shuffle links create one persistent seed for pagination and viewer navigation', async ({ page }) => {
  await page.goto('/?sort=shuffle&mediaType=image')
  await expect(page).toHaveURL(/seed=/)
  const seed = new URL(page.url()).searchParams.get('seed')
  await expect(page.getByTestId('media-cell').first()).toBeVisible()
  await page.getByTestId('media-cell').first().click()
  const viewer = page.getByRole('dialog')
  const next = await viewerAction(page, 'Next item')
  await expect(next).toBeEnabled()
  await next.click()
  expect(new URL(page.url()).searchParams.get('seed')).toBe(seed)
  await expect(viewer.getByRole('alert')).toHaveCount(0)
})
