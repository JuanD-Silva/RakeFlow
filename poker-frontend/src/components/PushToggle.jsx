import { useEffect, useState } from 'react';
import { pushService } from '../api/services';

// Toggle "🔔 Avisarme": suscripción a Web Push del panel del jugador.
// Reglas de oro:
// - El permiso se pide SOLO tras el gesto del usuario (tap en el toggle),
//   jamás al cargar — pedirlo de entrada es la vía rápida al "Bloquear".
// - Denegado se respeta: se muestra cómo revertirlo, no se insiste.
// - iOS: Web Push existe desde iOS 16.4 y SOLO con la app instalada
//   (Agregar a pantalla de inicio); sin instalar se explica eso y ya.
// - Auto-reparación: si el permiso está dado y el navegador conserva la
//   suscripción, se re-postea al backend al montar (upsert idempotente) —
//   cubre el caso "cambió de cuenta en el mismo teléfono".

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;

const supported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// La clave pública VAPID (base64url) → Uint8Array para applicationServerKey.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export default function PushToggle() {
  const ios = isIOS();
  // iOS sin instalar: el navegador no soporta push → se muestra la guía.
  const iosNeedsInstall = ios && !isStandalone();
  const canPush = supported() && !iosNeedsInstall;

  const [serverKey, setServerKey] = useState(null);  // null = config no cargada / push apagado en el server
  // 'hidden' = ya suscrito (de antes, o recién activado): la card no se
  // renderiza — la confirmación de la activación es la notificación de
  // bienvenida que dispara enable(). Apagar se hace en los ajustes del
  // navegador/sistema, como en cualquier app.
  const [hidden, setHidden] = useState(false);
  const [denied, setDenied] = useState(() => canPush && Notification.permission === 'denied');
  const [busy, setBusy] = useState(false);

  // Al montar: config del server + estado real (permiso + suscripción local).
  useEffect(() => {
    if (!canPush) return;
    let cancelled = false;
    (async () => {
      try {
        const cfg = await pushService.config();
        if (cancelled || !cfg.enabled || !cfg.public_key) return;
        setServerKey(cfg.public_key);
        if (Notification.permission !== 'granted') return;
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (cancelled || !sub) return;
        // Auto-reparación silenciosa: re-registra esta suscripción a MI cuenta
        // y esconde la card (ya está suscrito; no hay nada que ofrecerle).
        await pushService.subscribe(sub.toJSON());
        if (!cancelled) setHidden(true);
      } catch { /* sin config no hay toggle; el resto del panel sigue */ }
    })();
    return () => { cancelled = true; };
  }, [canPush]);

  // iOS sin instalar: explicar en vez de un toggle muerto.
  if (iosNeedsInstall) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-gray-700/60 bg-gray-800/40 px-4 py-3 mb-4">
        <span className="text-2xl shrink-0">🔔</span>
        <p className="flex-1 text-xs text-gray-400 leading-snug">
          <b className="text-gray-200">¿Querés que te avisemos cuando haya mesa?</b>{' '}
          En iPhone primero instalá la app (botón Compartir → "Agregar a pantalla de inicio"; requiere iOS 16.4+).
        </p>
      </div>
    );
  }
  // Navegador sin push o server sin claves: no mostrar nada.
  // Sin soporte, sin claves en el server, o YA SUSCRITO de una visita
  // anterior: nada que ofrecer, nada que mostrar.
  if (!canPush || !serverKey || hidden) return null;

  const enable = async () => {
    setBusy(true);
    try {
      // El permiso se pide AQUÍ, dentro del gesto.
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setDenied(perm === 'denied');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription())
        || (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(serverKey),
        }));
      await pushService.subscribe(sub.toJSON());
      // La confirmación ES la primera notificación: el backend manda la
      // bienvenida y la card desaparece. Best-effort: si el envío falla,
      // la suscripción ya quedó activa igual.
      try { await pushService.test(); } catch { /* no crítico */ }
      setHidden(true);
    } catch { /* p.ej. push service caído: el toggle queda apagado y reintentable */ }
    finally { setBusy(false); }
  };

  if (denied) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-gray-700/60 bg-gray-800/40 px-4 py-3 mb-4">
        <span className="text-2xl shrink-0">🔕</span>
        <p className="flex-1 text-xs text-gray-400 leading-snug">
          Las notificaciones están <b className="text-gray-200">bloqueadas para este sitio</b>.
          Para recibir avisos, permitilas en la configuración del navegador y recargá.
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 mb-4">
      <span className="text-2xl shrink-0">🔔</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-white leading-tight">Avisarme cuando haya mesa</p>
        <p className="text-[11px] text-emerald-200/80 leading-tight mt-0.5">Mesas abiertas, retos del mes y tu racha</p>
      </div>
      <button
        onClick={enable}
        disabled={busy}
        role="switch"
        aria-checked={false}
        aria-label="Avisarme cuando haya mesa"
        className="rf-tap relative shrink-0 w-12 h-7 rounded-full transition-colors duration-200 disabled:opacity-50 bg-gray-600"
      >
        <span className="absolute top-1 left-1 h-5 w-5 rounded-full bg-white shadow" />
      </button>
    </div>
  );
}
