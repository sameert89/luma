import type { Filters } from '../../features/browse/api'
export type ExperienceView = { filters: Filters; section: string }
const key = (experience: string) => `luma-${experience}-view-v2`
export function readExperience(experience: string, fallback: ExperienceView): ExperienceView {
  try {
    const value = JSON.parse(localStorage.getItem(key(experience)) ?? 'null') as ExperienceView | null
    return value && value.filters && typeof value.filters === 'object' && typeof value.section === 'string'
      ? value
      : fallback
  } catch {
    return fallback
  }
}
export function saveExperience(experience: string, view: ExperienceView) {
  try {
    localStorage.setItem(key(experience), JSON.stringify(view))
  } catch {
    /* State still lives in the current URL. */
  }
}
export function sectionPath(section: string) {
  if (section === 'reels') return '/flick'
  if (section === 'panels') return '/panels'
  if (section === 'settings') return '/settings'
  if (section === 'help') return '/help'
  return section === 'library' ? '/gallery' : `/gallery/${section}`
}
