import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './app/App'
import '@fontsource-variable/inter/wght.css'
import './app/styles.css'

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } })
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)

// Installable app shell. Service workers need a secure context (HTTPS or localhost);
// plain-HTTP LAN installs keep working as an ordinary site.
if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext)
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      console.warn('Luma offline startup unavailable. Check the connection and HTTPS certificate trust.')
    })
  })
