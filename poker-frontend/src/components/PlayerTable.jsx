import { useState, useEffect, Fragment } from 'react';
import { ChevronDownIcon, ChevronUpIcon, ClockIcon } from '@heroicons/react/24/solid';
import api from '../api/axios';
import { formatMoney } from '../utils/formatters';
import { transactionService } from '../api/services';

export default function PlayerTable({ refreshTrigger, sessionId, onPlayerSelect, onRefresh }) {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [totals, setTotals] = useState({ buyin: 0, cashout: 0, balance: 0 });
  const [expandedPlayerId, setExpandedPlayerId] = useState(null);

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
        const data = response.data;
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
    }
  };

  const formatTime = (dateString) => {
    if (!dateString) return '--:--';
    return new Date(dateString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const toggleRow = (playerId) => {
    setExpandedPlayerId(expandedPlayerId === playerId ? null : playerId);
  };

  if (loading) return <div className="text-gray-500 text-center py-10 animate-pulse">Cargando mesa...</div>;
  if (error) return <div className="text-red-400 text-center py-10 bg-red-900/10 rounded-xl border border-red-500/20">{error}</div>;
  if (players.length === 0) return <div className="text-gray-500 text-center py-10 italic bg-gray-800 rounded-xl border border-gray-700">Mesa vacía. Esperando jugadores...</div>;

  return (
    <div className="bg-gray-800 rounded-xl shadow-2xl border border-gray-700 overflow-hidden mt-6 animate-fade-in">
      <div className="overflow-x-auto">
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
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-700">
            {players.map((p) => {
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
                    className={`cursor-pointer transition-colors ${isExpanded ? 'bg-gray-700/50' : 'hover:bg-gray-750'}`}
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

  <div className="flex gap-2 text-[10px] mt-0.5 items-center">
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
                      <span className={`font-mono font-bold px-3 py-1.5 rounded-lg text-lg ${
                        p.current_balance >= 0 
                          ? 'bg-green-900/30 text-green-400 border border-green-500/30' 
                          : 'bg-red-900/30 text-red-400 border border-red-500/30'
                      }`}>
                        {formatMoney(p.current_balance)}
                      </span>
                    </td>
                  </tr>

                  {/* FILA EXPANDIDA */}
                  {isExpanded && (
                    <tr className="bg-gray-900/50 animate-fade-in border-b border-gray-700">
                      <td colSpan="7" className="p-0">
                        <div className="p-4 pl-14 grid grid-cols-1 md:grid-cols-2 gap-6">
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
                                    Revisa la consola (F12) para ver qué llegó en "transactions".
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
               <td className="p-4 text-right text-gray-500">-</td>
               <td className="p-4 text-right text-white font-mono text-xl">{formatMoney(totals.balance)}</td>
             </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}