const BASE_PATH = new URL(self.registration.scope).pathname
const CACHE_PREFIX = `chimera-notification-shell-${encodeURIComponent(BASE_PATH)}-`
const CACHE_NAME = `${CACHE_PREFIX}v2`
const SHELL_URL = self.registration.scope

const scopedPath = pathname => (pathname.startsWith(BASE_PATH) ? `/${pathname.slice(BASE_PATH.length)}` : pathname)

const isBlockedPath = pathname =>
  /(^|\/)(api|auth|event|events|global|file|files|attachment|attachments|sse)(\/|$)/i.test(pathname)

const isExplicitStaticResource = pathname =>
  pathname.startsWith('/assets/') ||
  pathname.startsWith('/icons/') ||
  pathname === '/manifest.webmanifest' ||
  pathname === '/manifest.json' ||
  pathname === '/favicon.ico' ||
  pathname === '/opencode.svg'

const isSafeRequest = request => {
  if (request.method !== 'GET') return false
  if (request.headers.has('authorization') || request.headers.has('range')) return false

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return false
  const pathname = scopedPath(url.pathname)
  if (isBlockedPath(pathname)) return false
  return request.mode === 'navigate' || isExplicitStaticResource(pathname)
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(cache => cache.add(new Request(SHELL_URL, { credentials: 'same-origin' })))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', event => {
  if (!isSafeRequest(event.request)) return

  if (event.request.mode === 'navigate') {
    const isShellNavigation = new URL(event.request.url).pathname === BASE_PATH
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (isShellNavigation && response.ok && response.type === 'basic') {
            void caches.open(CACHE_NAME).then(cache => cache.put(SHELL_URL, response.clone()))
          }
          return response
        })
        .catch(() => caches.match(SHELL_URL).then(response => response || Response.error())),
    )
    return
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached
      return fetch(event.request).then(response => {
        if (response.ok && response.type === 'basic') {
          void caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()))
        }
        return response
      })
    }),
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const data = event.notification.data || {}
  const sessionID = typeof data.sessionID === 'string' ? data.sessionID : data.sessionId
  if (typeof sessionID !== 'string' || !sessionID) return

  const directory =
    typeof data.directory === 'string' && data.directory ? `?dir=${encodeURIComponent(data.directory)}` : ''
  const target = `${BASE_PATH}#/session/${encodeURIComponent(sessionID)}${directory}`

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      const existing = windowClients.find(client => {
        const url = new URL(client.url)
        return url.origin === self.location.origin && url.pathname.startsWith(BASE_PATH)
      })
      if (existing) {
        existing.postMessage({ type: 'notification-click', sessionID, directory: data.directory })
        return existing.focus()
      }
      return clients.openWindow(target)
    }),
  )
})
