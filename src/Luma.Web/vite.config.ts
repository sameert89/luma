import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { themes, themeManifest } from './src/app/themes'

const apiTarget = process.env.LUMA_API_URL ?? 'http://127.0.0.1:5080'
const baseManifest = fileURLToPath(new URL('./public/manifest.webmanifest', import.meta.url))

/**
 * One web manifest per theme, identical to the installed manifest apart from its colours. An
 * installed app takes its status bar and splash screen from the manifest rather than from the
 * page, so the page points at the one for the chosen theme and the app follows on a later launch.
 * Every copy keeps the same `id`, so this stays one app however often the theme changes.
 */
function themeManifests(): Plugin {
  const manifests = () => {
    const base = JSON.parse(readFileSync(baseManifest, 'utf8')) as Record<string, unknown>
    return themes.map(theme => ({
      path: themeManifest(theme.id),
      body: JSON.stringify({ ...base, theme_color: theme.canvas, background_color: theme.canvas }, null, 2) + '\n',
    }))
  }
  return {
    name: 'luma-theme-manifests',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = manifests().find(manifest => request.url?.split('?')[0] === manifest.path)
        if (!match) return next()
        response.setHeader('Content-Type', 'application/manifest+json')
        response.end(match.body)
      })
    },
    generateBundle() {
      for (const manifest of manifests())
        this.emitFile({ type: 'asset', fileName: manifest.path.replace(/^\//, ''), source: manifest.body })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), themeManifests()],
  server: { proxy: { '/api': apiTarget } },
  preview: { proxy: { '/api': apiTarget } },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    clearMocks: true,
  },
})
