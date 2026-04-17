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
      try {
        setError(null);
        const response = await api.get('/sessions/current/players-stats');
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
  }, [refreshTrigger]);

  const togglePaid = async (player) => {
    if (!sessionId) return;
    // Optimista: actualizar UI inmediatamente
    setPlayers(prev => prev.map(p => p.player_id === player.player_id ? { ...p, has_pending_payment: !p.has_pending_payment } : p));
    try {
      await transactionService.togglePaid(player.player_id, sessionId, player.has_pending_payment); // si estaba pendiente (true), marcamos como pagado (true)
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error(err);
      // Revertir si falla
      setPlayers(prev => prev.map(p => p.player_id === player.player_id ? { ...p, has_pending_payment: player.has_pending_payment } : p));
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

  <div className="flex gap-2 text-[10px] mt-0.5">
      {buyins.length > 1 && <span className="text-emerald-400 font-mono">{buyins.length} entradas</span>}
      {p.total_jackpot > 0 && <span className="text-purple-400 font-bold">🎁 Jackpot</span>}
  </div>
</td>
                    <td className="p-4 text-center">
                      <button
                        onClick={(e) => { e.stopPropagation(); togglePaid(p); }}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider border transition-all active:scale-95 ${
                          p.has_pending_payment
                            ? 'bg-red-500/10 border-red-500/40 text-red-400 hover:bg-red-500/20'
                            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                        }`}
                        title={p.has_pending_payment ? "Click para marcar como pagado" : "Click para marcar como pendiente"}
                      >
                        {p.has_pending_payment ? '⏳ Debe' : '✓ Pagó'}
                      </button>
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
                             <h4 className="text-emerald-400 text-xs font-bold uppercase tracking-widest mb-3 flex items-center gap-2">
                               <ClockIcon className="w-3 h-3" /> Historial de Entradas
                             </h4>
                             {/* 👇 OJO: Si sale esto, buyins.length es 0 */}
                             {buyins.length > 0 ? (
                               <ul className="space-y-2">
                                 {buyins.map((tx, idx) => (
                                   <li key={idx} className="flex justify-between items-center text-sm p-2 rounded hover:bg-white/5 border border-transparent hover:border-white/10 transition-colors">
                                     <div className="flex flex-col">
                                        <span className="text-white font-bold">{formatMoney(tx.amount)}</span>
                                        <span className="text-[10px] text-gray-500 uppercase">{tx.type}</span>
                                     </div>
                                     <div className="flex items-center gap-3">
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