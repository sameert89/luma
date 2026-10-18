import { afterEach, expect, test } from 'vitest'
import { configureUiDefaults, readSetting } from './uiDefaults'
afterEach(() => {
  configureUiDefaults({})
  localStorage.clear()
})
test('deployment defaults are used only when the user has not saved an in-app choice', () => {
  configureUiDefaults({ 'luma-theme': 'forest', 'luma-video-autoplay': '1' })
  expect(readSetting('luma-theme')).toBe('forest')
  expect(localStorage.getItem('luma-theme')).toBeNull()
  localStorage.setItem('luma-theme', 'light')
  expect(readSetting('luma-theme')).toBe('light')
  expect(readSetting('luma-video-autoplay')).toBe('1')
})
