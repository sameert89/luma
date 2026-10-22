import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import common from './locales/en/common.json'

/** Bundled English works at startup, offline and in standalone Help without locale requests. */
export const resources = { en: { common } } as const
export const supportedLanguages = ['en'] as const

void i18next.use(initReactI18next).init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: [...supportedLanguages],
  defaultNS: 'common',
  initAsync: false,
  interpolation: { escapeValue: false }, // React escapes translated text and interpolation values.
  returnNull: false,
})

export const t = i18next.t.bind(i18next)
export default i18next
