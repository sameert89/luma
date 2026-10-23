import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import common from './locales/en/common.json' with { type: 'json' }
import app from './locales/en/app.json' with { type: 'json' }
import browse from './locales/en/browse.json' with { type: 'json' }
import files from './locales/en/files.json' with { type: 'json' }
import help from './locales/en/help.json' with { type: 'json' }
import panels from './locales/en/panels.json' with { type: 'json' }
import status from './locales/en/status.json' with { type: 'json' }
import tags from './locales/en/tags.json' with { type: 'json' }
import ui from './locales/en/ui.json' with { type: 'json' }
import uploads from './locales/en/uploads.json' with { type: 'json' }
import api from './locales/en/api.json' with { type: 'json' }
import releases from './locales/en/releases.json' with { type: 'json' }
import apiTitles from './api-titles.json' with { type: 'json' }

/** Bundled English works at startup, offline and in standalone Help without locale requests. */
export const resources = {
  en: { common, app, browse, files, help, panels, status, tags, ui, uploads, api, releases },
} as const
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

/** Preserve unknown future states while localizing every known display label. */
export function stateLabel(state: string): string {
  return Object.hasOwn(common.states, state) ? t(`common:states.${state}`) : state
}

// Match the server's original titles, independently of edits to the displayed copy.
// Shared error codes are ambiguous; unknown titles retain their server-provided detail.
const apiKeys = new Map(Object.entries(apiTitles).map(([key, title]) => [title, key]))
export function apiMessage(title: string): string {
  const key = apiKeys.get(title)
  return key ? t(`api:${key}`) : title
}
