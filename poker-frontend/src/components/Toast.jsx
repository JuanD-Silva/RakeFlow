import { useEffect, useRef, useState, useCallback } from 'react';
import { XCircleIcon, CheckCircleIcon } from '@heroicons/react/24/solid';

// TOAST ÚNICO de la app (antes había dos copias divergentes en GameControl y
// TournamentPlayerTable). Reglas que ya se pagaron con revisiones:
// - bottom-fixed en móvil (zona del pulgar), top-right en desktop
// - pointer-events-none en el contenedor (no roba toques de la lista de abajo)
//   y pointer-events-auto SOLO en el botón de acción
// - el timer vive en un ref (un toast nuevo no muere por el timeout del viejo)
//   y se limpia al desmontar
// - action opcional { label, onClick } (ej. Deshacer): 5s en vez de 3s

export function useToast() {
  const [toast, setToast] = useState(null); // { message, type, action }
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const showToast = useCallback((message, type = 'success', action = null) => {
    clearTimeout(timer.current);
    setToast({ message, type, action });
    timer.current = setTimeout(() => setToast(null), action ? 5000 : 3000);
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);
  return { toast, showToast, dismissToast };
}

export function Toast({ toast, onDismiss }) {
  if (!toast) return null;
  return (
    <div
      className={`pointer-events-none fixed bottom-6 left-4 right-4 sm:bottom-auto sm:top-5 sm:left-auto sm:right-5 z-[110] px-6 py-4 rounded-xl shadow-2xl border flex items-center gap-3 animate-fade-in-up ${toast.type === 'error' ? 'bg-red-900/90 border-red-500 text-white' : 'bg-emerald-900/90 border-emerald-500 text-white'}`}
      role="status"
      aria-live="polite"
    >
      {toast.type === 'error' ? <XCircleIcon className="w-6 h-6 shrink-0" /> : <CheckCircleIcon className="w-6 h-6 shrink-0" />}
      <span className="font-bold">{toast.message}</span>
      {toast.action && (
        <button
          onClick={() => { const a = toast.action; onDismiss?.(); a.onClick(); }}
          className="pointer-events-auto ml-2 shrink-0 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 border border-white/30 font-black uppercase text-xs tracking-wider"
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
