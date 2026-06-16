import { useEffect, useState } from 'react';
import { statsService } from '../api/services';
import { formatMoney } from '../utils/formatters';
import { CurrencyDollarIcon, ClockIcon, UserGroupIcon } from '@heroicons/react/24/outline';

/**
 * Reporte de pagos a dealers en un rango (recibe startISO/endISO YYYY-MM-DD).
 * Pago del club = horas × tarifa + % del rake. Propinas aparte (son del dealer).
 * Solo cuenta turnos CERRADOS dentro del rango.
 */
export default function DealerPaymentsTable({ startISO, endISO }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await statsService.getDealerPayments(startISO, endISO);
        if (!cancelled) setData(res);
      } catch (err) {
        console.error("Error cargando pagos a dealers", err);
        if (!cancelled) setData({ summary: {}, dealers: [] });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [startISO, endISO]);

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-amber-500"></div>
    </div>
  );

  const dealers = data?.dealers || [];
  const s = data?.summary || {};

  if (dealers.length === 0) return (
    <div className="py-16 bg-gray-800/20 border-2 border-dashed border-gray-700 rounded-3xl flex flex-col items-center justify-center text-gray-500">
      <UserGroupIcon className="w-12 h-12 mb-4 opacity-20" />
      <p className="font-bold uppercase tracking-widest text-xs">Sin pagos a dealers en este periodo</p>
      <p className="text-[11px] mt-1 text-gray-600">Solo cuentan turnos de mesas ya cerradas</p>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* RESUMEN */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-gradient-to-br from-amber-900/20 to-transparent border border-amber-500/20 p-4 rounded-2xl">
          <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mb-1 flex items-center gap-1"><CurrencyDollarIcon className="w-3.5 h-3.5" /> Pago Club</p>
          <p className="text-xl font-black text-white font-mono">{formatMoney(s.club_payment || 0)}</p>
        </div>
        <div className="bg-gradient-to-br from-yellow-900/20 to-transparent border border-yellow-500/20 p-4 rounded-2xl">
          <p className="text-[10px] font-bold text-yellow-500 uppercase tracking-widest mb-1">🤝 Propinas</p>
          <p className="text-xl font-black text-white font-mono">{formatMoney(s.tips || 0)}</p>
        </div>
        <div className="bg-gradient-to-br from-gray-800/40 to-transparent border border-gray-600/30 p-4 rounded-2xl">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 flex items-center gap-1"><ClockIcon className="w-3.5 h-3.5" /> Horas</p>
          <p className="text-xl font-black text-white font-mono">{(s.total_hours || 0).toLocaleString('es-CO')}h</p>
        </div>
        <div className="bg-gradient-to-br from-emerald-900/20 to-transparent border border-emerald-500/20 p-4 rounded-2xl">
          <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-1">Total</p>
          <p className="text-xl font-black text-white font-mono">{formatMoney(s.grand_total || 0)}</p>
        </div>
      </div>

      {/* MÓVIL: cards */}
      <div className="md:hidden space-y-3">
        {dealers.map((d) => (
          <div key={d.dealer_id} className="bg-gray-800 border border-gray-700 rounded-xl p-4">
            <div className="flex justify-between items-start mb-3">
              <div className="min-w-0">
                <h3 className="font-bold text-white truncate flex items-center gap-2">
                  {d.name}
                  {!d.is_active && <span className="text-[8px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded-full uppercase">Inactivo</span>}
                </h3>
                <p className="text-[11px] text-gray-500">{d.sessions_count} mesa{d.sessions_count !== 1 ? 's' : ''} · {d.hours}h</p>
              </div>
              <p className="text-lg font-mono font-black text-emerald-400 shrink-0">{formatMoney(d.grand_total)}</p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="bg-gray-900/40 p-2 rounded-lg">
                <div className="text-gray-500 text-[9px] uppercase">Horas</div>
                <div className="font-mono text-white">{formatMoney(d.hour_payment)}</div>
              </div>
              <div className="bg-gray-900/40 p-2 rounded-lg">
                <div className="text-gray-500 text-[9px] uppercase">% Rake</div>
                <div className="font-mono text-white">{formatMoney(d.rake_commission)}</div>
              </div>
              <div className="bg-gray-900/40 p-2 rounded-lg">
                <div className="text-gray-500 text-[9px] uppercase">Propinas</div>
                <div className="font-mono text-yellow-400">{formatMoney(d.tips)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* DESKTOP: tabla */}
      <div className="hidden md:block overflow-x-auto bg-gray-800/40 border border-gray-700/50 rounded-2xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-widest text-gray-500 border-b border-gray-700">
              <th className="p-4">Dealer</th>
              <th className="p-4 text-right">Horas</th>
              <th className="p-4 text-right">Pago horas</th>
              <th className="p-4 text-right">% Rake</th>
              <th className="p-4 text-right">Pago club</th>
              <th className="p-4 text-right">Propinas</th>
              <th className="p-4 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {dealers.map((d) => (
              <tr key={d.dealer_id} className="hover:bg-gray-800/40 transition-colors">
                <td className="p-4 font-bold text-white">
                  {d.name}
                  {!d.is_active && <span className="ml-2 text-[8px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded-full uppercase">Inactivo</span>}
                  <div className="text-[10px] text-gray-500 font-normal">{d.sessions_count} mesa{d.sessions_count !== 1 ? 's' : ''} · {d.shifts_count} turno{d.shifts_count !== 1 ? 's' : ''}</div>
                </td>
                <td className="p-4 text-right font-mono text-gray-300">{d.hours}h</td>
                <td className="p-4 text-right font-mono text-gray-300">{formatMoney(d.hour_payment)}</td>
                <td className="p-4 text-right font-mono text-gray-300">{formatMoney(d.rake_commission)}</td>
                <td className="p-4 text-right font-mono text-white font-bold">{formatMoney(d.club_payment)}</td>
                <td className="p-4 text-right font-mono text-yellow-400">{formatMoney(d.tips)}</td>
                <td className="p-4 text-right font-mono text-emerald-400 font-black">{formatMoney(d.grand_total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-700 text-sm font-black">
              <td className="p-4 text-gray-400 uppercase text-[10px] tracking-widest">Total</td>
              <td className="p-4 text-right font-mono text-gray-300">{(s.total_hours || 0)}h</td>
              <td className="p-4"></td>
              <td className="p-4"></td>
              <td className="p-4 text-right font-mono text-white">{formatMoney(s.club_payment || 0)}</td>
              <td className="p-4 text-right font-mono text-yellow-400">{formatMoney(s.tips || 0)}</td>
              <td className="p-4 text-right font-mono text-emerald-400">{formatMoney(s.grand_total || 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-[10px] text-gray-600 text-center italic">
        El "Pago club" es lo que el club le paga al dealer (horas + % del rake). Las propinas son del dealer.
        Solo se cuentan turnos de mesas ya cerradas.
      </p>
    </div>
  );
}
