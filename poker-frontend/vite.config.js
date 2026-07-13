import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(),
    tailwindcss(),
    // PWA: instalable en el teléfono (jugadores/dealers/staff) con ícono y
    // pantalla completa. El service worker PRECACHEA el shell del SPA (carga
    // instantánea) y se auto-actualiza en la siguiente visita tras un deploy.
    // OJO: NO cachea el API — el backend (Railway) es cross-origin y no hay
    // rutas runtime para él a propósito: datos financieros siempre frescos.
    // strategies injectManifest: el SW es NUESTRO (src/sw.js) porque generateSW
    // no admite handlers custom y Web Push los necesita (push/notificationclick).
    // El precache + autoUpdate + denylist de /api/ se conservan DENTRO de sw.js.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      manifest: {
        name: 'RakeFlow',
        short_name: 'RakeFlow',
        description: 'Tu club de poker en el bolsillo: panel del jugador, mesas y torneos en vivo.',
        lang: 'es',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0a0f1a',
        theme_color: '#0a0f1a',
        icons: [
          { src: '/favicon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        // No precachear los chunks pesados SOLO-staff (exports a Excel/PDF):
        // le ahorran ~2MB de descarga e instalación al teléfono del jugador;
        // se bajan on-demand la primera vez que el staff exporta.
        globIgnores: ['**/exceljs*', '**/jspdf*', '**/html2canvas*', '**/index.es-*'],
      },
    }),
  ],
})
