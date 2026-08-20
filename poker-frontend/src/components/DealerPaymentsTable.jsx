import { useEffect, useState } from 'react';
import { statsService, dealerService } from '../api/services';
import { formatMoney } from '../utils/formatters';
import Modal from './Modal';
import { CurrencyDollarIcon, ClockIcon, UserGroupIcon, CheckCircleIcon } from '@heroicons/react/24/outline';

/**
 * Reporte de pagos a dealers en un rango (recibe startISO/endISO YYYY-MM-DD).
 * Pago del club = horas × tarifa + % del rake. Propinas aparte (son del dealer).
 * Solo cuenta turnos CERRADOS dentro del rango.
 * Liquidación: marcar pagado (ledger de caja). pendiente = pago club − pagado.
 */
export default function DealerPaymentsTable({ startISO, endISO }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [liquidating, setLiquidating] = useState(null); // dealer a liquidar

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const res = await statsService.getDealerPayments(startISO, endISO);
        if (!cancelled) setData(res);
      } catch (err) {
        console.error("Error cargando pagos a dealers", err);
        // La VERDAD: "no pude cargar" nunca se disfraza de "no hubo pagos" —
        // el dueño podía irse creyendo que no debe nada.
        if (!cancelled) { setData(null); setLoadError(true); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [startISO, endISO, reloadKey]);

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-amber-500"></div>
    </div>
  );

  if (loadError) return (
    <div className="text-center py-10 bg-red-900/10 rounded-xl border border-red-500/20">
      <p className="text-red-300 font-bold mb-3">No se pudieron cargar los pagos a dealers.</p>
      <p className="text-gray-400 text-sm mb-4">Esto NO significa que no haya deudas — es un fallo de conexión.</p>
      <button onClick={() => setReloadKey((k) => k + 1)} className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-sm uppercase tracking-wider">Reintentar</button>
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

  // Contexto del dealer: mesas cash + torneos + turnos, omitiendo lo que sea 0.
  // Así un dealer solo de torneos no muestra "0 mesas".
  const ctx = (d) => {
    const parts = [];
    if (d.sessions_count > 0) parts.push(`${d.sessions_count} mesa${d.sessions_count !== 1 ? 's' : ''}`);
    if (d.tournaments_count > 0) parts.push(`${d.tournaments_count} torneo${d.tournaments_count !== 1 ? 's' : ''}`);
    parts.push(`${d.shifts_count} turno${d.shifts_count !== 1 ? 's' : ''}`);
    return parts.join(' · ');
  };

  const onLiquidated = () => { setLiquidating(null); setReloadKey(k => k + 1); };
  // Misma honestidad que el ledger de socios: el sobrepago se dice, y un pago
  // registrado en un periodo que desborda este rango (ej. el mes) avisa para
  // que no lo vuelvas a registrar.
  const PaidBadge = ({ d }) => {
    const base = "text-[11px] px-2 py-0.5 rounded-full uppercase font-bold whitespace-nowrap";
    if (d.pending < 0) return <span className={`${base} bg-red-900/60 text-red-200`}>Pagado de más</span>;
    if (d.pending === 0) return <span className={`${base} bg-green-700/60 text-green-200`}>✓ Pagado</span>;
    if (d.paid_external) return <span className={`${base} bg-blue-900/60 text-blue-200`}>Registrado en otro periodo</span>;
    return <span className={`${base} bg-amber-700/60 text-amber-200`}>Pendiente</span>;
  };
  const pendingClass = (v) => (v < 0 ? 'text-red-300' : 'text-orange-400');

  return (
    <div className="space-y-5">
      {/* RESUMEN */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-gradient-to-br from-amber-900/20 to-transparent border border-amber-500/20 p-4 rounded-2xl">
          <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mb-1 flex items-center gap-1"><CurrencyDollarIcon className="w-3.5 h-3.5" /> Pago Club</p>
          <p className="text-xl font-black text-white font-mono">{formatMoney(s.club_payment || 0)}</p>
        </div>
        <div className="bg-gradient-to-br from-green-900/20 to-transparent border border-green-500/20 p-4 rounded-2xl">
          <p className="text-[10px] font-bold text-green-500 uppercase tracking-widest mb-1 flex items-center gap-1"><CheckCircleIcon className="w-3.5 h-3.5" /> Liquidado</p>
          <p className="text-xl font-black text-white font-mono">{formatMoney(s.paid || 0)}</p>
        </div>
        <div className="bg-gradient-to-br from-orange-900/20 to-transparent border border-orange-500/20 p-4 rounded-2xl">
          <p className="text-[10px] font-bold text-orange-400 uppercase tracking-widest mb-1">Pendiente</p>
          <p className="text-xl font-black text-white font-mono">{formatMoney(s.pending || 0)}</p>
        </div>
        <div className="bg-gradient-to-br from-yellow-900/20 to-transparent border border-yellow-500/20 p-4 rounded-2xl">
          <p className="text-[10px] font-bold text-yellow-500 uppercase tracking-widest mb-1">🤝 Propinas</p>
          <p className="text-xl font-black text-white font-mono">{formatMoney(s.tips || 0)}</p>
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
                  <PaidBadge d={d} />
                </h3>
                <p className="text-[11px] text-gray-500">{ctx(d)} · {d.hours}h</p>
              </div>
              <p className="text-lg font-mono font-black text-emerald-400 shrink-0">{formatMoney(d.club_payment)}</p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs mb-3">
              <div className="bg-gray-900/40 p-2 rounded-lg">
                <div className="text-gray-500 text-[9px] uppercase">Horas</div>
                <div className="font-mono text-white">{formatMoney(d.hour_payment)}</div>
              </div>
              <div className="bg-gray-900/40 p-2 rounded-lg">
                <div className="text-gray-500 text-[9px] uppercase">% Rake</div>
                <div className="font-mono text-white">{formatMoney(d.rake_commission)}</div>
              </div>
              <div className="bg-gray-900/40 p-2 rounded-lg">
                <div className="text-gray-500 text-[9px] uppercase">Pendiente</div>
                <div className={`font-mono ${pendingClass(d.pending)}`}>{formatMoney(d.pending)}</div>
              </div>
            </div>
            {d.pending > 0 && !d.paid_external && (
              <button onClick={() => setLiquidating(d)} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-2 rounded-lg transition-colors">
                Liquidar {formatMoney(d.pending)}
              </button>
            )}
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
              <th className="p-4 text-right">Pago club</th>
              <th className="p-4 text-right">Pagado</th>
              <th className="p-4 text-right">Pendiente</th>
              <th className="p-4 text-right">Propinas</th>
              <th className="p-4 text-center">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {dealers.map((d) => (
              <tr key={d.dealer_id} className="hover:bg-gray-800/40 transition-colors">
                <td className="p-4 font-bold text-white">
                  <span className="flex items-center gap-2">
                    {d.name}
                    {!d.is_active && <span className="text-[8px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded-full uppercase">Inactivo</span>}
                    <PaidBadge d={d} />
                  </span>
                  <div className="text-[10px] text-gray-500 font-normal">{ctx(d)}</div>
                </td>
                <td className="p-4 text-right font-mono text-gray-300">{d.hours}h</td>
                <td className="p-4 text-right font-mono text-white font-bold">{formatMoney(d.club_payment)}</td>
                <td className="p-4 text-right font-mono text-green-400">{formatMoney(d.paid)}</td>
                <td className={`p-4 text-right font-mono font-bold ${pendingClass(d.pending)}`}>{formatMoney(d.pending)}</td>
                <td className="p-4 text-right font-mono text-yellow-400">{formatMoney(d.tips)}</td>
                <td className="p-4 text-center">
                  {d.pending > 0 && !d.paid_external ? (
                    <button onClick={() => setLiquidating(d)} className="bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap">
                      Liquidar
                    </button>
                  ) : d.pending < 0 ? (
                    <span className="text-[11px] text-red-300 font-bold" title="Hay liquidaciones registradas por más de lo devengado en este periodo">revisa</span>
                  ) : (
                    <span className="text-[11px] text-green-500 font-bold">✓</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-700 text-sm font-black">
              <td className="p-4 text-gray-400 uppercase text-[10px] tracking-widest">Total</td>
              <td className="p-4 text-right font-mono text-gray-300">{(s.total_hours || 0)}h</td>
              <td className="p-4 text-right font-mono text-white">{formatMoney(s.club_payment || 0)}</td>
              <td className="p-4 text-right font-mono text-green-400">{formatMoney(s.paid || 0)}</td>
              <td className="p-4 text-right font-mono text-orange-400">{formatMoney(s.pending || 0)}</td>
              <td className="p-4 text-right font-mono text-yellow-400">{formatMoney(s.tips || 0)}</td>
              <td className="p-4"></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-[10px] text-gray-600 text-center italic">
        El "Pago club" (horas + % del rake) ya se descontó de la utilidad de socios al cerrar cada mesa.
        Liquidar solo registra que ya le entregaste la plata al dealer. Las propinas son del dealer.
        Los pagos cuentan en el periodo que liquidaste, no en el día que tocaste el botón.
      </p>

      {liquidating && (
        <LiquidarModal dealer={liquidating} startISO={startISO} endISO={endISO} onClose={() => setLiquidating(null)} onDone={onLiquidated} />
      )}
    </div>
  );
}

export function LiquidarModal({ dealer, startISO, endISO, onClose, onDone }) {
  const [amount, setAmount] = useState(String(Math.max(0, dealer.pending || 0)));
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    const value = Number(amount);
    if (!value || value <= 0) { setError('Ingresa un monto válido.'); return; }
    setError(null);
    setLoading(true);
    try {
      const payout = await dealerService.createPayout(dealer.dealer_id, {
        amount: value,
        method,
        note: note.trim() || null,
        period_start: startISO,
        period_end: endISO,
      });
      onDone({ amount: value, dealer, payout });
    } catch (err) {
      setError(err.response?.data?.detail || 'No se pudo registrar el pago.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={true} onClose={onClose} title={`Liquidar a ${dealer.name}`}>
      <form onSubmit={submit} className="space-y-4">
        <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-3 text-xs text-gray-400 space-y-1">
          <div className="flex justify-between"><span>Pago club (periodo):</span><span className="font-mono text-white">{formatMoney(dealer.club_payment)}</span></div>
          <div className="flex justify-between"><span>Ya pagado:</span><span className="font-mono text-green-400">{formatMoney(dealer.paid)}</span></div>
          <div className="flex justify-between font-bold"><span>Pendiente:</span><span className="font-mono text-orange-400">{formatMoney(dealer.pending)}</span></div>
        </div>

        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Monto a pagar</label>
          <input
            type="number" inputMode="numeric" value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono focus:border-emerald-500 focus:outline-none"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Método</label>
          <div className="flex gap-2">
            {[['cash', 'Efectivo'], ['transfer', 'Transferencia']].map(([val, lbl]) => (
              <button type="button" key={val} onClick={() => setMethod(val)}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${method === val ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Nota (opcional)</label>
          <input
            type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200}
            placeholder="Ej: pago semana"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-emerald-500 focus:outline-none"
          />
        </div>

        {error && <p className="text-red-400 text-xs">{error}</p>}

        <button type="submit" disabled={loading}
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-bold py-2.5 rounded-lg transition-colors">
          {loading ? 'Registrando…' : 'Registrar pago'}
        </button>
      </form>
    </Modal>
  );
}
