import { useEffect, useState, useCallback } from 'react';
import { TableCellsIcon, PlusIcon, TrashIcon, UserGroupIcon, ArrowsRightLeftIcon, XMarkIcon, SparklesIcon } from '@heroicons/react/24/solid';
import { tournamentService } from '../api/services';

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

  const load = useCallback(async () => {
    if (!tId) return;
    try { setView(await tournamentService.getTables(tId)); setErr(''); }
    catch { /* el panel sigue; mostrar lo último */ }
  }, [tId]);

  useEffect(() => { load(); }, [load, refreshTrigger]);

  const act = async (fn) => {
    setBusy(true); setErr('');
    try { const v = await fn(); if (v) setView(v); onUpdate?.(); }
    catch (e) { setErr(e?.response?.data?.detail || 'No se pudo completar la acción.'); }
    finally { setBusy(false); }
  };

  const createTable = () => act(() => tournamentService.createTables(tId, { max_seats: Number(newSeats) || 9, count: 1 }));
  const autoSeat = () => act(() => tournamentService.autoSeat(tId));
  const delTable = (id) => act(() => tournamentService.deleteTable(tId, id));
  const doMove = (playerId, tableId) => act(async () => {
    const v = await tournamentService.movePlayer(tId, playerId, tableId);
    setMoveFor(null);
    return v;
  });

  const { tables, unseated, total_seats, total_seated, total_available } = view;

  return (
    <div className="mt-4 bg-gray-900/50 p-4 rounded-2xl border border-violet-500/20">
      {/* HEADER + TOTAL CUPOS */}
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h3 className="text-white text-xs font-black uppercase tracking-wider flex items-center gap-2">
          <TableCellsIcon className="w-4 h-4 text-violet-400" /> Mesas
        </h3>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="px-2 py-1 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 font-mono">
            {total_seated}/{total_seats} sentados
          </span>
          <span className={`px-2 py-1 rounded-lg font-bold font-mono ${total_available > 0 ? 'bg-emerald-600/20 border border-emerald-500/40 text-emerald-300' : 'bg-gray-800 border border-gray-700 text-gray-500'}`}>
            {total_available} cupo{total_available === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {/* SIN MESA + AUTO-SENTAR */}
      {unseated.length > 0 && (
        <div className="mb-3 bg-amber-950/30 border border-amber-500/30 rounded-xl p-2.5 flex items-center justify-between gap-2 flex-wrap">
          <span className="text-amber-300 text-[11px] font-bold">
            {unseated.length} jugador{unseated.length === 1 ? '' : 'es'} sin mesa
          </span>
          <button type="button" onClick={autoSeat} disabled={busy || tables.length === 0}
            className="text-[10px] font-black uppercase px-3 py-1.5 rounded-lg bg-amber-500 text-gray-900 hover:bg-amber-400 disabled:opacity-50 flex items-center gap-1">
            <SparklesIcon className="w-3.5 h-3.5" /> Auto-sentar
          </button>
        </div>
      )}

      {err && <p className="text-red-400 text-xs font-bold mb-2">{err}</p>}

      {/* MESAS */}
      {tables.length === 0 ? (
        <p className="text-gray-600 text-xs text-center py-3 italic">Sin mesas. Creá una para sentar a los jugadores.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {tables.map((t) => (
            <div key={t.id} className="bg-gray-900/60 border border-gray-700/60 rounded-xl p-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-violet-300 text-xs font-black uppercase flex items-center gap-1.5">
                  <UserGroupIcon className="w-3.5 h-3.5" /> Mesa {t.table_number}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${t.seats_available > 0 ? 'bg-emerald-600/20 text-emerald-300' : 'bg-gray-800 text-gray-500'}`}>
                    {t.seated_count}/{t.max_seats}
                  </span>
                  <button type="button" onClick={() => delTable(t.id)} disabled={busy}
                    className="p-1 text-gray-600 hover:text-red-400 disabled:opacity-40" title="Borrar mesa">
                    <TrashIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {t.players.length === 0 ? (
                <p className="text-gray-600 text-[11px] italic py-1">Vacía</p>
              ) : (
                <div className="space-y-1">
                  {t.players.map((p) => (
                    <div key={p.player_id} className="flex items-center gap-2 text-xs">
                      <span className="shrink-0 w-5 text-center text-[10px] font-black text-gray-500 font-mono">{p.seat_number ?? '·'}</span>
                      <span className="flex-1 text-gray-200 truncate">{p.name}</span>
                      <button type="button" onClick={() => setMoveFor({ player_id: p.player_id, name: p.name })} disabled={busy}
                        className="p-1 text-gray-500 hover:text-violet-300 disabled:opacity-40" title="Mover de mesa">
                        <ArrowsRightLeftIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* SIN MESA: lista para sentar manual */}
      {unseated.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {unseated.map((u) => (
            <button key={u.player_id} type="button" onClick={() => setMoveFor({ player_id: u.player_id, name: u.name })} disabled={busy}
              className="text-[11px] px-2 py-1 rounded-lg bg-amber-950/40 border border-amber-500/30 text-amber-200 hover:bg-amber-900/40 disabled:opacity-40 flex items-center gap-1">
              {u.name} <ArrowsRightLeftIcon className="w-3 h-3" />
            </button>
          ))}
        </div>
      )}

      {/* CREAR MESA */}
      <div className="mt-3 flex items-center gap-2 pt-2.5 border-t border-gray-700/50">
        <label className="text-[10px] text-gray-500 uppercase font-bold">Cupos</label>
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
              {tables.map((t) => {
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
    </div>
  );
}
