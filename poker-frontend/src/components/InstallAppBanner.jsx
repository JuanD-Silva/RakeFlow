import { useEffect, useState } from 'react';

// Banner "Instalar la app": el banner automático de Chrome es heurístico y
// muchas veces no aparece, así que ofrecemos el nuestro. Android/Chrome:
// dispara el diálogo nativo con el beforeinstallprompt que main.jsx capturó
// temprano (window.__rfDeferredInstall — el evento puede saltar antes de que
// React monte). iOS no tiene ese evento: se muestran los 2 pasos de Safari.
// Se oculta si ya corre instalada (display-mode: standalone) y respeta el
// descarte del usuario por 14 días (localStorage).

const DISMISS_KEY = 'rf_install_dismissed_at';
const DISMISS_MS = 14 * 86400e3;

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

const dismissedRecently = () => {
  try { return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < DISMISS_MS; }
  catch { return false; }
};

export default function InstallAppBanner() {
  // Todo lo decidible en el montaje va en initializers (el lint de React 19
  // prohíbe setState síncrono dentro del effect): iOS es constante, y la
  // visibilidad inicial sale de standalone/descarte/evento ya capturado.
  const ios = isIOS();
  const eligible = !isStandalone() && !dismissedRecently();
  const [promptEvt, setPromptEvt] = useState(() => window.__rfDeferredInstall || null);
  const [visible, setVisible] = useState(() => eligible && (ios || !!window.__rfDeferredInstall));

  // El effect SOLO suscribe eventos (async): prompt que llega tarde e instalación.
  useEffect(() => {
    if (!eligible || ios) return undefined;
    const onReady = () => { setPromptEvt(window.__rfDeferredInstall); setVisible(true); };
    const onInstalled = () => { setVisible(false); setPromptEvt(null); };
    window.addEventListener('rf-install-ready', onReady);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('rf-install-ready', onReady);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [eligible, ios]);

  if (!visible) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* sin storage, se re-ofrece */ }
    setVisible(false);
  };

  const install = async () => {
    if (!promptEvt) return;
    promptEvt.prompt();
    try {
      const { outcome } = await promptEvt.userChoice;
      if (outcome !== 'accepted') dismiss();
      else setVisible(false);
    } catch { setVisible(false); }
    window.__rfDeferredInstall = null;
    setPromptEvt(null);
  };

  return (
    <div className="rf-in flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 mb-4">
      <span className="text-2xl shrink-0">📲</span>
      {ios ? (
        <p className="flex-1 text-xs text-emerald-100/90 leading-snug">
          <b className="text-white">Llevá tu panel en el bolsillo:</b> tocá <b>Compartir</b> y luego <b>"Agregar a pantalla de inicio"</b>.
        </p>
      ) : (
        <>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white leading-tight">Llevá tu panel en el bolsillo</p>
            <p className="text-[11px] text-emerald-200/80 leading-tight mt-0.5">Ícono en tu pantalla, abre al toque</p>
          </div>
          <button onClick={install}
            className="rf-tap shrink-0 bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-black uppercase tracking-wide px-3.5 py-2 rounded-xl">
            Instalar
          </button>
        </>
      )}
      <button onClick={dismiss} aria-label="No mostrar por ahora"
        className="rf-tap shrink-0 text-emerald-200/60 hover:text-white text-lg leading-none px-1">✕</button>
    </div>
  );
}
