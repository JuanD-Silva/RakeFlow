/* Service worker PROPIO (vite-plugin-pwa strategies: 'injectManifest').
 * Replica lo que hacía el generateSW anterior — precache del shell, autoUpdate,
 * /api/ jamás al fallback del SPA — y suma los handlers de Web Push, que
 * generateSW no puede generar. Si tocás el precache, verificá el build:
 * dist/sw.js debe existir y el manifest inyectarse en self.__WB_MANIFEST. */
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { clientsClaim } from 'workbox-core'

// autoUpdate: el SW nuevo toma control apenas instala (equivale al
// skipWaiting+clientsClaim que registerType 'autoUpdate' generaba solo).
self.skipWaiting()
clientsClaim()

// Precache del shell del SPA; el manifest lo inyecta vite-plugin-pwa al build.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Fallback SPA: toda navegación cae al index precacheado, MENOS /api/*
// (función del preview OG de Vercel): eso jamás debe responderse con el shell.
registerRoute(new NavigationRoute(
  createHandlerBoundToURL('index.html'),
  { denylist: [/^\/api\//] },
))

// ——— Web Push (panel del jugador) ———
// Payload JSON del backend (app/push_service.py): {title, body, tag, url}.
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(self.registration.showNotification(data.title || 'RakeFlow', {
    body: data.body || '',
    icon: '/favicon-192.png',
    badge: '/favicon-192.png',
    // Mismo tag ⇒ la nueva REEMPLAZA a la anterior (no se apilan avisos viejos).
    tag: data.tag || 'rakeflow',
    data: { url: data.url || '/' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil((async () => {
    // Si la app ya está abierta: enfocarla, navegando al deep-link del aviso
    // solo si trae uno (url '/' = solo traer al frente, sin recargar el SPA).
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of wins) {
      if ('focus' in client) {
        if (url !== '/' && 'navigate' in client) {
          try { await client.navigate(url) } catch { /* cross-origin u obsoleta: solo enfocar */ }
        }
        return client.focus()
      }
    }
    return self.clients.openWindow(url)
  })())
})
