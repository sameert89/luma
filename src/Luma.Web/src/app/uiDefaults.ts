let defaults: Record<string, string> = {}
export function configureUiDefaults(value: Record<string, string>) {
  const booleans = new Set([
    'luma-video-autoplay',
    'luma-viewer-fill',
    'luma-reels-fill',
    'luma-show-filters',
    'luma-reels-show-filters',
  ])
  defaults = Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      booleans.has(key) && /^(true|false)$/i.test(entry) ? (entry.toLowerCase() === 'true' ? '1' : '0') : entry,
    ]),
  )
}
export function readSetting(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? defaults[key] ?? null
  } catch {
    return defaults[key] ?? null
  }
}
