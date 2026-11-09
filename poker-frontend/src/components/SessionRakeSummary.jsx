import { useEffect, useState } from 'react';
import { dealerService } from '../api/services';
import { formatMoney, fmtTime } from '../utils/formatters';
import { useAuth } from '../context/AuthContext';

/**
 * Rake y gastos de UNA mesa cash, de un vistazo (en la mesa activa).
 *
 * Rake = lo que el cajero ya declara por turno de dealer (botón "Rake" y el
 * cambio de turno). No se anota nada nuevo acá. Gastos = pago a dealers
 * (horas + % del rake) + cortesías: exactamente lo que el cierre resta del rake.
 * Es una ESTIMACIÓN en vivo; el número contable sale al cerrar la mesa.
 *
 * Solo OWNER/MANAGER (el backend también lo gatea con 403).
 */
export default function SessionRakeSummary({ sessionId, refreshTrigger }) {
  const { canSeeReports } = useAuth();
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(true);

  // Igual que SessionDealerPayments: sin flag de loading para no parpadear en
  // cada poll de 15s; se muestran los datos previos mientras refetchea.
  useEffect(() => {
    if (!sessionId || !canSeeReports) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await dealerService.getSessionRakeSummary(sessionId);
        if (!cancelled) setData(res);
      } catch {
        if (!cancelled) setData(null);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId, refreshTrigger, canSeeReports]);

  if (!canSeeReports || !data) return null;

  const ex = data.expenses || {};
  const shifts = data.shifts || [];
  const netNegative = data.net < 0;

  return (
    <section className="bg-gray-800/40 border border-emerald-500/25 rounded-xl overflow-hidden" aria-label="Rake y gastos de la mesa">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-800/40 transition-colors">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-300/90">Rake de la mesa</p>
          <p className="text-2xl font-black text-white tabular-nums leading-tight">{formatMoney(data.rake_total)}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Neto estimado</p>
          <p className={`text-lg font-black tabular-nums ${netNegative ? 'text-red-400' : 'text-emerald-400'}`}>{formatMoney(data.net)}</p>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          {/* De dónde sale el rake */}
          {data.has_live_source ? (
            <ul className="space-y-1.5">
              {shifts.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-gray-300">
                    <span className="font-bold text-white">{s.dealer_name}</span>
                    <span className="text-gray-500"> · {fmtTime(s.start_time)}–{s.open ? 'ahora' : fmtTime(s.end_time)}</span>
                  </span>
                  <span className={`shrink-0 tabular-nums font-bold ${s.rake_declared ? 'text-white' : 'text-gray-600'}`}>
                    {s.rake_declared ? formatMoney(s.rake) : 'sin declarar'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-gray-500">Esta mesa no tiene dealer: el rake se conoce al contar la caja en el cierre.</p>
          )}
          {data.open_shift_undeclared && (
            <p className="text-[11px] text-amber-300/90">El turno en curso no ha declarado rake: tócale "Rake" al dealer para verlo acá.</p>
          )}

          {/* Gastos */}
          <div className="border-t border-gray-700/60 pt-3 space-y-1.5 text-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Gastos</p>
            <div className="flex justify-between gap-3">
              <span className="text-gray-300">Dealers <span className="text-gray-500">(horas + % del rake)</span></span>
              <span className="tabular-nums text-red-300 font-bold">− {formatMoney(ex.dealers)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-300">Cortesías</span>
              <span className="tabular-nums text-red-300 font-bold">− {formatMoney(ex.courtesies)}</span>
            </div>
            <div className="flex justify-between gap-3 border-t border-gray-700/60 pt-2 mt-2">
              <span className="text-white font-bold">{data.session_open ? 'Rake neto estimado' : 'Rake neto'}</span>
              <span className={`tabular-nums font-black ${netNegative ? 'text-red-400' : 'text-emerald-400'}`}>{formatMoney(data.net)}</span>
            </div>
          </div>

          <p className="text-[11px] text-gray-500 leading-snug">
            {data.session_open
              ? 'Estimado con el rake declarado por turno. El número final sale al contar la caja en el cierre.'
              : 'Mesa cerrada: números del cierre.'}
          </p>
        </div>
      )}
    </section>
  );
}
