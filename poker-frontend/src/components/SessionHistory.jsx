import { useEffect, useState } from 'react';
import api from '../api/axios';
import { historyService, tournamentService } from '../api/services';
import { formatMoney } from '../utils/formatters';
import ConfirmModal from './ConfirmModal';
import { 
  CalendarIcon, ClockIcon, CurrencyDollarIcon, UserGroupIcon, 
  ChevronRightIcon, ArrowPathIcon, TrashIcon, TrophyIcon, 
  BanknotesIcon
} from '@heroicons/react/24/outline';
import { TrophyIcon as TrophySolid } from '@heroicons/react/24/solid';

export default function SessionHistory() {
  const [historyItems, setHistoryItems] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // --- ESTADOS DEL MODAL ---
  const [selectedItem, setSelectedItem] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  
  // --- ESTADOS DE BORRADO ---
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState(null); 
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => { fetchHistory(); }, []);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const data = await historyService.getAll();
      setHistoryItems(data);
    } catch (error) { console.error(error); } finally { setLoading(false); }
  };

  const handleRowClick = async (item) => {
    setSelectedItem(item);
    setLoadingDetails(true);
    setDetailData(null); // Limpiar datos previos para evitar errores visuales
    
    try {
      if (item.type === 'TOURNAMENT') {
          // 🏆 CARGAR DETALLES DE TORNEO
          const data = await tournamentService.getDetails(item.id);
          setDetailData(data);
      } else {
          // 💵 CARGAR DETALLES DE CASH
          const res = await api.get(`/sessions/${item.id}/details`);
          setDetailData(res.data);
      }
    } catch (error) {
      console.error(error);
      alert("Error al cargar detalles. Revisa la consola.");
      setSelectedItem(null);
    } finally {
      setLoadingDetails(false);
    }
  };

  const promptDelete = (e, item) => {
    e.stopPropagation();
    setItemToDelete(item);
    setDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;
    setIsDeleting(true);
    try {
        const endpoint = itemToDelete.type === 'TOURNAMENT' ? `/tournaments/${itemToDelete.id}` : `/sessions/${itemToDelete.id}`;
        await api.delete(endpoint);
        setDeleteModalOpen(false);
        setItemToDelete(null);
        fetchHistory();
    } catch (error) { alert("Error al eliminar"); } finally { setIsDeleting(false); }
  };

  // --- FORMATTERS ---
  
  const formatDate = (dateString) => {
    if (!dateString) return "---";
    return new Date(dateString).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
  };

  const getDuration = (minutes) => {
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hrs}H ${mins}M`;
  };

  if (loading) return <div className="p-10 text-center text-gray-500 animate-pulse">Cargando historial...</div>;

  return (
    <div className="max-w-6xl mx-auto p-6 animate-fade-in">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tighter uppercase">HISTORIAL</h2>
          <p className="text-gray-500 text-xs font-bold tracking-widest uppercase">REGISTROS DE SESIONES Y TORNEOS CERRADOS</p>
        </div>
        <button onClick={fetchHistory} className="p-2 bg-gray-800 hover:bg-gray-700 rounded-full text-gray-400 border border-gray-700"><ArrowPathIcon className="w-5 h-5" /></button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {historyItems.map((item) => {
            const isTourney = item.type === 'TOURNAMENT';
            return (
                <div key={`${item.type}-${item.id}`} onClick={() => handleRowClick(item)}
                  className="group bg-gray-800/40 hover:bg-gray-800 border border-gray-700/50 hover:border-blue-500/50 rounded-2xl p-5 cursor-pointer transition-all flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden"
                >
                  <div className="flex items-center gap-5 w-full md:w-auto">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${isTourney ? 'bg-violet-600/10 text-violet-500 border-violet-500/20' : 'bg-blue-600/10 text-blue-500 border-blue-500/20'}`}>
                      {isTourney ? <TrophyIcon className="w-6 h-6" /> : <CalendarIcon className="w-6 h-6" />}
                    </div>
                    <div>
                      <h3 className="text-white font-black uppercase tracking-tighter text-lg leading-none">
                        {isTourney ? item.title : `#${item.id} — ${formatDate(item.date)}`}
                      </h3>
                      <div className="flex items-center gap-3 mt-1 text-gray-500 font-mono text-xs uppercase">
                        <span className="flex items-center gap-1"><ClockIcon className="w-3 h-3"/> {isTourney ? formatDate(item.date) : new Date(item.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                        <span className={`flex items-center gap-1 ${isTourney ? 'text-violet-400' : 'text-blue-400'}`}><ClockIcon className="w-3 h-3"/> {getDuration(item.duration_minutes)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-8 w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 border-gray-700/50 pt-4 md:pt-0">
                    <div className="text-right">
                      <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Rake Total</p>
                      <p className="text-xl font-black text-white font-mono">{formatMoney(item.rake)}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-[10px] font-bold uppercase tracking-widest ${isTourney ? 'text-violet-500' : 'text-blue-500'}`}>{isTourney ? 'Premios' : 'Meta Pagada'}</p>
                      <p className={`text-xl font-black font-mono ${isTourney ? 'text-violet-400' : 'text-blue-400'}`}>{formatMoney(item.secondary_metric)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={(e) => promptDelete(e, item)} className="p-2 text-gray-500 hover:text-red-500 hover:bg-red-500/10 rounded-full transition-colors z-10"><TrashIcon className="w-5 h-5" /></button>
                        <ChevronRightIcon className="w-5 h-5 text-gray-600 group-hover:text-blue-500 transition-colors hidden md:block" />
                    </div>
                  </div>
                </div>
            )
        })}
      </div>

      {/* --- MODAL DE DETALLES UNIFICADO --- */}
      {selectedItem && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fade-in">
           <div className={`bg-gray-900 border rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl ${selectedItem.type === 'TOURNAMENT' ? 'border-violet-900' : 'border-gray-800'}`}>
                
                {/* HEADER DEL MODAL */}
                <div className="p-6 border-b border-gray-800 flex justify-between items-center bg-gray-800/30">
                    <div>
                        <span className={`${selectedItem.type === 'TOURNAMENT' ? 'text-violet-500' : 'text-blue-500'} font-mono font-bold text-xs uppercase tracking-widest`}>Resumen Detallado</span>
                        <h3 className="text-2xl font-black text-white uppercase tracking-tighter">
                            {selectedItem.type === 'TOURNAMENT' ? selectedItem.title : `Sesión Cash #${selectedItem.id}`}
                        </h3>
                    </div>
                    <button onClick={() => setSelectedItem(null)} className="w-10 h-10 flex items-center justify-center bg-gray-800 hover:bg-gray-700 rounded-full text-white text-2xl">×</button>
                </div>

                {/* CONTENIDO DEL MODAL */}
                <div className="overflow-y-auto p-8 space-y-8 flex-1">
                    {loadingDetails || !detailData ? (
                        <div className="flex justify-center py-20 text-gray-500 animate-pulse font-bold uppercase tracking-widest">Cargando datos...</div>
                    ) : selectedItem.type === 'TOURNAMENT' ? (
                        
                        /* --- VISTA DE TORNEO --- */
                        <>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <DetailCard label="Pozo Bruto" value={formatMoney(detailData.financials.gross_pot)} color="text-white" />
                                <DetailCard label="Rake Club" value={formatMoney(detailData.financials.rake_total)} color="text-violet-400" />
                                <DetailCard label="Premios Pagados" value={formatMoney(detailData.financials.prizes_paid)} color="text-yellow-400" />
                                <DetailCard label="Jugadores" value={detailData.financials.players_count} color="text-gray-300" />
                            </div>
                            
                            <h4 className="text-xs font-black text-yellow-500 uppercase tracking-widest flex items-center gap-2 mt-4"><TrophySolid className="w-4 h-4"/> Tabla de Posiciones</h4>
                            <div className="bg-gray-800/30 rounded-2xl border border-gray-800 overflow-hidden">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-gray-900/50 text-gray-500 uppercase text-[10px] font-black tracking-widest">
                                        <tr><th className="px-6 py-4">#</th><th className="px-6 py-4">Jugador</th><th className="px-6 py-4 text-center">R/A</th><th className="px-6 py-4 text-right">Inversión</th><th className="px-6 py-4 text-right">Premio</th><th className="px-6 py-4 text-right">Profit</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-800 font-mono">
                                        {detailData.players.map((p) => (
                                            <tr key={p.player_id} className={`hover:bg-gray-800/50 ${p.rank <= 3 ? 'bg-yellow-500/5' : ''}`}>
                                                <td className={`px-6 py-4 font-black ${p.rank===1?'text-yellow-400':p.rank===2?'text-gray-300':p.rank===3?'text-orange-400':'text-gray-600'}`}>{p.rank}</td>
                                                <td className="px-6 py-4 font-bold text-white uppercase">{p.name}</td>
                                                <td className="px-6 py-4 text-center text-xs text-gray-500">R:{p.rebuys_count} A:{p.addons_count}</td>
                                                <td className="px-6 py-4 text-right text-gray-400">{formatMoney(p.invested)}</td>
                                                <td className="px-6 py-4 text-right font-bold text-yellow-400">{p.prize > 0 ? formatMoney(p.prize) : '-'}</td>
                                                <td className={`px-6 py-4 text-right font-black ${p.net_profit > 0 ? 'text-green-400' : 'text-red-400'}`}>{p.net_profit > 0 ? '+' : ''}{formatMoney(p.net_profit)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>

                    ) : (
                        
                        /* --- VISTA DE CASH (ARREGLADA) --- */
                        /* NOTA: Aquí usamos 'selectedItem.rake' (del historial unificado) en vez de variables antiguas */
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <DetailCard label="Rake Total" value={formatMoney(selectedItem.rake)} color="text-white" />
                                <DetailCard label="Entradas (Buyins)" value={formatMoney(selectedItem.total_in)} color="text-blue-400" />
                                <DetailCard label="Meta Pagada" value={formatMoney(selectedItem.secondary_metric)} color="text-green-400" />
                            </div>

                            {/* Repartición de Utilidades (Viene de detailData) */}
                            {detailData.distribution && (
                                <div className="space-y-4">
                                    <h4 className="text-xs font-black text-blue-400 uppercase tracking-widest flex items-center gap-2"><CurrencyDollarIcon className="w-4 h-4"/> Repartición</h4>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                        {detailData.distribution.map((dist, i) => (
                                            <div key={i} className="bg-gray-800/80 border border-gray-700 p-4 rounded-2xl flex flex-col justify-between">
                                                <div className="flex justify-between items-start mb-2">
                                                    <span className="text-gray-300 text-xs font-bold uppercase tracking-tighter">{dist.name}</span>
                                                    {dist.percent > 0 && <span className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-md font-mono">{(dist.percent * 100).toFixed(0)}%</span>}
                                                </div>
                                                <span className="text-white font-mono font-bold text-xl">{formatMoney(dist.amount)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Ranking Mesa Cash */}
                            <div className="bg-gray-800/30 rounded-2xl border border-gray-800 overflow-hidden">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-gray-900/50 text-gray-500 uppercase text-[10px] font-black tracking-widest">
                                        <tr><th className="px-6 py-4">Jugador</th><th className="px-6 py-4 text-right">Compras</th><th className="px-6 py-4 text-right">Retiro</th><th className="px-6 py-4 text-right">Balance</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-800 font-mono">
                                        {detailData.players?.map((p, i) => (
                                            <tr key={i} className="hover:bg-gray-800/50">
                                                <td className="px-6 py-4 font-bold text-white uppercase">{p.name}</td>
                                                <td className="px-6 py-4 text-right text-gray-400">{formatMoney(p.buyin)}</td>
                                                <td className="px-6 py-4 text-right text-gray-400">{formatMoney(p.cashout + (p.jackpot||0))}</td>
                                                <td className={`px-6 py-4 text-right font-black ${p.balance >= 0 ? 'text-green-400' : 'text-red-400'}`}>{p.balance >= 0 ? '+' : ''}{formatMoney(p.balance)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>
           </div>
        </div>
      )}

      <ConfirmModal isOpen={deleteModalOpen} onClose={() => setDeleteModalOpen(false)} onConfirm={confirmDelete} isDeleting={isDeleting} title="Eliminar Registro" message="Esta acción afectará los reportes históricos." />
    </div>
  );
}

function DetailCard({ label, value, color }) {
    return (
        <div className="bg-gray-800/50 p-6 rounded-2xl border border-gray-700 text-center">
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{label}</p>
            <p className={`text-2xl lg:text-3xl font-black font-mono mt-1 ${color}`}>{value}</p>
        </div>
    );
}