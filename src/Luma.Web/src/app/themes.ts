/**
 * The themes Luma offers, as data rather than as part of a component: the build reads this list
 * to write one web manifest per theme, so an installed app's status bar and splash screen can
 * carry the colour the person chose instead of whichever one happened to be built in.
 *
 * `canvas` repeats the theme's `--color-canvas` from styles.css, which stays the source of truth
 * for everything the page itself paints. A test holds the two together.
 */
export type Theme =
  'obsidian' | 'light' | 'catppuccin' | 'crimson' | 'ember' | 'cinema' | 'midnight' | 'oled' | 'forest' | 'nord'

export type ThemeOption = { id: Theme; name: string; description: string; canvas: string }

export const themes: ThemeOption[] = [
  { id: 'obsidian', name: 'Dark', description: 'Soft dark surfaces and lavender accents', canvas: '#111319' },
  { id: 'light', name: 'White', description: 'Bright white surfaces and clear blue accents', canvas: '#f8fafc' },
  { id: 'catppuccin', name: 'Catppuccin', description: 'Muted midnight tones and pastel mauve', canvas: '#1e1e2e' },
  { id: 'ember', name: 'Orange & black', description: 'Deep black with vivid orange accents', canvas: '#050505' },
  { id: 'crimson', name: 'Red & white', description: 'Light white surfaces with rich red accents', canvas: '#fffafa' },
  {
    id: 'cinema',
    name: 'Cinema red',
    description: 'Netflix-inspired charcoal with vivid red accents',
    canvas: '#101010',
  },
  {
    id: 'midnight',
    name: 'Midnight blue',
    description: 'Prime Video-inspired navy with bright blue accents',
    canvas: '#080f19',
  },
  {
    id: 'oled',
    name: 'OLED black',
    description: 'Pure black, quiet gray surfaces and crisp white accents',
    canvas: '#000000',
  },
  { id: 'forest', name: 'Forest', description: 'Media-player charcoal with fresh green accents', canvas: '#0e1411' },
  { id: 'nord', name: 'Nord', description: 'Cool arctic greys with a frost-blue accent', canvas: '#2e3440' },
]

/** Where the build writes each theme's manifest, and where the page points at it. */
export const themeManifest = (theme: Theme) => `/manifest-${theme}.webmanifest`
