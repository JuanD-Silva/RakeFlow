import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.jsx'

// PWA: capturar beforeinstallprompt TEMPRANO (Chrome puede dispararlo antes de
// que monte el componente del banner). InstallAppBanner lo consume.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  window.__rfDeferredInstall = e
  window.dispatchEvent(new Event('rf-install-ready'))
})

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
