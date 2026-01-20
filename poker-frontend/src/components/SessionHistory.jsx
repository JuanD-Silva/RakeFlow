import { useEffect, useState } from 'react';
import api from '../api/axios';
import { 
  CalendarIcon, 
  ClockIcon, 
  CurrencyDollarIcon, 
  UserGroupIcon, 
  ChevronRightIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';

export default function SessionHistory() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  useEffect(() => { fetchHistory(); }, []);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const res = await api.get('/sessions/?skip=0&limit=20');
      const closed = res.data.filter(s => s.status === 'CLOSED');
      setSessions(closed);
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleRowClick = async (session) => {
    setSelectedSession(session);
    setLoadingDetails(true);
    try {
      const res = await api.get(`/sessions/${session.id}/details`);
      setDetailData(res.data);
    } catch (error) {
      alert("Error al cargar detalles");
    } finally {
      setLoadingDetails(false);
    }
  };

  const getDuration = (start, end) => {
    if (!end) return "---";
    const diffMs = new Date(end) - new Date(start);
    const hrs = Math.floor(diffMs / 3600000);
    const mins = Math.round(((diffMs % 3600000) / 60000));
    return `${hrs}h ${mins}m`;
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('es-CO', {
      day: '2-digit', month: 'long', year: 'numeric'
    });
  };

  const formatTime = (dateString) => {
    return new Date(dateString).toLocaleTimeString('es-CO', {
      hour: '2-digit', minute: '2-digit'
    });
  };

  if (loading) return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-24 bg-gray-800/50 animate-pulse rounded-2xl border border-gray-700"></div>
      ))}
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto p-6 animate-fade-in">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tighter uppercase">Historial</h2>
          <p className="text-gray-500 text-xs font-bold tracking-widest uppercase">Registros de sesiones cerradas</p>
        </div>
        <button onClick={fetchHistory} className="p-2 bg-gray-800 hover:bg-gray-700 rounded-full transition-all text-gray-400">
          <ArrowPathIcon className="w-5 h-5" />
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="text-center py-32 bg-gray-800/20 border-2 border-dashed border-gray-700 rounded-3xl">
          <CalendarIcon className="w-12 h-12 mx-auto text-gray-600 mb-4" />
          <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">Aún no hay sesiones finalizadas</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {sessions.map((session) => (
            <div 
              key={session.id} 
              onClick={() => handleRowClick(session)}
              className="group bg-gray-800/40 hover:bg-gray-800 border border-gray-700/50 hover:border-blue-500/50 rounded-2xl p-5 cursor-pointer transition-all flex flex-col md:flex-row items-center justify-between gap-6"
            >
              <div className="flex items-center gap-5 w-full md:w-auto">
                <div className="w-12 h-12 bg-blue-600/10 rounded-xl flex items-center justify-center text-blue-500 border border-blue-500/20">
                  <CalendarIcon className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-white font-black uppercase tracking-tighter text-lg leading-none">#{session.id} — {formatDate(session.start_time)}</h3>
                  <div className="flex items-center gap-3 mt-1 text-gray-500 font-mono text-xs uppercase">
                    <span className="flex items-center gap-1"><ClockIcon className="w-3 h-3"/> {formatTime(session.start_time)}</span>
                    <span className="flex items-center gap-1 text-blue-400"><ClockIcon className="w-3 h-3"/> {getDuration(session.start_time, session.end_time)}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-8 w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 border-gray-700/50 pt-4 md:pt-0">
                <div className="text-right">
                  <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Rake Total</p>
                  <p className="text-xl font-black text-white font-mono">${session.declared_rake_cash?.toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-blue-500 font-bold uppercase tracking-widest">Meta Pagada</p>
                  <p className="text-xl font-black text-blue-400 font-mono">${session.debt_payment?.toLocaleString() || 0}</p>
                </div>
                <ChevronRightIcon className="w-5 h-5 text-gray-600 group-hover:text-blue-500 transition-colors hidden md:block" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* MODAL REDISEÑADO */}
      {selectedSession && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-gray-900 border border-gray-800 rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="p-6 border-b border-gray-800 flex justify-between items-center bg-gray-800/30">
              <div>
                <span className="text-blue-500 font-mono font-bold text-xs uppercase tracking-widest">Resumen de Resultados</span>
                <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Sesión #{selectedSession.id}</h3>
              </div>
              <button onClick={() => setSelectedSession(null)} className="w-10 h-10 flex items-center justify-center bg-gray-800 hover:bg-gray-700 rounded-full text-white transition-colors text-2xl">×</button>
            </div>

            <div className="overflow-y-auto p-8 space-y-8">
              {loadingDetails ? (
                <div className="flex flex-col items-center py-20 animate-pulse text-gray-600 font-mono text-sm uppercase">Cargando desglose financiero...</div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
  <div className="bg-gray-800/50 p-6 rounded-2xl border border-gray-700 text-center">
    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Rake Total</p>
    <p className="text-3xl font-black text-white font-mono mt-1">
      ${(selectedSession.declared_rake_cash || 0).toLocaleString()}
    </p>
  </div>
  
  <div className="bg-gray-800/50 p-6 rounded-2xl border border-gray-700 text-center">
    <p className="text-[10px] text-blue-500 font-bold uppercase tracking-widest">A Meta</p>
    <p className="text-3xl font-black text-blue-400 font-mono mt-1">
      ${(selectedSession.debt_payment || 0).toLocaleString()}
    </p>
  </div>
  
  <div className="bg-gray-800/50 p-6 rounded-2xl border border-gray-700 text-center">
    <p className="text-[10px] text-green-500 font-bold uppercase tracking-widest">A Socios</p>
    <p className="text-3xl font-black text-green-400 font-mono mt-1">
      {/* 🟢 AQUÍ ESTABA EL ERROR: Aseguramos que lea partner_profit */}
      ${(detailData?.distribution?.reduce((acc, dist) => acc + dist.amount, 0) || 0).toLocaleString()}
    </p>
  </div>
</div>

                  <div className="space-y-4">

                    <div className="space-y-4">
  <h4 className="text-xs font-black text-blue-400 uppercase tracking-widest flex items-center gap-2">
    <CurrencyDollarIcon className="w-4 h-4"/> Repartición de Utilidades
  </h4>
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
    {detailData?.distribution?.map((dist, i) => (
      <div 
        key={i} 
        className="bg-gray-800/80 border border-gray-700 p-4 rounded-2xl flex flex-col justify-between hover:border-gray-600 transition-colors"
      >
        <div className="flex justify-between items-start mb-2">
          <span className="text-gray-300 text-xs font-bold uppercase tracking-tighter">{dist.name}</span>
          {dist.percentage_applied > 0 && (
            <span className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-md font-mono">
              {(dist.percentage_applied * 100).toFixed(0)}%
            </span>
          )}
        </div>
        <span className="text-white font-mono font-bold text-xl">
          ${dist.amount.toLocaleString()}
        </span>
      </div>
    ))}
  </div>
</div>
                    <h4 className="text-xs font-black text-gray-500 uppercase tracking-widest flex items-center gap-2">
                      <UserGroupIcon className="w-4 h-4"/> Ranking de la Mesa
                    </h4>
                    <div className="bg-gray-800/30 rounded-2xl border border-gray-800 overflow-hidden">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-gray-900/50 text-gray-500 uppercase text-[10px] font-black tracking-widest">
                          <tr>
                            <th className="px-6 py-4">Jugador</th>
                            <th className="px-6 py-4 text-right">Compras</th>
                            <th className="px-6 py-4 text-right">Retiro</th>
                            <th className="px-6 py-4 text-right">Balance</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800 font-mono">
                          {detailData?.players?.map((p, i) => (
                            <tr key={i} className="hover:bg-gray-800/50 transition-colors">
                              <td className="px-6 py-4 font-bold text-white uppercase">{p.name}</td>
                              <td className="px-6 py-4 text-right text-gray-400">${p.buyin.toLocaleString()}</td>
                              <td className="px-6 py-4 text-right text-gray-400">${(p.cashout + p.jackpot).toLocaleString()}</td>
                              <td className={`px-6 py-4 text-right font-black ${p.balance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {p.balance >= 0 ? '+' : ''}{p.balance.toLocaleString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="p-6 bg-gray-800/30 border-t border-gray-800 text-right">
              <button onClick={() => setSelectedSession(null)} className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-xl text-xs uppercase tracking-widest transition-all">Cerrar Reporte</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}