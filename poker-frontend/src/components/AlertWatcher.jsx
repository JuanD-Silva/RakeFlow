import { useEffect, useState, useRef, useCallback } from 'react';
import { alertService } from '../api/services';

const META = {
  CHIPS: { emoji: '🎰', label: 'Fichas' },
  WAITER: { emoji: '🍺', label: 'Mesero' },
  MANAGER: { emoji: '👤', label: 'Director' },
  URGENT: { emoji: '🚨', label: 'Urgencia' },
};

/**
 * Recibe (por polling) las alertas que envían los dealers desde su link público
 * y las muestra como banner flotante para que el cajero las atienda. No hay
 * realtime; se consulta /dealer-alerts?status=PENDING cada 12s.
 */
export default function AlertWatcher() {
  const [alerts, setAlerts] = useState([]);
  const prevIds = useRef(new Set());

  const poll = useCallback(async () => {
    try {
      const data = await alertService.listPending();
      setAlerts(data);
      // Beep/vibración cuando entra una alerta nueva
      const ids = new Set(data.map((a) => a.id));
      const hasNew = data.some((a) => !prevIds.current.has(a.id));
      if (hasNew && prevIds.current.size >= 0 && data.length > 0) {
        if (navigator.vibrate) navigator.vibrate(120);
      }
      prevIds.current = ids;
    } catch { /* silencioso: no romper la app por el polling */ }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 12000);
    return () => clearInterval(id);
  }, [poll]);

  const resolve = async (id) => {
    setAlerts((a) => a.filter((x) => x.id !== id)); // optimista
    try { await alertService.resolve(id); } catch { poll(); }
  };

  if (alerts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[80] space-y-2 w-[min(92vw,360px)]">
      {alerts.slice(0, 4).map((a) => {
        const m = META[a.alert_type] || { emoji: '🔔', label: a.alert_type };
        const urgent = a.alert_type === 'URGENT';
        return (
          <div
            key={a.id}
            className={`flex items-center gap-3 rounded-xl px-4 py-3 shadow-2xl border animate-fade-in ${
              urgent ? 'bg-red-900/90 border-red-500/60' : 'bg-gray-800/95 border-emerald-500/40'
            } backdrop-blur`}
          >
            <span className="text-2xl shrink-0">{m.emoji}</span>
            <div className="min-w-0 flex-1">
              <p className="text-white font-bold text-sm leading-tight">{m.label} · {a.table_name}</p>
              <p className="text-gray-400 text-[11px] truncate">
                {a.dealer_name ? `Dealer: ${a.dealer_name}` : 'Dealer'}{a.message ? ` · ${a.message}` : ''}
              </p>
            </div>
            <button
              onClick={() => resolve(a.id)}
              className="shrink-0 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors"
            >
              Listo
            </button>
          </div>
        );
      })}
      {alerts.length > 4 && (
        <p className="text-center text-[11px] text-gray-400 font-bold">+{alerts.length - 4} más</p>
      )}
    </div>
  );
}
