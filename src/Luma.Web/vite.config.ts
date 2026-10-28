import { readFileSync, readdirSync } from 'node:fs'
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

/** Keep PDF fonts/CMaps/decoders local, with stable names expected by PDF.js. */
function pdfAssets(): Plugin {
  const assets = ['cmaps', 'standard_fonts', 'wasm'].flatMap(directory => {
    const root = new URL(`./node_modules/pdfjs-dist/${directory}/`, import.meta.url)
    return readdirSync(root)
      .filter(name => /\.(bcmap|pfb|ttf|wasm|js)$/.test(name) || /LICENSE/i.test(name))
      .map(name => ({
        path: `/pdfjs/${directory}/${name}`,
        source: new URL(name, root),
      }))
  })
  return {
    name: 'luma-pdf-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const asset = assets.find(item => item.path === request.url?.split('?')[0])
        if (!asset) return next()
        response.setHeader(
          'Content-Type',
          asset.path.endsWith('.wasm')
            ? 'application/wasm'
            : asset.path.endsWith('.js')
              ? 'text/javascript'
              : 'application/octet-stream',
        )
        response.end(readFileSync(asset.source))
      })
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'pdfjs/LICENSE',
        source: readFileSync(new URL('./node_modules/pdfjs-dist/LICENSE', import.meta.url)),
      })
      for (const asset of assets)
        this.emitFile({ type: 'asset', fileName: asset.path.slice(1), source: readFileSync(asset.source) })
    },
  }
}

export default defineConfig(({ mode }) => ({
  base: mode === 'help' ? './' : '/',
  build: mode === 'help' ? { outDir: 'help-dist', rollupOptions: { input: 'help.html' } } : {},
  plugins: [react(), tailwindcss(), themeManifests(), ...(mode === 'help' ? [] : [pdfAssets()])],
  // Preserve the browser-facing host for the API's same-origin checks.
  server: { proxy: { '/api': { target: apiTarget, changeOrigin: false } } },
  preview: { proxy: { '/api': { target: apiTarget, changeOrigin: false } } },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    clearMocks: true,
  },
}))
