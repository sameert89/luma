import './lib/i18n'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { configureUiDefaults } from './app/uiDefaults'
import type { components } from './lib/api/generated'
import '@fontsource-variable/inter/wght.css'
import './app/styles.css'

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } })
async function start() {
  try {
    const response = await fetch('/api/ui-configuration', { signal: AbortSignal.timeout(5000) })
    if (response.ok) {
      const config = (await response.json()) as components['schemas']['UiConfigurationResponse']
      configureUiDefaults(config.defaults)
      queryClient.setQueryData(['ui-configuration'], config)
    }
  } catch {
    /* Default appearance remains usable while the API reconnects. */
  }
  const { App } = await import('./app/App')
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>,
  )
}
void start()

// Installable app shell. Service workers need a secure context (HTTPS or localhost);
// plain-HTTP LAN installs keep working as an ordinary site.
if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext)
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      console.warn('Luma offline startup unavailable. Check the connection and HTTPS certificate trust.')
    })
  })
