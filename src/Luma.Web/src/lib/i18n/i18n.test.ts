import { expect, test } from 'vitest'
import i18n, { apiMessage, stateLabel, supportedLanguages, t } from './index'

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

test('messages interpolate values and select full singular and plural sentences', () => {
  expect(t('app:app.resultsFor', { value1: 'summer' })).toBe('Results for “summer”')
  expect(t('files:fileToolbar.operationsQueued', { count: 1, skipped: '' })).toBe(
    '1 operation queued. Check Background jobs for progress.',
  )
  expect(t('files:fileToolbar.operationsQueued', { count: 3, skipped: ' 2 skipped.' })).toBe(
    '3 operations queued. 2 skipped. Check Background jobs for progress.',
  )
  expect(t('uploads:uploadPicker.uploadsInQueue', { count: 0 })).toBe('0 uploads in queue')
  expect(t('uploads:uploadPicker.uploadsInQueue', { count: 1 })).toBe('1 upload in queue')
  expect(t('panels:comicCard.pages', { series: 'CBZ', count: 1 })).toBe('CBZ · 1 page')
})

test('state labels and known API titles use catalogs without losing unknown server detail', () => {
  expect(stateLabel('needsAttention')).toBe('Needs attention')
  expect(stateLabel('futureState')).toBe('futureState')
  expect(apiMessage('A tag name is required.')).toBe('Enter a tag name.')
  expect(apiMessage('Precise message from a future server.')).toBe('Precise message from a future server.')
})
