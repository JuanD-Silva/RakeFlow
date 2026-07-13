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
    // OJO: NO cachea el API — el backend (Railway) es cross-origin y no se
    // configura runtimeCaching a propósito: datos financieros siempre frescos.
    VitePWA({
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
      workbox: {
        // /api/* (función del preview OG) jamás debe caer al index precacheado.
        navigateFallbackDenylist: [/^\/api\//],
        // No precachear los chunks pesados SOLO-staff (exports a Excel/PDF):
        // le ahorran ~2MB de descarga e instalación al teléfono del jugador;
        // se bajan on-demand la primera vez que el staff exporta.
        globIgnores: ['**/exceljs*', '**/jspdf*', '**/html2canvas*', '**/index.es-*'],
      },
    }),
  ],
})
