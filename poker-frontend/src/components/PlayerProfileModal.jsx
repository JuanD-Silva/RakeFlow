import { useEffect, useState } from 'react';
import { playerService } from '../api/services';
import { mcop, segmentOf, waPhone } from '../utils/crm';

// Ficha 360 del jugador para el CLUB (OWNER/MANAGER): se abre desde el
// directorio. Totales de su historia, actividad de los últimos 6 meses y sus
// últimas jugadas — todo lo que el staff necesita para decidir cómo atenderlo
// o traerlo de vuelta, con el WhatsApp a un toque.

const MONTHS_SHORT = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const monthLabel = (ym) => {
  const m = parseInt(ym.slice(5), 10);
  return MONTHS_SHORT[m] || ym;
};

const fmtDay = (iso) => iso
  ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
  : '—';

const Kpi = ({ label, value, tone }) => (
  <div className="bg-gray-900/60 border border-gray-700/50 rounded-xl px-3 py-2.5">
    <p className={`text-base font-black leading-tight nums ${tone || 'text-white'}`}>{value}</p>
    <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wide mt-0.5">{label}</p>
  </div>
);

export default function PlayerProfileModal({ player, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  // El caller monta el modal con key={player.id}: cambiar de jugador remonta el
  // componente (estado fresco), así el effect no necesita resetear estado a mano.
  useEffect(() => {
    let cancelled = false;
    playerService.insightsDetail(player.id)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [player.id]);

  const t = data?.totals;
  const seg = t ? segmentOf(t.days_inactive) : null;
  const wa = waPhone(player.phone);
  const maxVisits = data ? Math.max(1, ...data.monthly.map((m) => m.visits)) : 1;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm overflow-y-auto" onClick={onClose}>
      <button onClick={onClose} aria-label="Cerrar"
        className="fixed top-3 right-3 z-10 w-9 h-9 flex items-center justify-center rounded-full bg-gray-800/80 text-gray-300 hover:text-white text-lg leading-none">✕</button>

      <div className="min-h-full flex flex-col items-center justify-center px-4 py-10" onClick={(e) => e.stopPropagation()}>
        <div className="w-full max-w-md bg-gray-900 border border-gray-700/60 rounded-2xl p-5 space-y-4">

          {/* Cabecera: quién es y en qué estado está */}
          <div>
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-xl font-black text-white leading-tight">{player.name}</h3>
              {player.is_vip && (
                <span className="shrink-0 text-[9px] font-bold uppercase px-2 py-1 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/25">💎 VIP</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px]">
              {t && (seg ? (
                <span className={`font-bold px-2 py-0.5 rounded-full border ${seg.cls}`}>
                  {seg.emoji} hace {t.days_inactive}d
                </span>
              ) : (
                <span className="font-bold px-2 py-0.5 rounded-full border bg-gray-700/40 text-gray-500 border-gray-600/40">sin visitas</span>
              ))}
              {t?.first_visit && (
                <span className="text-gray-500">cliente desde <b className="text-gray-300">{fmtDay(t.first_visit)}</b></span>
              )}
            </div>
            <p className="text-xs text-gray-500 font-mono mt-1.5">{player.phone || 'sin teléfono'}</p>
          </div>

          {error && (
            <p className="text-sm text-red-300 py-6 text-center">No se pudo cargar la ficha. Cerrá y probá de nuevo.</p>
          )}
          {!data && !error && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {[...Array(6)].map((_, i) => <div key={i} className="h-14 rounded-xl bg-gray-800 animate-pulse" />)}
              </div>
              <div className="h-24 rounded-xl bg-gray-800 animate-pulse" />
            </div>
          )}

          {data && t && (
            <>
              {/* KPIs de la historia completa */}
              <div className="grid grid-cols-3 gap-2">
                <Kpi label="Visitas" value={t.visits} />
                <Kpi label="Horas en mesa" value={`${t.hours} h`} />
                <Kpi label="Torneos" value={t.tournaments} />
                <Kpi label="Rake aportado*" value={mcop(t.rake_est)} tone="text-emerald-300" />
                {t.net !== 0 ? (
                  t.net < 0
                    ? <Kpi label="Deja en el club" value={mcop(t.net)} tone="text-emerald-300" />
                    : <Kpi label="Retira del club" value={mcop(t.net)} tone="text-amber-300" />
                ) : (
                  <Kpi label="Resultado" value="$0" />
                )}
                <Kpi label="Consumo y tips" value={mcop(t.spend)} />
              </div>
              <p className="text-[10px] text-gray-500 -mt-2">
                Movió <b className="text-gray-400">{mcop(t.volume)}</b> en total · promedio <b className="text-gray-400">{mcop(t.avg_per_visit)}</b> por visita ·
                *rake estimado con el yield del club ({data.yield_pct}%)
              </p>

              {/* Actividad últimos 6 meses (visitas por mes) */}
              <div>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">Actividad · últimos 6 meses</p>
                <div className="flex items-end gap-1.5 h-20">
                  {data.monthly.map((m) => (
                    <div key={m.month} className="flex-1 flex flex-col items-center justify-end gap-1 h-full"
                      title={`${m.month}: ${m.visits} visita${m.visits !== 1 ? 's' : ''} · movió ${mcop(m.volume)}`}>
                      {m.visits > 0 && <span className="text-[9px] text-gray-400 font-bold nums leading-none">{m.visits}</span>}
                      <div className={`w-full rounded-t ${m.visits > 0 ? 'bg-emerald-500/70' : 'bg-gray-800'}`}
                        style={{ height: `${Math.max(4, (m.visits / maxVisits) * 56)}px` }} />
                      <span className="text-[9px] text-gray-500">{monthLabel(m.month)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Últimas jugadas */}
              {data.recent.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">Últimas jugadas</p>
                  <div className="space-y-1">
                    {data.recent.map((r, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 bg-gray-800/50 rounded-lg px-3 py-2 text-xs">
                        <div className="min-w-0 flex items-center gap-2">
                          <span>{r.kind === 'torneo' ? '🏆' : '🃏'}</span>
                          <div className="min-w-0">
                            <p className="text-gray-200 font-bold truncate">
                              {r.name}{r.rank ? <span className="text-amber-300"> · #{r.rank}</span> : null}
                            </p>
                            <p className="text-[10px] text-gray-500">{fmtDay(r.date)} · entró {mcop(r.invested)}</p>
                          </div>
                        </div>
                        <span className={`shrink-0 font-black nums ${r.net > 0 ? 'text-emerald-300' : r.net < 0 ? 'text-red-300/90' : 'text-gray-400'}`}>
                          {r.net > 0 ? '+' : r.net < 0 ? '−' : ''}{mcop(r.net)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Acción principal: hablarle */}
          {wa && (
            <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer"
              className="block w-full py-3 rounded-xl bg-[#25D366]/90 hover:bg-[#25D366] text-white font-black uppercase tracking-wide text-center text-sm">
              💬 Escribirle por WhatsApp
            </a>
          )}
        </div>

        <button onClick={onClose} className="mt-4 text-sm text-gray-400 hover:text-white font-bold">Cerrar</button>
      </div>
    </div>
  );
}
