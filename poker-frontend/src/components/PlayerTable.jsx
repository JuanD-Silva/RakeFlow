import { useState, useEffect, Fragment, useCallback } from 'react';
import { ChevronDownIcon, ChevronUpIcon, ClockIcon } from '@heroicons/react/24/solid';
import api from '../api/axios';
import { formatMoney, parseServerDate } from '../utils/formatters';
import { norm } from '../utils/text';
import { useToast, Toast } from './Toast';
import { transactionService, playerService } from '../api/services';
import { useAuth } from '../context/AuthContext';
import PlayerAppAccount from './PlayerAppAccount';

export default function PlayerTable({ refreshTrigger, sessionId, onPlayerSelect, onRefresh, onQuickAction }) {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [totals, setTotals] = useState({ buyin: 0, cashout: 0, balance: 0 });
  const [tableBonus, setTableBonus] = useState(0); // bono de mesa (sin jugador)
  const [expandedPlayerId, setExpandedPlayerId] = useState(null);
  const { toast, showToast, dismissToast } = useToast();
  const [search, setSearch] = useState('');
  const { isOwner, isManager } = useAuth();
  const canManageApp = isOwner || isManager; // invitar / desbloquear histórico

  // Estado de la cuenta del panel por jugador ({id: {has_account, invitation_pending,
  // history_unlocked, phone}}); un solo fetch al montar y al cambiar algo.
  const [accounts, setAccounts] = useState({});
  const loadAccounts = useCallback(async () => {
    if (!canManageApp) return;
    try {
      const all = await playerService.getAll();
      setAccounts(Object.fromEntries(all.map((pl) => [pl.id, pl])));
    } catch { /* silencioso: el bloque de cuenta simplemente no se muestra */ }
  }, [canManageApp]);
  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  useEffect(() => {
    const fetchStats = async () => {
      // Si no hay sessionId, no podemos pedir nada
      if (!sessionId) {
        setPlayers([]);
        setTotals({ buyin: 0, cashout: 0, balance: 0 });
        setLoading(false);
        return;
      }
      try {
        setError(null);
        const response = await api.get(`/sessions/${sessionId}/players-stats`);
        // Nuevo shape: { players, table_bonus }. Fallback a array (backend viejo).
        const raw = response.data;
        const data = Array.isArray(raw) ? raw : (raw.players || []);
        setTableBonus(Array.isArray(raw) ? 0 : (raw.table_bonus || 0));
        setPlayers(data);

        const newTotals = data.reduce((acc, p) => ({
          buyin: acc.buyin + p.total_buyin,
          cashout: acc.cashout + p.total_cashout,
          balance: acc.balance + p.current_balance
        }), { buyin: 0, cashout: 0, balance: 0 });

        setTotals(newTotals);
      } catch (err) {
        if (err.response?.status === 404) {
          setPlayers([]);
          setTotals({ buyin: 0, cashout: 0, balance: 0 });
        } else {
          console.error("Error cargando tabla:", err);
          setError("Error al cargar los jugadores");
        }
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [refreshTrigger, sessionId]);

  const togglePaid = async (player) => {
    if (!sessionId) return;
    // Si estaba pendiente (hay al menos una deuda), marcamos todas como pagadas.
    // Si todas estaban pagas, marcamos todas como pendientes.
    const newIsPaid = player.has_pending_payment;
    const prevSnapshot = players;
    setPlayers(prev => prev.map(p => {
      if (p.player_id !== player.player_id) return p;
      const updatedTxs = (p.transactions || []).map(t =>
        (t.type === 'BUYIN' || t.type === 'REBUY') ? { ...t, is_paid: newIsPaid } : t
      );
      return {
        ...p,
        has_pending_payment: !newIsPaid,
        paid_buyins_count: newIsPaid ? (p.buyins_count || 0) : 0,
        transactions: updatedTxs,
      };
    }));
    try {
      await transactionService.togglePaid(player.player_id, sessionId, newIsPaid);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error(err);
      setPlayers(prevSnapshot);
      // Rollback AVISADO: es el fiado — si el "ya me pagó" vuelve a "Debe"
      // en silencio, la deuda fantasma es la peor traición posible.
      showToast(err.response?.data?.detail || "No se pudo cambiar el pago. Reintenta.", "error");
    }
  };

  const toggleBust = async (player) => {
    if (!sessionId) return;
    const prevSnapshot = players;
    const newBusted = !player.is_busted;
    setPlayers(prev => prev.map(p => p.player_id === player.player_id
      ? { ...p, is_busted: newBusted, busted_at: newBusted ? new Date().toISOString() : null }
      : p
    ));
    try {
      await transactionService.toggleBust(player.player_id, sessionId);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error(err);
      setPlayers(prevSnapshot);
      showToast(err.response?.data?.detail || "No se pudo cambiar el estado de quiebra. Reintenta.", "error");
    }
  };

  const toggleTxPaid = async (player, tx) => {
    const prevSnapshot = players;
    const newIsPaid = !tx.is_paid;
    setPlayers(prev => prev.map(p => {
      if (p.player_id !== player.player_id) return p;
      const updatedTxs = (p.transactions || []).map(t =>
        t.id === tx.id ? { ...t, is_paid: newIsPaid } : t
      );
      const paidCount = updatedTxs.filter(t => (t.type === 'BUYIN' || t.type === 'REBUY') && t.is_paid).length;
      const totalCount = p.buyins_count || 0;
      return {
        ...p,
        paid_buyins_count: paidCount,
        has_pending_payment: paidCount < totalCount,
        transactions: updatedTxs,
      };
    }));
    try {
      await transactionService.togglePaidById(tx.id, newIsPaid);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error(err);
      setPlayers(prevSnapshot);
      showToast(err.response?.data?.detail || "No se pudo cambiar el pago de esa entrada. Reintenta.", "error");
    }
  };

  const formatTime = (dateString) => {
    if (!dateString) return '--:--';
    // El servidor manda UTC sin 'Z': sin parseServerDate el quebró salía +5h.
    return parseServerDate(dateString).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
  };

  const toggleRow = (playerId) => {
    setExpandedPlayerId(expandedPlayerId === playerId ? null : playerId);
  };

  if (loading) return <div className="text-gray-500 text-center py-10 animate-pulse">Cargando mesa...</div>;
  // Solo mostramos el error a pantalla completa si NO hay datos previos. Si ya
  // teníamos la mesa cargada, mantenemos los datos y el próximo refresh (timer o
  // al volver a la pestaña) reintenta solo: un fallo transitorio no la borra.
  if (error && players.length === 0) return <div className="text-red-400 text-center py-10 bg-red-900/10 rounded-xl border border-red-500/20">{error}</div>;
  if (players.length === 0) return <div className="text-gray-500 text-center py-10 italic bg-gray-800 rounded-xl border border-gray-700">Mesa vacía. Esperando jugadores...</div>;

  // Filtro solo de VISTA (sin tildes): los totales de la mesa siguen siendo de
  // todos. showSearch gobierna input Y filtro juntos: si la lista baja de 4 con
  // texto escrito, el filtro se apaga con el input (no queda trabado invisible).
  const showSearch = players.length > 3;
  const visiblePlayers = showSearch && search.trim()
    ? players.filter((p) => norm(p.name).includes(norm(search)))
    : players;

  return (
    <div className="bg-gray-800 rounded-xl shadow-2xl border border-gray-700 overflow-hidden mt-6 animate-fade-in">
      <Toast toast={toast} onDismiss={dismissToast} />
      {error && (
        <div className="text-amber-300 text-xs text-center py-1.5 bg-amber-900/20 border-b border-amber-500/20">
          ⚠ Reconectando… mostrando últimos datos
        </div>
      )}
      {showSearch && (
        <div className="p-3 border-b border-gray-700 bg-gray-900/50">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 Buscar jugador en la mesa..."
            className="w-full bg-gray-900 text-white border border-gray-600 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:border-emerald-500 placeholder-gray-500"
          />
        </div>
      )}
      {showSearch && search.trim() && visiblePlayers.length === 0 && (
        <div className="p-6 text-center text-gray-500 text-sm italic">Nadie coincide con “{search}”.</div>
      )}
      {/* MOVIL: cards apiladas */}
      <div className="md:hidden divide-y divide-gray-700">
        {visiblePlayers.map((p) => {
          const isExpanded = expandedPlayerId === p.player_id;
          const transactions = p.transactions || [];
          const buyins = transactions.filter(t => t.type === 'BUYIN' || t.type === 'REBUY');
          const totalCount = p.buyins_count || 0;
          const paidCount = p.paid_buyins_count || 0;
          const allPaid = totalCount > 0 && paidCount === totalCount;
          const mixed = paidCount > 0 && paidCount < totalCount;
          const payStyle = allPaid
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : mixed
            ? 'bg-amber-500/10 border-amber-500/40 text-amber-400'
            : 'bg-red-500/10 border-red-500/40 text-red-400';
          const payLabel = allPaid ? '✓ Pago' : mixed ? `${paidCount}/${totalCount} pagas` : '⏳ Debe';
          return (
            <div key={`m-${p.player_id}`} className="p-4">
              {/* HEADER: nombre + balance */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0 flex-1">
                  <button
                    onClick={() => onPlayerSelect(p)}
                    className="font-bold text-white text-base flex items-center gap-1 hover:text-blue-400 max-w-full"
                    title="Editar movimientos"
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="text-xs shrink-0">✏️</span>
                  </button>
                  <div className="flex flex-wrap gap-2 text-[10px] mt-1 items-center">
                    {p.is_vip && <span className="shrink-0 whitespace-nowrap bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider" title="Pilar del club — jugador VIP. Atenderlo bien.">💎 VIP</span>}
                    {buyins.length > 1 && <span className="text-emerald-400 font-mono">{buyins.length} entradas</span>}
                    {p.has_digital_payments && <span className="text-blue-300">📱 Digital</span>}
                    {p.is_busted && (
                      <span className="bg-red-500/15 border border-red-500/40 text-red-400 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                        💀 Quebró {p.busted_at ? `· ${formatTime(p.busted_at)}` : ''}
                      </span>
                    )}
                  </div>
                </div>
                <span className={`font-mono font-bold px-3 py-1.5 rounded-lg text-base shrink-0 whitespace-nowrap ${
                  p.current_balance >= 0
                    ? 'bg-green-900/30 text-green-400 border border-green-500/30'
                    : 'bg-red-900/30 text-red-400 border border-red-500/30'
                }`}>
                  {formatMoney(p.current_balance)}
                </span>
              </div>

              {/* ATAJOS POR FILA: el modelo mental real es "Pedro quiere otra
                  entrada / Pedro se va" — abre el form con el jugador ya
                  elegido (el grid de arriba sigue para jugadores nuevos). */}
              {onQuickAction && (
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => onQuickAction('buyin', p)}
                    className="flex-1 py-2.5 rounded-lg bg-emerald-600/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/25 text-xs font-bold uppercase tracking-wider transition-colors active:scale-[0.98]"
                  >
                    + Entrada
                  </button>
                  <button
                    onClick={() => onQuickAction('cashout', p)}
                    className="flex-1 py-2.5 rounded-lg bg-red-600/15 border border-red-500/40 text-red-300 hover:bg-red-600/25 text-xs font-bold uppercase tracking-wider transition-colors active:scale-[0.98]"
                  >
                    Cobrar
                  </button>
                </div>
              )}

              {/* MINI GRID DE MONTOS */}
              <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                <div className="bg-gray-900/40 p-2 rounded border border-gray-700">
                  <div className="text-emerald-500 text-[10px] uppercase tracking-wider">Buy-ins</div>
                  <div className="font-mono text-gray-200 text-sm">{formatMoney(p.total_buyin)}</div>
                </div>
                <div className="bg-gray-900/40 p-2 rounded border border-gray-700">
                  <div className="text-red-500 text-[10px] uppercase tracking-wider">Cashouts</div>
                  <div className="font-mono text-gray-200 text-sm">{p.total_cashout > 0 ? formatMoney(p.total_cashout) : '-'}</div>
                </div>
                {p.total_spend > 0 && (
                  <div className="bg-gray-900/40 p-2 rounded border border-gray-700">
                    <div className="text-amber-500 text-[10px] uppercase tracking-wider">Gastos</div>
                    <div className="font-mono text-red-300 text-sm">-{formatMoney(p.total_spend)}</div>
                  </div>
                )}
                {p.total_jackpot > 0 && (
                  <div className="bg-gray-900/40 p-2 rounded border border-gray-700">
                    <div className="text-purple-400 text-[10px] uppercase tracking-wider">Jackpot</div>
                    <div className="font-mono text-purple-300 text-sm">+{formatMoney(p.total_jackpot)}</div>
                  </div>
                )}
                {p.total_bonus > 0 && (
                  <div className="bg-gray-900/40 p-2 rounded border border-gray-700">
                    <div className="text-orange-400 text-[10px] uppercase tracking-wider">Bono</div>
                    <div className="font-mono text-orange-300 text-sm">+{formatMoney(p.total_bonus)}</div>
                  </div>
                )}
              </div>

              {/* ACCIONES: toggle pago + ver detalles */}
              <div className="flex gap-2">
                <button
                  onClick={() => togglePaid(p)}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border transition-all active:scale-95 ${payStyle}`}
                >
                  {payLabel}
                </button>
                <button
                  onClick={() => toggleRow(p.player_id)}
                  className="flex-1 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border border-gray-600 text-gray-300 bg-gray-800 hover:bg-gray-700 transition-all active:scale-95 flex items-center justify-center gap-1"
                >
                  {isExpanded ? <ChevronUpIcon className="w-3 h-3" /> : <ChevronDownIcon className="w-3 h-3" />}
                  {isExpanded ? 'Cerrar' : 'Detalles'}
                </button>
              </div>

              {/* DETALLES EXPANDIDOS */}
              {isExpanded && (
                <div className="mt-3 bg-gray-900/50 rounded-lg p-3 space-y-3 animate-fade-in">
                  <div className="md:col-span-2"><PlayerAppAccount playerId={p.player_id} account={accounts[p.player_id]} canManage={canManageApp} onChanged={loadAccounts} /></div>
                  <div className="flex items-center justify-between">
                    <h4 className="text-emerald-400 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1">
                      <ClockIcon className="w-3 h-3" /> Entradas
                    </h4>
                    <button
                      onClick={() => toggleBust(p)}
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border transition-all active:scale-95 ${
                        p.is_busted
                          ? 'bg-red-500/20 border-red-500/50 text-red-300'
                          : 'bg-gray-800 border-gray-600 text-gray-400'
                      }`}
                    >
                      {p.is_busted ? '💀 Quebró (deshacer)' : '💀 Quebró'}
                    </button>
                  </div>
                  {buyins.length > 0 ? (
                    <ul className="space-y-1.5">
                      {buyins.map((tx) => (
                        <li key={tx.id} className="flex justify-between items-center text-xs p-2 bg-gray-800/50 rounded border border-gray-700">
                          <div className="flex flex-col min-w-0">
                            <span className="text-white font-bold">{formatMoney(tx.amount)}</span>
                            <span className="text-[9px] text-gray-500 uppercase truncate">{tx.type} · {tx.method || 'CASH'} · {formatTime(tx.created_at)}</span>
                          </div>
                          <button
                            onClick={() => toggleTxPaid(p, tx)}
                            className={`text-[10px] font-bold uppercase px-2 py-1 rounded border transition-all active:scale-95 shrink-0 ml-2 ${
                              tx.is_paid
                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                : 'bg-red-500/10 border-red-500/40 text-red-400'
                            }`}
                          >
                            {tx.is_paid ? '✓ Pago' : '⏳ Debe'}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-gray-500 text-xs italic">Sin entradas.</p>
                  )}
                  {(p.total_jackpot > 0 || p.total_bonus > 0) && (
                    <div>
                      <h4 className="text-purple-400 text-[10px] font-bold uppercase tracking-widest mb-1.5">Premios y Bonos</h4>
                      <ul className="space-y-1.5">
                        {transactions.filter(t => t.type === 'JACKPOT_PAYOUT' || t.type === 'BONUS').map((tx, idx) => (
                          <li key={`${p.player_id}-pb-${idx}`} className={`flex justify-between items-center text-xs p-2 rounded border ${
                            tx.type === 'BONUS' ? 'bg-orange-900/10 border-orange-500/20' : 'bg-purple-900/10 border-purple-500/20'
                          }`}>
                            <span className={`font-bold ${tx.type === 'BONUS' ? 'text-orange-300' : 'text-purple-300'}`}>+{formatMoney(tx.amount)}</span>
                            <span className="text-gray-400 text-[10px]">{tx.type === 'BONUS' ? 'Bono' : 'Jackpot'} · {formatTime(tx.created_at)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* MOVIL: totales mesa */}
      {players.length > 0 && (
        <div className="md:hidden bg-gray-900 border-t-2 border-gray-600 p-4 flex flex-col gap-2">
          <div className="flex justify-between items-center text-xs uppercase tracking-wider">
            <span className="text-gray-500 font-bold">Totales mesa</span>
            {players.filter(p => p.has_pending_payment).length > 0 && (
              <span className="bg-red-500/10 border border-red-500/30 text-red-400 text-[10px] font-bold uppercase px-2 py-0.5 rounded">
                {players.filter(p => p.has_pending_payment).length} deben
              </span>
            )}
          </div>
          <div className="flex justify-between text-sm font-mono">
            <span className="text-emerald-500">Buy-ins: {formatMoney(totals.buyin)}</span>
            <span className="text-red-500">Out: {formatMoney(totals.cashout)}</span>
          </div>
          {tableBonus > 0 && (
            <div className="flex justify-between text-sm font-mono">
              <span className="text-orange-400">🎉 Bono mesa</span>
              <span className="text-orange-400">+{formatMoney(tableBonus)}</span>
            </div>
          )}
          <div className="flex justify-between items-center pt-1 border-t border-gray-700">
            <span className="text-gray-400 text-xs uppercase tracking-wider">Balance neto</span>
            <span className="font-mono font-bold text-white text-lg whitespace-nowrap">{formatMoney(totals.balance)}</span>
          </div>
        </div>
      )}

      {/* DESKTOP: tabla horizontal */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-900 text-gray-400 text-xs uppercase tracking-wider border-b border-gray-700">
              <th className="p-4 font-semibold w-10">#</th>
              <th className="p-4 font-semibold">Jugador</th>
              <th className="p-4 font-semibold text-center text-amber-400 w-20">Pago</th>
              <th className="p-4 font-semibold text-right text-green-400">Total Buy-ins</th>
              <th className="p-4 font-semibold text-right text-red-400">Cashouts</th>
              <th className="p-4 font-semibold text-right text-yellow-400">Gastos / Premios</th>
              <th className="p-4 font-semibold text-right text-white">Balance</th>
              <th className="p-4 font-semibold text-center w-40">Acciones</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-700">
            {visiblePlayers.map((p) => {
              const isExpanded = expandedPlayerId === p.player_id;
              const transactions = p.transactions || []; 
              
              // Filtro corregido
              const buyins = transactions.filter(t => 
                 t.type === 'BUYIN' || t.type === 'REBUY'
              );

              return (
                // 👇 AQUÍ ESTÁ LA SOLUCIÓN DEL ERROR ROJO
                <Fragment key={p.player_id}>
                  
                  {/* FILA PRINCIPAL */}
                  <tr 
                    onClick={() => toggleRow(p.player_id)} 
                    className={`cursor-pointer transition-colors ${isExpanded ? 'bg-gray-700/50' : 'hover:bg-gray-700/50'}`}
                  >
                    <td className="p-4 text-gray-500 text-center">
                      {isExpanded ? <ChevronUpIcon className="w-4 h-4 text-emerald-500" /> : <ChevronDownIcon className="w-4 h-4" />}
                    </td>
<td className="p-4">
  {/* 👇👇 COMIENZO DEL CAMBIO 👇👇 */}
  <div 
    onClick={(e) => {
      e.stopPropagation(); // ⛔ Importante: Evita que la fila se expanda/cierre al hacer clic aquí
      onPlayerSelect(p);   // ✅ Abre el modal de edición
    }}
    className="font-bold text-white text-lg cursor-pointer hover:text-blue-400 hover:underline decoration-dotted underline-offset-4 flex items-center gap-2 group w-fit select-none"
    title="Clic para editar movimientos"
  >
    {p.name}
    {/* Icono de lápiz (aparece al pasar el mouse) */}
    <span className="opacity-0 group-hover:opacity-100 text-xs bg-gray-700 px-1.5 py-0.5 rounded text-gray-300 font-normal transition-opacity">
      ✏️
    </span>
  </div>
  {/* 👆👆 FIN DEL CAMBIO 👆👆 */}

  <div className="flex flex-wrap gap-2 text-[10px] mt-0.5 items-center">
      {p.is_vip && <span className="shrink-0 whitespace-nowrap bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider" title="Pilar del club — jugador VIP. Atenderlo bien.">💎 VIP</span>}
      {buyins.length > 1 && <span className="text-emerald-400 font-mono">{buyins.length} entradas</span>}
      {p.total_jackpot > 0 && <span className="text-purple-400 font-bold">🎁 Jackpot</span>}
      {p.is_busted && (
        <span className="bg-red-500/15 border border-red-500/40 text-red-400 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
          💀 Quebró {p.busted_at ? `· ${formatTime(p.busted_at)}` : ''}
        </span>
      )}
  </div>
</td>
                    <td className="p-4 text-center">
                      {(() => {
                        const total = p.buyins_count || 0;
                        const paid = p.paid_buyins_count || 0;
                        const allPaid = total > 0 && paid === total;
                        const mixed = paid > 0 && paid < total;
                        const style = allPaid
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                          : mixed
                          ? 'bg-amber-500/10 border-amber-500/40 text-amber-400 hover:bg-amber-500/20'
                          : 'bg-red-500/10 border-red-500/40 text-red-400 hover:bg-red-500/20';
                        const label = allPaid
                          ? '✓ Pagó'
                          : mixed
                          ? `${paid}/${total} pagas`
                          : '⏳ Debe';
                        const tip = total > 1
                          ? (allPaid ? 'Click: marcar todas como pendientes' : 'Click: marcar todas como pagadas')
                          : (allPaid ? 'Click: marcar como pendiente' : 'Click: marcar como pagado');
                        return (
                          <button
                            onClick={(e) => { e.stopPropagation(); togglePaid(p); }}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider border transition-all active:scale-95 ${style}`}
                            title={tip}
                          >
                            {label}
                          </button>
                        );
                      })()}
                    </td>
                    <td className="p-4 text-right font-mono text-gray-200 text-lg">
                      <div className="flex items-center justify-end gap-2">
                        {formatMoney(p.total_buyin)}
                        {p.has_digital_payments ? <span title="Digital">📱</span> : <span title="Efectivo" className="opacity-30">💵</span>}
                      </div>
                    </td>
                    <td className="p-4 text-right font-mono text-gray-400">
                      {p.total_cashout > 0 ? formatMoney(p.total_cashout) : "-"}
                    </td>
                    <td className="p-4 text-right font-mono text-sm">
                      {p.total_spend > 0 && <div className="text-red-300">-{formatMoney(p.total_spend)}</div>}
                      {p.total_jackpot > 0 && <div className="text-purple-300">+{formatMoney(p.total_jackpot)}</div>}
                      {p.total_spend === 0 && p.total_jackpot === 0 && <span className="text-gray-600">-</span>}
                      {p.total_bonus > 0 && <div className="text-orange-400">+{formatMoney(p.total_bonus)} (Bono)</div>}
                    </td>
                    <td className="p-4 text-right">
                      <span className={`inline-block font-mono font-bold px-3 py-1.5 rounded-lg text-lg whitespace-nowrap ${
                        p.current_balance >= 0
                          ? 'bg-green-900/30 text-green-400 border border-green-500/30'
                          : 'bg-red-900/30 text-red-400 border border-red-500/30'
                      }`}>
                        {formatMoney(p.current_balance)}
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      {onQuickAction && (
                        <div className="flex items-center justify-center gap-1.5">
                          <button onClick={(e) => { e.stopPropagation(); onQuickAction('buyin', p); }}
                            className="px-3 py-2 rounded-lg bg-emerald-600/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/25 text-xs font-bold uppercase tracking-wider transition-colors active:scale-95">
                            + Entrada
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); onQuickAction('cashout', p); }}
                            className="px-3 py-2 rounded-lg bg-red-600/15 border border-red-500/40 text-red-300 hover:bg-red-600/25 text-xs font-bold uppercase tracking-wider transition-colors active:scale-95">
                            Cobrar
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>

                  {/* FILA EXPANDIDA */}
                  {isExpanded && (
                    <tr className="bg-gray-900/50 animate-fade-in border-b border-gray-700">
                      <td colSpan="8" className="p-0">
                        <div className="p-4 pl-14 grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="md:col-span-2"><PlayerAppAccount playerId={p.player_id} account={accounts[p.player_id]} canManage={canManageApp} onChanged={loadAccounts} /></div>
                          <div>
                             <div className="flex items-center justify-between mb-3 gap-2">
                               <h4 className="text-emerald-400 text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                                 <ClockIcon className="w-3 h-3" /> Historial de Entradas
                               </h4>
                               <button
                                 onClick={(e) => { e.stopPropagation(); toggleBust(p); }}
                                 className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border transition-all active:scale-95 ${
                                   p.is_busted
                                     ? 'bg-red-500/20 border-red-500/50 text-red-300 hover:bg-red-500/30'
                                     : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-red-900/20 hover:border-red-500/40 hover:text-red-400'
                                 }`}
                                 title={p.is_busted ? 'Deshacer quiebra' : 'Marcar como quebrado (sin cashout)'}
                               >
                                 {p.is_busted ? '💀 Quebró (deshacer)' : '💀 Quebró'}
                               </button>
                             </div>
                             {/* 👇 OJO: Si sale esto, buyins.length es 0 */}
                             {buyins.length > 0 ? (
                               <ul className="space-y-2">
                                 {buyins.map((tx) => (
                                   <li key={tx.id} className="flex justify-between items-center text-sm p-2 rounded hover:bg-white/5 border border-transparent hover:border-white/10 transition-colors">
                                     <div className="flex flex-col">
                                        <span className="text-white font-bold">{formatMoney(tx.amount)}</span>
                                        <span className="text-[10px] text-gray-500 uppercase">{tx.type}</span>
                                     </div>
                                     <div className="flex items-center gap-3">
                                        <button
                                          onClick={(e) => { e.stopPropagation(); toggleTxPaid(p, tx); }}
                                          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border transition-all active:scale-95 ${
                                            tx.is_paid
                                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                                              : 'bg-red-500/10 border-red-500/40 text-red-400 hover:bg-red-500/20'
                                          }`}
                                          title={tx.is_paid ? 'Click: marcar como pendiente' : 'Click: marcar como pagado'}
                                        >
                                          {tx.is_paid ? '✓ Pagó' : '⏳ Debe'}
                                        </button>
                                        <span className="text-[10px] bg-gray-800 px-2 py-1 rounded text-gray-400 border border-gray-700">
                                            {tx.method || 'CASH'}
                                        </span>
                                        <span className="text-gray-400 font-mono text-xs">
                                           {formatTime(tx.created_at)}
                                        </span>
                                     </div>
                                   </li>
                                 ))}
                               </ul>
                             ) : (
                               <div className="p-3 bg-red-900/20 border border-red-900/50 rounded text-red-200 text-sm">
                                  ⚠️ No hay detalles disponibles. <br/>
                                  <span className="text-xs opacity-70">
                                    No se pudieron cargar los movimientos. Recarga la página o revisa la conexión.
                                  </span>
                               </div>
                             )}
                          </div>
                          
                          {/* SECCIÓN DE PREMIOS (JACKPOT) */}
                          {(p.total_jackpot > 0 || p.total_bonus > 0) && (
  <div>
      <h4 className="text-purple-400 text-xs font-bold uppercase tracking-widest mb-3">
        Premios y Bonos
      </h4>
      <ul className="space-y-2">
      {transactions.filter(t => t.type === 'JACKPOT_PAYOUT' || t.type === 'BONUS').map((tx, idx) => (
          <li key={idx} className={`flex justify-between items-center text-sm p-2 rounded border mb-1
             ${tx.type === 'BONUS' 
                ? 'bg-orange-900/10 border-orange-500/20' // Estilo Naranja para Bonos
                : 'bg-purple-900/10 border-purple-500/20' // Estilo Morado para Jackpot
             }`}>
             
          <div className="flex flex-col">
             <span className={`font-bold ${tx.type === 'BONUS' ? 'text-orange-300' : 'text-purple-300'}`}>
                +{formatMoney(tx.amount)}
             </span>
             <span className="text-[9px] text-gray-400 uppercase">{tx.type === 'BONUS' ? 'Bono Casa' : 'Jackpot'}</span>
          </div>
          
          <span className="text-gray-400 font-mono text-xs">{formatTime(tx.created_at)}</span>
          </li>
      ))}
    </ul>
  </div>
)}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot className="bg-gray-900 border-t-2 border-gray-600">
             <tr className="font-bold">
               <td className="p-4 text-gray-500 text-center">-</td>
               <td className="p-4 text-gray-400 uppercase text-xs tracking-wider">Totales Mesa</td>
               <td className="p-4 text-center">
                 {players.filter(p => p.has_pending_payment).length > 0 && (
                   <span className="bg-red-500/10 border border-red-500/30 text-red-400 text-[10px] font-bold uppercase px-2 py-1 rounded">
                     {players.filter(p => p.has_pending_payment).length} deben
                   </span>
                 )}
               </td>
               <td className="p-4 text-right text-emerald-500 font-mono text-lg">{formatMoney(totals.buyin)}</td>
               <td className="p-4 text-right text-red-500 font-mono text-lg">{formatMoney(totals.cashout)}</td>
               <td className="p-4 text-right text-sm">
                 {tableBonus > 0
                   ? <div className="text-orange-400 whitespace-nowrap" title="Bono para toda la mesa (cortesía del club)">+{formatMoney(tableBonus)} <span className="text-[10px]">(Bono mesa)</span></div>
                   : <span className="text-gray-500">-</span>}
               </td>
               <td className="p-4 text-right text-white font-mono text-xl whitespace-nowrap">{formatMoney(totals.balance)}</td>
             </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
