import { test, expect } from '@playwright/test'

test('live server connection and keyboard-accessible shell', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('status')).toHaveText('Luma is connected and ready.')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  const about = page.getByRole('button', { name: 'About Luma' })
  await expect(about).toBeFocused()
  const focus = await about.evaluate(element => ({
    style: getComputedStyle(element).outlineStyle,
    width: getComputedStyle(element).outlineWidth,
  }))
  expect(focus.style).not.toBe('none')
  expect(parseFloat(focus.width)).toBeGreaterThan(0)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Your media, at home' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Close' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(about).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(errors).toEqual([])
  await page.screenshot({ path: `test-results/shell-${test.info().project.name}.png`, fullPage: true })
})
