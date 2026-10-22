import { t } from '../../lib/i18n'

/** Newest first. English release highlights live alongside the other translation resources. */
export type Release = { version: string; date: string; headline: string; changes: string[] }

export const releases = t('releases:history', { returnObjects: true }) as Release[]
export const currentRelease = releases[0]
