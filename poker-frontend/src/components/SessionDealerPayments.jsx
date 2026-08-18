import { useEffect, useState } from 'react';
import { dealerService } from '../api/services';
import { formatMoney } from '../utils/formatters';
import Modal from './Modal';

/**
 * Control de pago a dealers de UNA mesa (en la mesa activa). Por cada dealer que
 * pasó por la mesa: cuánto se le debe (horas + % del rake), cuánto se le pagó y
 * lo pendiente, con "Marcar pagado" ligado a esta mesa. El turno en curso se
 * estima con las horas (el % del rake se suma al cerrarlo).
 *
 * Solo staff OWNER/MANAGER (el backend lo gatea; si un cajero lo llama, 403 y el
 * panel simplemente no aparece).
 */
export default function SessionDealerPayments({ sessionId, refreshTrigger }) {
  const [data, setData] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [paying, setPaying] = useState(null);

  // NO usamos un flag "loading" para gatear el render: el padre re-dispara el
  // refetch cada 15s, y ocultar la tarjeta en cada poll la haría parpadear y —
  // peor — desmontaría el modal de pago abierto, borrando lo que se escribía.
  // Mostramos los datos previos mientras se refetchea; solo el primer fetch
  // (data === null) no muestra nada.
  useEffect(() => {
    if (!sessionId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await dealerService.getSessionDealerPayments(sessionId);
        if (!cancelled) setData(res);
      } catch {
        if (!cancelled) setData(null); // 403 (cajero) o error → no mostramos nada
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId, refreshTrigger, reloadKey]);

  const dealers = data?.dealers || [];
  if (!data || dealers.length === 0) return null;

  const s = data.summary || {};
  const anyOpen = dealers.some((d) => d.has_open_shift);
  const onPaid = () => { setPaying(null); setReloadKey((k) => k + 1); };

  return (
    <div className="mt-2 bg-gray-800/30 border border-gray-700/50 rounded-xl p-3">
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Dealers de esta mesa</p>
        {s.pending > 0
          ? <span className="text-[10px] text-orange-400 font-bold">Pendiente {formatMoney(s.pending)}</span>
          : <span className="text-[10px] text-green-500 font-bold">Todo pagado ✓</span>}
      </div>

      <div className="space-y-2.5">
        {dealers.map((d) => (
          <div key={d.dealer_id} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-white text-sm font-bold truncate flex items-center gap-1.5">
                {d.name}
                {d.has_open_shift && (
                  <span className="text-[8px] bg-amber-700/50 text-amber-200 px-1.5 py-0.5 rounded-full uppercase font-bold shrink-0">en curso</span>
                )}
              </p>
              <p className="text-[11px] text-gray-500">
                {d.hours}h · a pagar <span className="text-emerald-400 font-mono">{formatMoney(d.club_payment)}</span>
                {d.paid > 0 && <span className="text-green-500"> · pagado {formatMoney(d.paid)}</span>}
              </p>
            </div>
            {d.pending > 0 ? (
              <button onClick={() => setPaying(d)}
                className="shrink-0 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg transition-colors active:scale-[0.98]">
                Marcar pagado
              </button>
            ) : d.overpaid > 0 ? (
              /* Se pagó contra el estimado y el cierre ajustó a la baja: que el
                 descuadre se VEA para cuadrar caja, no que desaparezca en un ✓. */
              <span className="shrink-0 text-[10px] text-red-400 font-bold">⚠ Sobre-pagado {formatMoney(d.overpaid)}</span>
            ) : (
              <span className="shrink-0 text-[10px] text-green-500 font-bold">✓ Pagado</span>
            )}
          </div>
        ))}
      </div>

      {anyOpen && (
        <p className="text-[10px] text-gray-600 mt-2.5 leading-snug">
          El turno en curso muestra solo las horas; el % del rake se suma al terminarlo.
        </p>
      )}

      {paying && (
        <PayModal dealer={paying} sessionId={sessionId} onClose={() => setPaying(null)} onDone={onPaid} />
      )}
    </div>
  );
}

function PayModal({ dealer, sessionId, onClose, onDone }) {
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
      await dealerService.createPayout(dealer.dealer_id, {
        amount: value,
        method,
        note: note.trim() || null,
        session_id: sessionId,   // liga el pago a ESTA mesa
      });
      onDone();
    } catch (err) {
      setError(err.response?.data?.detail || 'No se pudo registrar el pago.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={true} onClose={onClose} title={`Pagar a ${dealer.name}`}>
      <form onSubmit={submit} className="space-y-4">
        <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-3 text-xs text-gray-400 space-y-1">
          <div className="flex justify-between"><span>A pagar en esta mesa:</span><span className="font-mono text-white">{formatMoney(dealer.club_payment)}</span></div>
          <div className="flex justify-between"><span>Ya pagado:</span><span className="font-mono text-green-400">{formatMoney(dealer.paid)}</span></div>
          <div className="flex justify-between font-bold"><span>Pendiente:</span><span className="font-mono text-orange-400">{formatMoney(dealer.pending)}</span></div>
          {dealer.has_open_shift && (
            <p className="text-[10px] text-amber-400/80 pt-1">Turno en curso: el monto puede subir con el % del rake al cerrarlo.</p>
          )}
        </div>

        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Monto a pagar</label>
          <input type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono focus:border-emerald-500 focus:outline-none" autoFocus />
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
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200}
            placeholder="Ej: pago del turno"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-emerald-500 focus:outline-none" />
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
