let defaults: Record<string, string> = {}
export function configureUiDefaults(value: Record<string, string>) {
  defaults = value
}
export function readSetting(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? defaults[key] ?? null
  } catch {
    return defaults[key] ?? null
  }
}
