import { useState, useEffect, useCallback } from 'react';
import { reactivationService } from '../api/services';

// Vista de staff (OWNER/MANAGER): reactivación de jugadores inactivos por WhatsApp,
// montada como EXPERIMENTO con grupo de control. La lista solo trae al grupo
// tratamiento; el control (holdout) nunca aparece → no se le manda nada, y su
// tasa de retorno es el punto de comparación para saber si el mensaje sirve.

function pctText(p) {
  return p === null || p === undefined ? '—' : `${Math.round(p * 100)}%`;
}

function daysText(n) {
  if (n === null || n === undefined) return '';
  if (n >= 60) return `hace +${Math.floor(n / 30)} meses`;
  return `hace ${n} días`;
}

function waLink(phone, name) {
  // El backend ya normaliza (dígitos + código país); limpiamos por si acaso.
  const digits = String(phone || '').replace(/\D/g, '');
  const text = `¡Hola ${name || ''}! 🃏 Hace rato no te vemos por la mesa. ` +
    `¿Te sumás esta semana? Escribinos por acá y te contamos qué se viene.`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

function Stat({ label, value, sub, color }) {
  return (
    <div className={`bg-gray-800 rounded-xl p-4 border-l-4 ${color} shadow-lg`}>
      <p className="text-gray-400 text-xs uppercase font-bold tracking-wider">{label}</p>
      <p className="text-2xl font-bold text-white font-mono mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

export default function Reactivation() {
  const [pool, setPool] = useState(null);
  const [lift, setLift] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [contacted, setContacted] = useState(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, l] = await Promise.all([
        reactivationService.refreshPool(),
        reactivationService.getLift().catch(() => null),
      ]);
      setPool(p);
      setLift(l);
    } catch {
      setError('No se pudo cargar la lista de reactivación.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const contact = async (p) => {
    window.open(waLink(p.phone, p.name), '_blank', 'noopener');
    setContacted((prev) => new Set(prev).add(p.player_id));  // feedback inmediato
    try {
      await reactivationService.markSent(p.player_id);
    } catch {
      // Best-effort: abrir el WhatsApp es lo importante; el registro reintenta al recargar.
    }
  };

  if (loading) {
    return (
      <div className="p-4 sm:p-6 max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-52 bg-gray-800 rounded" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => <div key={i} className="h-24 bg-gray-800 rounded-xl" />)}
          </div>
          <div className="h-40 bg-gray-800 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 sm:p-6 max-w-4xl mx-auto">
        <p className="text-red-400">{error}</p>
        <button onClick={load} className="mt-3 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold">
          Reintentar
        </button>
      </div>
    );
  }

  const counts = pool?.counts || { treatment: 0, control: 0, total_qualified: 0 };
  const list = pool?.treatment || [];

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">Reactivación</h2>
        <p className="text-sm text-gray-400 mt-1">
          Jugadores que hace más de {pool?.inactive_days ?? 21} días no vienen. Mandales un
          WhatsApp para invitarlos a volver.
        </p>
      </div>

      {/* Métricas del experimento */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="Para contactar" value={counts.treatment} sub="grupo tratamiento" color="border-emerald-500" />
        <Stat label="Control (no tocar)" value={counts.control} sub={`holdout ${pool?.control_pct ?? 30}%`} color="border-violet-500" />
        <Stat
          label="Lift"
          value={lift && lift.lift !== null ? `+${Math.round(lift.lift * 100)}pp` : '—'}
          sub={lift && lift.lift !== null
            ? `vuelven ${pctText(lift.treatment.pct)} vs ${pctText(lift.control.pct)} control`
            : `midiéndose (ventana ${lift?.window_days ?? 30}d)`}
          color="border-amber-500"
        />
      </div>

      <div className="bg-violet-500/10 border border-violet-500/30 rounded-xl px-4 py-3 text-xs text-violet-200">
        <b>Experimento:</b> un {pool?.control_pct ?? 30}% de los inactivos queda como grupo de
        control y <b>no recibe mensaje</b> a propósito. Comparar cuántos vuelven de cada grupo es
        la única forma de saber si el WhatsApp de verdad los trae de vuelta. La señal tarda semanas.
      </div>

      {/* Lista de tratamiento */}
      {list.length === 0 ? (
        <div className="bg-gray-800/60 border border-gray-700/60 rounded-xl px-4 py-8 text-center text-gray-400">
          No hay inactivos para reactivar ahora 🎉
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((p) => {
            const done = contacted.has(p.player_id) || Boolean(p.last_sent_at);
            const noPhone = !p.phone;
            return (
              <div key={p.player_id} className="bg-gray-800/60 border border-gray-700/60 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-white font-semibold truncate">{p.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {daysText(p.days_inactive)} · {p.visits} {p.visits === 1 ? 'visita' : 'visitas'}
                    {p.last_sent_at && <span className="ml-2 text-emerald-400">· ya contactado</span>}
                  </p>
                </div>
                <button
                  onClick={() => contact(p)}
                  disabled={noPhone}
                  title={noPhone ? 'Sin teléfono válido' : ''}
                  className={`shrink-0 px-3 py-2 rounded-lg text-sm font-semibold text-white ${
                    noPhone ? 'bg-gray-700 opacity-50 cursor-not-allowed'
                      : done ? 'bg-gray-600 hover:bg-gray-500' : 'bg-emerald-600 hover:bg-emerald-500'
                  }`}
                >
                  {noPhone ? 'Sin teléfono' : done ? 'Enviar de nuevo' : 'WhatsApp'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
