// Luma service worker: makes the app installable and lets it open without a network.
// It deliberately never touches /api — media streaming, range requests and live
// library data always go straight to the server and the browser's own HTTP cache.
const shell = 'luma-shell-v1'

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(shell)
      .then(cache => cache.add('/'))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(key => key !== shell).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET' || request.mode !== 'navigate') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return
  // Network first, so every release is picked up immediately; the last shell is only a
  // fallback for opening the app while the server is unreachable.
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone()
          event.waitUntil(caches.open(shell).then(cache => cache.put('/', copy)))
        }
        return response
      })
      .catch(() => caches.match('/').then(cached => cached ?? Response.error())),
  )
})
