import { expect, test } from 'vitest'
import i18n, { supportedLanguages, t } from './index'

test('English is the only supported language and is available synchronously', () => {
  expect(supportedLanguages).toEqual(['en'])
  expect(i18n.isInitialized).toBe(true)
  expect(t('appName')).toBe('Luma')
})

test('unsupported locales resolve to the bundled English catalog', async () => {
  await i18n.changeLanguage('fr')
  expect(i18n.resolvedLanguage).toBe('en')
  expect(t('appName')).toBe('Luma')
  await i18n.changeLanguage('en')
})
