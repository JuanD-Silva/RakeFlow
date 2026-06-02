// src/components/KPIDashboard.jsx
import { useEffect, useState } from 'react';
import api from '../api/axios';
import { historyService } from '../api/services';
import { formatMoney } from '../utils/formatters';
import {
  XMarkIcon,
  ClockIcon,
  TableCellsIcon,
  TrophyIcon,
} from '@heroicons/react/24/outline';

function formatDuration(minutes) {
  if (!minutes || minutes <= 0) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function KPIDashboard() {
  const [stats, setStats] = useState(null);
  const [quota, setQuota] = useState(null);
  const [error, setError] = useState(null);

  // Modal de "Horas operadas"
  const [showHoursModal, setShowHoursModal] = useState(false);
  const [historyItems, setHistoryItems] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    async function fetchStats() {
      try {
        const [dashRes, quotaRes] = await Promise.all([
          api.get('/stats/dashboard'),
          api.get('/stats/monthly-debt-quota')
        ]);
        setStats(dashRes.data);
        setQuota(quotaRes.data);
      } catch (e) {
        console.error("Error KPIs", e);
        setError("Error al cargar indicadores");
      }
    }
    fetchStats();
  }, []);

  const openHoursModal = async () => {
    setShowHoursModal(true);
    if (historyItems.length === 0) {
      setLoadingHistory(true);
      try {
        const data = await historyService.getAll();
        setHistoryItems(data || []);
      } catch (e) {
        console.error("Error cargando historial", e);
      } finally {
        setLoadingHistory(false);
      }
    }
  };

  if (error) return <div className="text-red-400 text-center py-6 bg-red-900/10 rounded-xl border border-red-500/20 mb-8">{error}</div>;
  if (!stats) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-gray-800/50 rounded-xl p-4 border border-gray-700 h-24 animate-pulse flex flex-col justify-center">
            <div className="h-3 w-1/2 bg-gray-700 rounded mb-3"></div>
            <div className="h-6 w-3/4 bg-gray-600 rounded"></div>
          </div>
        ))}
      </div>
    );
  }

  const Card = ({ title, value, sub, icon, color, onClick }) => (
    <div
      onClick={onClick}
      className={`bg-gray-800 rounded-xl p-4 border-l-4 ${color} shadow-lg flex items-center justify-between ${
        onClick ? 'cursor-pointer hover:bg-gray-750 hover:shadow-xl transition-all group' : ''
      }`}
    >
      <div>
        <p className="text-gray-400 text-xs uppercase font-bold tracking-wider flex items-center gap-1.5">
          {title}
          {onClick && <span className="text-[10px] text-blue-400 group-hover:text-blue-300">› ver detalle</span>}
        </p>
        <p className="text-2xl font-bold text-white font-mono mt-1">{value}</p>
        {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
      </div>
      <div className="text-3xl opacity-20 text-white select-none">{icon}</div>
    </div>
  );

  // Histórico ordenado por fecha desc + total de horas calculado
  const sortedHistory = [...historyItems].sort((a, b) => new Date(b.date) - new Date(a.date));
  const totalMinutes = sortedHistory.reduce((acc, it) => acc + (it.duration_minutes || 0), 0);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8 animate-fade-in">

        <Card
          title="Rake / Hora"
          value={`$${stats.avg_rake_hour?.toLocaleString() ?? 0}`}
          sub="Promedio Histórico"
          icon="⚡"
          color="border-yellow-500"
        />

        <Card
          title="Horas Operadas"
          value={`${stats.total_hours ?? 0}h`}
          sub={`${stats.total_sessions ?? 0} Sesiones cerradas`}
          icon="⏱️"
          color="border-blue-500"
          onClick={openHoursModal}
        />

        <Card
          title="Buy-in Promedio"
          value={`$${stats.avg_ticket?.toLocaleString() ?? 0}`}
          sub="Gasto por jugador"
          icon="🎟️"
          color="border-purple-500"
        />

        <Card
          title="Rake del Mes"
          value={quota ? formatMoney(quota.paid_so_far) : '$0'}
          sub={quota && quota.target > 0
            ? `${Math.min(100, (quota.paid_so_far / quota.target) * 100).toFixed(0)}% de la meta`
            : "Sin meta configurada"}
          icon="💰"
          color={quota && quota.remaining <= 0 ? "border-green-500" : "border-emerald-500"}
        />

        {quota && (
          <div className="sm:col-span-2 lg:col-span-4 bg-gray-800/80 border border-gray-700 rounded-xl p-4 shadow-lg">
            <div className="flex justify-between items-center mb-2">
              <p className="text-blue-400 text-xs font-bold uppercase tracking-wider">Meta Mensual</p>
              <div className="flex items-center gap-3">
                <span className="text-gray-500 text-xs font-mono">
                  {formatMoney(quota.paid_so_far)} / {formatMoney(quota.target)}
                </span>
                <span className={`text-sm font-black font-mono ${quota.remaining <= 0 ? 'text-green-400' : 'text-white'}`}>
                  {quota.target > 0 ? Math.min(100, (quota.paid_so_far / quota.target) * 100).toFixed(0) : 0}%
                </span>
              </div>
            </div>
            <div className="w-full bg-gray-700/50 rounded-full h-3 overflow-hidden border border-gray-700">
              <div
                className={`h-full rounded-full transition-all duration-1000 ease-out ${
                  quota.remaining <= 0
                    ? 'bg-gradient-to-r from-green-500 to-emerald-400'
                    : 'bg-gradient-to-r from-blue-600 to-cyan-500'
                }`}
                style={{ width: `${quota.target > 0 ? Math.min(100, (quota.paid_so_far / quota.target) * 100) : 0}%` }}
              ></div>
            </div>
          </div>
        )}
      </div>

      {/* MODAL: Detalle de horas operadas (sesiones cash + torneos) */}
      {showHoursModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowHoursModal(false)}>
          <div className="bg-gray-900 rounded-2xl border border-blue-500/30 shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="bg-gray-800 px-5 py-4 border-b border-gray-700 flex items-center justify-between">
              <div>
                <h3 className="text-white font-bold text-lg flex items-center gap-2">
                  <ClockIcon className="w-5 h-5 text-blue-400" />
                  Detalle de horas operadas
                </h3>
                <p className="text-gray-500 text-xs mt-0.5">
                  {sortedHistory.length} registros · {formatDuration(totalMinutes)} total
                </p>
              </div>
              <button onClick={() => setShowHoursModal(false)} className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white">
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loadingHistory ? (
                <div className="text-center py-16 text-gray-500">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-3"></div>
                  Cargando historial...
                </div>
              ) : sortedHistory.length === 0 ? (
                <div className="text-center py-16 text-gray-500 italic text-sm">
                  Aún no hay sesiones cerradas
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-900 sticky top-0">
                    <tr className="text-gray-400 text-xs uppercase tracking-wider">
                      <th className="text-left p-3 font-semibold">Tipo</th>
                      <th className="text-left p-3 font-semibold">Mesa / Torneo</th>
                      <th className="text-left p-3 font-semibold">Fecha</th>
                      <th className="text-right p-3 font-semibold">Duración</th>
                      <th className="text-right p-3 font-semibold text-emerald-400">Rake</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {sortedHistory.map((it) => (
                      <tr key={`${it.type}-${it.id}`} className="hover:bg-gray-800/50">
                        <td className="p-3">
                          {it.type === 'TOURNAMENT' ? (
                            <span className="inline-flex items-center gap-1.5 text-violet-400 text-xs font-bold uppercase tracking-wider">
                              <TrophyIcon className="w-3.5 h-3.5" /> Torneo
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-emerald-400 text-xs font-bold uppercase tracking-wider">
                              <TableCellsIcon className="w-3.5 h-3.5" /> Cash
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-white">{it.title}</td>
                        <td className="p-3 text-gray-400 font-mono text-xs">{formatDate(it.date)}</td>
                        <td className="p-3 text-right text-gray-300 font-mono">{formatDuration(it.duration_minutes)}</td>
                        <td className="p-3 text-right text-emerald-400 font-mono font-bold">{formatMoney(it.rake)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-900 border-t-2 border-gray-700">
                    <tr className="font-bold">
                      <td colSpan="3" className="p-3 text-gray-500 uppercase text-xs tracking-wider">Total</td>
                      <td className="p-3 text-right text-white font-mono">{formatDuration(totalMinutes)}</td>
                      <td className="p-3 text-right text-emerald-400 font-mono">
                        {formatMoney(sortedHistory.reduce((acc, it) => acc + (it.rake || 0), 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>

            <div className="bg-gray-800 px-5 py-3 border-t border-gray-700 flex justify-between items-center">
              <span className="text-xs text-gray-500">Para más detalle entra a la pestaña "Historial"</span>
              <button onClick={() => setShowHoursModal(false)} className="text-sm text-blue-400 hover:text-blue-300 font-bold">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
