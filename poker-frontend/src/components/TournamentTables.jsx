import { useEffect, useState, useCallback } from 'react';
import { TableCellsIcon, PlusIcon, TrashIcon, UserGroupIcon, ArrowsRightLeftIcon, XMarkIcon, SparklesIcon, IdentificationIcon, ScaleIcon, ArrowPathRoundedSquareIcon } from '@heroicons/react/24/solid';
import { tournamentService, dealerService } from '../api/services';
import ConfirmModal from './ConfirmModal';

/**
 * Panel de mesas del torneo (Fase 1a). Crear mesas, ver ocupación/cupos por mesa
 * y total, auto-sentar a los que no tienen mesa, y mover jugadores entre mesas.
 * Controlado por el staff (vista torneo). Color del torneo: violeta.
 */
export default function TournamentTables({ tournament, refreshTrigger, onUpdate }) {
  const tId = tournament?.id;
  const [view, setView] = useState({ tables: [], unseated: [], total_seats: 0, total_seated: 0, total_available: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [newSeats, setNewSeats] = useState(9);
  const [moveFor, setMoveFor] = useState(null); // { player_id, name }
  const [dealerFor, setDealerFor] = useState(null); // { table_id, table_number, dealer_id }
  const [dealers, setDealers] = useState([]);
  const [plan, setPlan] = useState(null); // sugerencia de balanceo previsualizada
  const [planLoading, setPlanLoading] = useState(false);
  // Confirmaciones con el ConfirmModal de la app (nada de window.confirm):
  // { title, message, confirmText, run } — run se ejecuta al confirmar.
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    if (!tId) return;
    try { setView(await tournamentService.getTables(tId)); setErr(''); }
    catch { /* el panel sigue; mostrar lo último */ }
  }, [tId]);

  useEffect(() => { load(); }, [load, refreshTrigger]);
  // Lista de dealers para el picker de asignación.
  useEffect(() => { dealerService.list().then(setDealers).catch(() => {}); }, []);

  const act = async (fn) => {
    setBusy(true); setErr('');
    try { const v = await fn(); if (v) setView(v); onUpdate?.(); }
    catch (e) { setErr(e?.response?.data?.detail || 'No se pudo completar la acción.'); }
    finally { setBusy(false); }
  };

  const createTable = () => act(() => tournamentService.createTables(tId, { max_seats: Number(newSeats) || 9, count: 1 }));
  const autoSeat = () => act(() => tournamentService.autoSeat(tId));
  // Re-sorteo: mueve a TODOS los activos, así que siempre con confirmación.
  const reshuffle = () => setConfirm({
    title: 'Re-sortear sillas',
    message: 'Todos los jugadores activos cambiarán de mesa y silla. Los eliminados no participan.',
    confirmText: 'Sí, re-sortear',
    run: () => tournamentService.reshuffleSeats(tId),
  });
  const delTable = (t) => setConfirm({
    title: `Borrar Mesa ${t.table_number}`,
    message: t.seated_count > 0
      ? `Tiene ${t.seated_count} jugador${t.seated_count === 1 ? '' : 'es'} sentado${t.seated_count === 1 ? '' : 's'}: quedarán en lista de espera.`
      : 'La mesa está vacía.',
    confirmText: 'Sí, borrar',
    run: () => tournamentService.deleteTable(tId, t.id),
  });
  const doMove = (playerId, tableId) => act(async () => {
    const v = await tournamentService.movePlayer(tId, playerId, tableId);
    setMoveFor(null);
    return v;
  });
  // Asignar: primero sin force; si el dealer ya está en otra mesa (409), confirmar
  // antes de moverlo (no mover en silencio).
  const assignDealer = (tableId, dealerId) => act(async () => {
    try {
      const v = await tournamentService.assignTableDealer(tId, tableId, dealerId, false);
      setDealerFor(null);
      return v;
    } catch (e) {
      if (e?.response?.status === 409) {
        setConfirm({
          title: 'Dealer en otra mesa',
          message: 'Ese dealer ya está en otra mesa. ¿Moverlo a esta?',
          confirmText: 'Sí, moverlo',
          run: async () => {
            const v = await tournamentService.assignTableDealer(tId, tableId, dealerId, true);
            setDealerFor(null);
            return v;
          },
        });
        return null;
      }
      throw e;
    }
  });
  const removeDealer = (tableId) => act(async () => {
    const v = await tournamentService.endTableDealer(tId, tableId);
    setDealerFor(null);
    return v;
  });

  // Balanceo asistido: primero previsualiza el plan; el director aplica si quiere.
  const openPlan = async () => {
    setPlanLoading(true); setErr('');
    try {
      const p = await tournamentService.getRebalancePlan(tId);
      if (!p.any) {
        const w = (p.still_waiting || []).length;
        setErr(w > 0
          ? `Mesas niveladas; ${w} en espera (se abre otra mesa con 2+ esperando).`
          : 'Las mesas ya están niveladas.');
        return;
      }
      setPlan(p);
    } catch (e) { setErr(e?.response?.data?.detail || 'No se pudo calcular el balanceo.'); }
    finally { setPlanLoading(false); }
  };
  const applyRebalance = () => act(async () => {
    const v = await tournamentService.rebalance(tId);
    setPlan(null);
    return v;
  });

  const { tables, unseated, total_seats, total_seated, total_available } = view;
  const openTables = tables.filter((t) => t.status === 'OPEN');
  const closedCount = tables.length - openTables.length;
  // Resaltar "Nivelar" cuando las mesas en uso quedaron desparejas (diff ≥ 2),
  // o hay espera que ya puede sentarse (cupo en mesas en uso, o ≥2 para abrir reserva).
  const inUse = openTables.filter((t) => t.seated_count > 0);
  const sizes = inUse.map((t) => t.seated_count);
  const uneven = sizes.length >= 2 && Math.max(...sizes) - Math.min(...sizes) >= 2;
  const seatable = unseated.length > 0 && (inUse.some((t) => t.seats_available > 0) || (unseated.length >= 2 && openTables.length > inUse.length));
  const needsBalance = uneven || seatable;

  return (
    <div className="mt-4 bg-gray-900/50 p-4 rounded-2xl border border-violet-500/20">
      {/* HEADER + TOTAL CUPOS */}
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h3 className="text-white text-xs font-black uppercase tracking-wider flex items-center gap-2">
          <TableCellsIcon className="w-4 h-4 text-violet-400" /> Mesas
        </h3>
        <div className="flex items-center gap-2 text-[11px]">
          {total_seated >= 2 && (
            <button type="button" onClick={reshuffle} disabled={busy}
              className="px-2.5 py-1 rounded-lg border border-violet-500/40 text-violet-300 hover:bg-violet-500/10 disabled:opacity-50 font-bold uppercase text-[10px] flex items-center gap-1"
              title="Volver a sortear todas las sillas (mueve a todos los activos)">
              <ArrowPathRoundedSquareIcon className="w-3.5 h-3.5" /> Re-sortear
            </button>
          )}
          {openTables.length >= 2 && (
            <button type="button" onClick={openPlan} disabled={busy || planLoading}
              className={`px-2.5 py-1 rounded-lg border disabled:opacity-50 font-bold uppercase text-[10px] flex items-center gap-1 ${needsBalance ? 'border-amber-500/60 bg-amber-500/15 text-amber-300 animate-pulse' : 'border-violet-500/40 text-violet-300 hover:bg-violet-500/10'}`}
              title={needsBalance ? 'Las mesas están desparejas o hay jugadores por sentar' : 'Nivelar mesas'}>
              <ScaleIcon className="w-3.5 h-3.5" /> {planLoading ? '...' : 'Nivelar'}
            </button>
          )}
          <span className="px-2 py-1 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 font-mono">
            {total_seated}/{total_seats} sentados
          </span>
          <span className={`px-2 py-1 rounded-lg font-bold font-mono ${total_available > 0 ? 'bg-emerald-600/20 border border-emerald-500/40 text-emerald-300' : 'bg-gray-800 border border-gray-700 text-gray-500'}`}>
            {total_available} cupo{total_available === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {/* LISTA DE ESPERA + AUTO-SENTAR */}
      {unseated.length > 0 && (
        <div className="mb-3 bg-amber-950/30 border border-amber-500/30 rounded-xl p-2.5 flex items-center justify-between gap-2 flex-wrap">
          <span className="text-amber-300 text-[11px] font-bold">
            {unseated.length} en lista de espera
          </span>
          <button type="button" onClick={autoSeat} disabled={busy || openTables.length === 0}
            className="text-[10px] font-black uppercase px-3 py-1.5 rounded-lg bg-amber-500 text-gray-900 hover:bg-amber-400 disabled:opacity-50 flex items-center gap-1">
            <SparklesIcon className="w-3.5 h-3.5" /> Sortear sillas
          </button>
        </div>
      )}

      {err && <p className="text-red-400 text-xs font-bold mb-2">{err}</p>}

      {/* MESAS (solo OPEN; las cerradas por consolidación no se muestran) */}
      {openTables.length === 0 ? (
        <p className="text-gray-600 text-xs text-center py-3 italic">Sin mesas. Crea una para sentar a los jugadores.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {openTables.map((t) => (
            <div key={t.id} className="bg-gray-900/60 border border-gray-700/60 rounded-xl p-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-violet-300 text-xs font-black uppercase flex items-center gap-1.5">
                  <UserGroupIcon className="w-3.5 h-3.5" /> Mesa {t.table_number}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${t.seats_available > 0 ? 'bg-emerald-600/20 text-emerald-300' : 'bg-gray-800 text-gray-400'}`}>
                    {t.seated_count}/{t.max_seats}
                  </span>
                  <button type="button" onClick={() => delTable(t)} disabled={busy}
                    className="p-3.5 -mx-2 -my-1.5 text-gray-500 hover:text-red-400 disabled:opacity-40" title="Borrar mesa" aria-label={`Borrar Mesa ${t.table_number}`}>
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {/* Dealer de la mesa */}
              <button type="button" onClick={() => setDealerFor({ table_id: t.id, table_number: t.table_number, dealer_id: t.dealer_id })} disabled={busy}
                className={`w-full mb-1.5 flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg border ${t.dealer_id ? 'border-amber-500/30 bg-amber-950/20 text-amber-200' : 'border-dashed border-gray-700 text-gray-400 hover:text-amber-300 hover:border-amber-500/40'}`}>
                <IdentificationIcon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{t.dealer_name || 'Sin dealer — asignar'}</span>
              </button>
              {t.players.length === 0 ? (
                <p className="text-gray-600 text-[11px] italic py-1">Vacía</p>
              ) : (
                <div className="space-y-3">
                  {t.players.map((p) => (
                    <div key={p.player_id} className="flex items-center gap-2 text-xs">
                      <span className="shrink-0 w-5 text-center text-[10px] font-black text-gray-400 font-mono">{p.seat_number ?? '·'}</span>
                      <span className="flex-1 text-gray-200 truncate">{p.name}</span>
                      <button type="button" onClick={() => setMoveFor({ player_id: p.player_id, name: p.name })} disabled={busy}
                        className="p-3.5 -mx-2 -my-1 text-gray-400 hover:text-violet-300 disabled:opacity-40" title="Mover de mesa" aria-label={`Mover a ${p.name}`}>
                        <ArrowsRightLeftIcon className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* LISTA DE ESPERA nominal (FIFO): posición + nombre; tap para sentar manual */}
      {unseated.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {unseated.map((u, i) => (
            <button key={u.player_id} type="button" onClick={() => setMoveFor({ player_id: u.player_id, name: u.name })} disabled={busy}
              className="text-[11px] px-2 py-1 rounded-lg bg-amber-950/40 border border-amber-500/30 text-amber-200 hover:bg-amber-900/40 disabled:opacity-40 flex items-center gap-1">
              <span className="font-black text-amber-400">{i + 1}º</span> {u.name} <ArrowsRightLeftIcon className="w-3 h-3" />
            </button>
          ))}
        </div>
      )}

      {/* CREAR MESA */}
      <div className="mt-3 flex items-center gap-2 pt-2.5 border-t border-gray-700/50">
        <label className="text-[10px] text-gray-400 uppercase font-bold">Cupos</label>
        <input type="number" min="2" max="12" value={newSeats} onChange={(e) => setNewSeats(e.target.value)}
          className="w-14 bg-gray-800 border border-gray-600 focus:border-violet-500 rounded p-1 text-center text-white text-sm font-mono outline-none" />
        <button type="button" onClick={createTable} disabled={busy}
          className="text-[10px] font-bold uppercase px-3 py-1.5 rounded-lg border border-violet-500/40 text-violet-300 hover:bg-violet-500/10 disabled:opacity-50 flex items-center gap-1">
          <PlusIcon className="w-3.5 h-3.5" /> Crear mesa
        </button>
      </div>

      {/* PICKER DE MESA PARA MOVER */}
      {moveFor && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70" onClick={() => setMoveFor(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-4 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-white text-sm font-bold">Mover a <span className="text-violet-300">{moveFor.name}</span></h4>
              <button type="button" onClick={() => setMoveFor(null)} className="text-gray-500 hover:text-white"><XMarkIcon className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {openTables.map((t) => {
                const full = t.seats_available <= 0;
                return (
                  <button key={t.id} type="button" disabled={busy || full} onClick={() => doMove(moveFor.player_id, t.id)}
                    className={`p-2.5 rounded-xl border text-left ${full ? 'border-gray-800 text-gray-600 cursor-not-allowed' : 'border-violet-500/40 text-white hover:bg-violet-500/10'}`}>
                    <span className="block text-xs font-black uppercase">Mesa {t.table_number}</span>
                    <span className={`block text-[10px] font-mono ${full ? '' : 'text-emerald-300'}`}>{full ? 'Llena' : `${t.seats_available} cupo${t.seats_available === 1 ? '' : 's'}`}</span>
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={() => doMove(moveFor.player_id, null)} disabled={busy}
              className="mt-3 w-full text-[11px] font-bold uppercase py-2 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-50">
              Sacar de la mesa
            </button>
          </div>
        </div>
      )}

      {/* PICKER DE DEALER PARA LA MESA */}
      {dealerFor && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70" onClick={() => setDealerFor(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-4 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-white text-sm font-bold">Dealer de la <span className="text-violet-300">Mesa {dealerFor.table_number}</span></h4>
              <button type="button" onClick={() => setDealerFor(null)} className="text-gray-500 hover:text-white"><XMarkIcon className="w-5 h-5" /></button>
            </div>
            {err && <p className="text-red-400 text-xs font-bold mb-2">{err}</p>}
            <div className="max-h-[40vh] overflow-y-auto space-y-1.5">
              {dealers.length === 0 && <p className="text-gray-600 text-xs italic py-2">No hay dealers. Crea uno en Configuración.</p>}
              {dealers.map((d) => (
                <button key={d.id} type="button" disabled={busy} onClick={() => assignDealer(dealerFor.table_id, d.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl border text-left ${dealerFor.dealer_id === d.id ? 'border-amber-500/50 bg-amber-950/30 text-amber-200' : 'border-gray-700 text-white hover:bg-amber-500/10'}`}>
                  <IdentificationIcon className="w-4 h-4 shrink-0 text-amber-300" />
                  <span className="flex-1 text-sm truncate">{d.name}</span>
                  {dealerFor.dealer_id === d.id && <span className="text-[10px] text-amber-300 font-bold">EN MESA</span>}
                </button>
              ))}
            </div>
            {dealerFor.dealer_id && (
              <button type="button" onClick={() => removeDealer(dealerFor.table_id)} disabled={busy}
                className="mt-3 w-full text-[11px] font-bold uppercase py-2 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-50">
                Sacar dealer de la mesa
              </button>
            )}
          </div>
        </div>
      )}

      {closedCount > 0 && (
        <p className="mt-2 text-[10px] text-gray-500 text-center">{closedCount} mesa{closedCount === 1 ? '' : 's'} cerrada{closedCount === 1 ? '' : 's'} por consolidación.</p>
      )}

      {/* MODAL: previsualización del balanceo (sugerir + aplicar) */}
      {plan && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70" onClick={() => setPlan(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-4 w-full max-w-sm max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-white text-sm font-bold flex items-center gap-1.5"><ScaleIcon className="w-4 h-4 text-violet-400" /> Nivelar mesas</h4>
              <button type="button" onClick={() => setPlan(null)} className="text-gray-500 hover:text-white"><XMarkIcon className="w-5 h-5" /></button>
            </div>
            <p className="text-[11px] text-gray-400 mb-2">Se sugieren estos movimientos:</p>
            <div className="space-y-1.5 mb-3">
              {plan.moves.map((m) => (
                <div key={m.player_id} className="flex items-center gap-2 text-xs bg-gray-800/60 rounded-lg px-2.5 py-1.5">
                  <span className="flex-1 text-white truncate">{m.player_name}</span>
                  <span className="text-gray-500 font-mono shrink-0">{m.from_table_number != null ? `M${m.from_table_number}` : 'Espera'} <ArrowsRightLeftIcon className="w-3 h-3 inline text-violet-400" /> M{m.to_table_number}</span>
                </div>
              ))}
              {plan.moves.length === 0 && <p className="text-[11px] text-gray-500 italic">Sin movimientos de jugadores.</p>}
            </div>
            {plan.close_tables.length > 0 && (
              <p className="text-[11px] text-amber-300 mb-3">Se cerrará{plan.close_tables.length === 1 ? '' : 'n'} la{plan.close_tables.length === 1 ? '' : 's'} mesa{plan.close_tables.length === 1 ? '' : 's'} {plan.close_tables.map((c) => c.table_number).join(', ')} (consolidación).</p>
            )}
            {(plan.still_waiting || []).length > 0 && (
              <p className="text-[11px] text-gray-400 mb-3">Quedan en espera: {plan.still_waiting.map((w) => w.player_name).join(', ')} (se abre otra mesa con 2+ esperando).</p>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => setPlan(null)} className="flex-1 text-[11px] font-bold uppercase py-2.5 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700">Cancelar</button>
              <button type="button" onClick={applyRebalance} disabled={busy}
                className="flex-1 text-[11px] font-black uppercase py-2.5 rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50">
                {busy ? '...' : 'Aplicar'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => { const { run } = confirm; setConfirm(null); act(run); }}
        title={confirm?.title}
        message={confirm?.message}
        confirmText={confirm?.confirmText}
        isDeleting={busy}
        loadingText="Aplicando..."
      />
    </div>
  );
}
