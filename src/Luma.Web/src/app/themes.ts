import { t } from '../lib/i18n/index'
/**
 * The themes Luma offers, as data rather than as part of a component: the build reads this list
 * to write one web manifest per theme, so an installed app's status bar and splash screen can
 * carry the colour the person chose instead of whichever one happened to be built in.
 *
 * `canvas` repeats the theme's `--color-canvas` from styles.css, which stays the source of truth
 * for everything the page itself paints. A test holds the two together.
 */
export type Theme =
  | 'obsidian'
  | 'light'
  | 'catppuccin'
  | 'crimson'
  | 'ember'
  | 'cinema'
  | 'midnight'
  | 'oled'
  | 'forest'
  | 'nord'
  | 'sakura'
  | 'celestial'
  | 'manga'

export type ThemeOption = { id: Theme; name: string; description: string; canvas: string }

export const themes: ThemeOption[] = [
  {
    id: 'obsidian',
    name: t('app:themes.dark'),
    description: t('app:themes.softDarkSurfacesAndLavenderAccents'),
    canvas: '#111319',
  },
  {
    id: 'light',
    name: t('app:themes.white'),
    description: t('app:themes.brightWhiteSurfacesAndClearBlueAccents'),
    canvas: '#f8fafc',
  },
  {
    id: 'catppuccin',
    name: t('app:themes.catppuccin'),
    description: t('app:themes.mutedMidnightTonesAndPastelMauve'),
    canvas: '#1e1e2e',
  },
  {
    id: 'ember',
    name: t('app:themes.orangeBlack'),
    description: t('app:themes.deepBlackWithVividOrangeAccents'),
    canvas: '#050505',
  },
  {
    id: 'crimson',
    name: t('app:themes.redWhite'),
    description: t('app:themes.lightWhiteSurfacesWithRichRedAccents'),
    canvas: '#fffafa',
  },
  {
    id: 'cinema',
    name: t('app:themes.cinemaRed'),
    description: t('app:themes.netflixInspiredCharcoalWithVividRedAccents'),
    canvas: '#101010',
  },
  {
    id: 'midnight',
    name: t('app:themes.midnightBlue'),
    description: t('app:themes.primeVideoInspiredNavyWithBrightBlueAccents'),
    canvas: '#080f19',
  },
  {
    id: 'oled',
    name: t('app:themes.oLEDBlack'),
    description: t('app:themes.pureBlackQuietGraySurfacesAndCrispWhiteAccents'),
    canvas: '#000000',
  },
  {
    id: 'forest',
    name: t('app:themes.forest'),
    description: t('app:themes.mediaPlayerCharcoalWithFreshGreenAccents'),
    canvas: '#0e1411',
  },
  {
    id: 'nord',
    name: t('app:themes.nord'),
    description: t('app:themes.coolArcticGreysWithAFrostBlueAccent'),
    canvas: '#2e3440',
  },
  {
    id: 'sakura',
    name: t('app:themes.sakuraDusk'),
    description: t('app:themes.inkVioletSurfacesWithSoftBlossomAccents'),
    canvas: '#221b2b',
  },
  {
    id: 'celestial',
    name: t('app:themes.celestial'),
    description: t('app:themes.deepNightSkiesAndLuminousIceBlueAccents'),
    canvas: '#101c2c',
  },
  {
    id: 'manga',
    name: t('app:themes.mangaPaper'),
    description: t('app:themes.warmPaperDarkInkAndQuietVioletAccents'),
    canvas: '#f5f1e7',
  },
]

/** Where the build writes each theme's manifest, and where the page points at it. */
export const themeManifest = (theme: Theme) => `/manifest-${theme}.webmanifest`
