import { useEffect, useState } from 'react';

// Banner "Instalar la app": el banner automático de Chrome es heurístico y
// muchas veces no aparece, así que ofrecemos el nuestro. Tres modos:
//   • Android/Chrome: dispara el diálogo nativo con el beforeinstallprompt que
//     main.jsx capturó temprano (window.__rfDeferredInstall — el evento puede
//     saltar antes de que React monte).
//   • iOS: no tiene ese evento → se muestran los 2 pasos de Safari.
//   • Brave/Firefox y demás: SUPRIMEN o retrasan beforeinstallprompt, así que
//     el diálogo de un toque nunca llega. Sin fallback el jugador no ve forma
//     de instalar (esto pasó con un usuario de Brave). Tras una espera de
//     gracia sin evento, mostramos instrucciones manuales del menú ⋮.
// Se oculta si ya corre instalada (display-mode: standalone) y respeta el
// descarte del usuario por 14 días (localStorage).

const DISMISS_KEY = 'rf_install_dismissed_at';
const DISMISS_MS = 14 * 86400e3;
// Espera antes de caer al modo manual: Chrome dispara beforeinstallprompt
// dentro del primer segundo; si a los 1.5s no llegó, el navegador no lo va a
// entregar (Brave/Firefox) → mostramos las instrucciones del menú.
const PROMPT_GRACE_MS = 1500;

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
// Brave inyecta navigator.brave; Firefox no soporta el prompt de un toque.
const isBrave = () => !!navigator.brave;
const isFirefox = () => /firefox/i.test(navigator.userAgent);

const dismissedRecently = () => {
  try { return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < DISMISS_MS; }
  catch { return false; }
};

export default function InstallAppBanner({
  title = 'Lleva tu panel en el bolsillo',
  subtitle = 'Ícono en tu pantalla, abre al toque',
} = {}) {
  // Todo lo decidible en el montaje va en initializers (el lint de React 19
  // prohíbe setState síncrono dentro del effect): iOS es constante, y la
  // visibilidad inicial sale de standalone/descarte/evento ya capturado.
  const ios = isIOS();
  const eligible = !isStandalone() && !dismissedRecently();
  const [promptEvt, setPromptEvt] = useState(() => window.__rfDeferredInstall || null);
  const [visible, setVisible] = useState(() => eligible && (ios || !!window.__rfDeferredInstall));

  // El effect suscribe eventos (prompt tardío, instalación) y arma la espera
  // de gracia que cae al modo manual si el navegador nunca entrega el prompt.
  useEffect(() => {
    if (!eligible || ios) return undefined;
    const onReady = () => { setPromptEvt(window.__rfDeferredInstall); setVisible(true); };
    const onInstalled = () => { setVisible(false); setPromptEvt(null); };
    window.addEventListener('rf-install-ready', onReady);
    window.addEventListener('appinstalled', onInstalled);
    // Si tras la gracia no hay prompt, ofrecer el camino manual (menú ⋮): se
    // muestra el banner y, sin promptEvt, el render cae al modo 'manual'.
    const t = setTimeout(() => {
      if (!window.__rfDeferredInstall) setVisible(true);
    }, PROMPT_GRACE_MS);
    return () => {
      clearTimeout(t);
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
    // Nulear ANTES del await: prompt() solo acepta una llamada — un doble-tap
    // rápido no debe re-invocarlo (review #77).
    setPromptEvt(null);
    promptEvt.prompt();
    try {
      const { outcome } = await promptEvt.userChoice;
      if (outcome !== 'accepted') dismiss();
      else setVisible(false);
    } catch { setVisible(false); }
    window.__rfDeferredInstall = null;
  };

  // Prioridad de render: iOS → prompt de un toque → manual (menú ⋮). El prompt
  // gana sobre manual, así que un beforeinstallprompt que llega tarde (Chrome)
  // reemplaza las instrucciones por el botón sin parpadeo.
  const mode = ios ? 'ios' : promptEvt ? 'prompt' : 'manual';
  // Nombre del ítem del menú según navegador (Brave usa "Agregar a pantalla
  // de inicio" en el móvil; el resto varía, así que ofrecemos ambos).
  const menuHint = isBrave() || isFirefox()
    ? 'Agregar a pantalla de inicio'
    : 'Instalar app o Agregar a pantalla de inicio';

  return (
    <div className="rf-in flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 mb-4">
      <span className="text-2xl shrink-0">📲</span>
      {mode === 'ios' ? (
        <p className="flex-1 text-xs text-emerald-100/90 leading-snug">
          <b className="text-white">{title}:</b> toca <b>Compartir</b> y luego <b>"Agregar a pantalla de inicio"</b>.
        </p>
      ) : mode === 'manual' ? (
        <p className="flex-1 text-xs text-emerald-100/90 leading-snug">
          <b className="text-white">{title}:</b> abre el menú <b>⋮</b> del navegador y toca <b>"{menuHint}"</b>.
        </p>
      ) : (
        <>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white leading-tight">{title}</p>
            <p className="text-[11px] text-emerald-200/80 leading-tight mt-0.5">{subtitle}</p>
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
