// src/components/KPIDashboard.jsx
import { useEffect, useRef, useState } from 'react';
import api from '../api/axios';
import { historyService } from '../api/services';
import { formatMoney, parseServerDate, clubLocale, clubTimeZone } from '../utils/formatters';
import {
  XMarkIcon,
  ClockIcon,
  TableCellsIcon,
  TrophyIcon,
  BanknotesIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import { useEscape } from '../hooks/useEscape';

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
  return parseServerDate(iso).toLocaleDateString(clubLocale(), { day: '2-digit', month: 'short', year: 'numeric', timeZone: clubTimeZone() });
}

export default function KPIDashboard({ startDate, endDate, netPeriodo = null } = {}) {
  const [stats, setStats] = useState(null);
  const [quota, setQuota] = useState(null);
  const [prevStats, setPrevStats] = useState(null);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Encadenar taps de ← dispara varios fetches: solo la respuesta del MÁS
  // reciente puede pintar (patrón reqSeq de WeeklyReport/GameControl).
  const fetchSeqRef = useRef(0);

  // Modal de "Horas operadas"
  const [showHoursModal, setShowHoursModal] = useState(false);
  const [historyItems, setHistoryItems] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    async function fetchStats() {
      const myReq = ++fetchSeqRef.current;
      setError(null);
      try {
        // Si recibimos rango (sincronizado con el periodo que el user navega
        // en WeeklyReport), lo pasamos al backend para que los KPIs reflejen
        // ese rango. Sin rango → default backend = mes en curso hora Colombia.
        let params = '';
        if (startDate && endDate) {
          const fmt = (d) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
          };
          params = `?start_date=${fmt(startDate)}&end_date=${fmt(endDate)}`;
        }
        // Periodo ANTERIOR para el KPI "vs anterior". Dos reglas de honestidad:
        // (1) si el periodo actual está EN CURSO, se compara la MISMA fracción
        //     transcurrida del anterior (martes: 2 días vs 2 días, no 2 vs 7 —
        //     si no, el KPI da rojo casi siempre a mitad de periodo);
        // (2) en vista mensual el anterior es el mes CALENDARIO, no "misma
        //     duración" (que metía días de dos meses).
        let prevParams = '';
        let comparacion = null;
        if (startDate && endDate) {
          const fmt2 = (d) => {
            const y = d.getFullYear();
            const m2 = String(d.getMonth() + 1).padStart(2, '0');
            const day2 = String(d.getDate()).padStart(2, '0');
            return `${y}-${m2}-${day2}`;
          };
          const dia = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
          const hoy = dia(new Date());
          const startD = dia(startDate);
          const endD = dia(endDate);
          const dur = Math.round((endD - startD) / 86400000) + 1;
          const esMes = startD.getDate() === 1 && startD.getMonth() === endD.getMonth()
            && endD.getDate() === new Date(endD.getFullYear(), endD.getMonth() + 1, 0).getDate();
          let prevStart, prevEndCompleto;
          if (esMes) {
            prevStart = new Date(startD.getFullYear(), startD.getMonth() - 1, 1);
            prevEndCompleto = new Date(startD.getFullYear(), startD.getMonth(), 0);
          } else {
            prevStart = new Date(startD); prevStart.setDate(prevStart.getDate() - dur);
            prevEndCompleto = new Date(startD); prevEndCompleto.setDate(prevEndCompleto.getDate() - 1);
          }
          const transcurridos = endD > hoy
            ? Math.max(1, Math.round((Math.min(+hoy, +endD) - startD) / 86400000) + 1)
            : dur;
          const parcial = transcurridos < dur;
          let prevEnd = new Date(prevStart); prevEnd.setDate(prevEnd.getDate() + transcurridos - 1);
          if (prevEnd > prevEndCompleto) prevEnd = prevEndCompleto;
          comparacion = { parcial, transcurridos };
          prevParams = `?start_date=${fmt2(prevStart)}&end_date=${fmt2(prevEnd)}`;
        }
        const [dashRes, quotaRes, prevRes] = await Promise.all([
          api.get(`/stats/dashboard${params}`),
          api.get(`/stats/monthly-debt-quota${params}`),
          prevParams ? api.get(`/stats/dashboard${prevParams}`).catch(() => ({ data: null })) : Promise.resolve({ data: null }),
        ]);
        if (myReq !== fetchSeqRef.current) return;
        setStats(dashRes.data);
        setQuota(quotaRes.data);
        setPrevStats(prevRes.data ? { ...prevRes.data, comparacion } : null);
      } catch (e) {
        if (myReq !== fetchSeqRef.current) return;
        console.error("Error KPIs", e);
        setError("No se pudieron cargar los indicadores");
      }
    }
    fetchStats();
  }, [startDate, endDate, reloadKey]);

  useEscape(() => setShowHoursModal(false), showHoursModal);

  const openHoursModal = async () => {
    setShowHoursModal(true);
    // SIEMPRE refetch y SIEMPRE filtrado al rango navegado: el modal cacheaba
    // TODO el historial del club y contradecía a la card que dice "del periodo"
    // — números que no cuadran con la card que los abrió.
    setLoadingHistory(true);
    try {
      const data = await historyService.getAll();
      const desde = new Date(startDate); desde.setHours(0, 0, 0, 0);
      const hasta = new Date(endDate); hasta.setHours(23, 59, 59, 999);
      const enRango = (data || []).filter((it) => {
        const f = parseServerDate(it.date || it.start_time || it.created_at);
        return !isNaN(f) && f >= desde && f <= hasta;
      });
      setHistoryItems(enRango);
    } catch (e) {
      console.error("Error cargando historial", e);
      setHistoryItems([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  // "No pude cargar" nunca se disfraza de "$0": error visible con Reintentar
  // (el backend ya no devuelve {} con 200 ante una excepción).
  if (error) return (
    <div className="text-center py-6 bg-red-900/10 rounded-xl border border-red-500/20 mb-8">
      <p className="text-red-300 font-bold mb-1">{error}</p>
      <p className="text-gray-400 text-sm mb-4">Esto NO significa que el periodo esté en cero — es un fallo de conexión.</p>
      <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm uppercase tracking-wider">Reintentar</button>
    </div>
  );
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

  const Card = ({ title, value, sub, Icon, border, iconColor, valueColor = 'text-white', onClick }) => {
    const Tag = onClick ? 'button' : 'div';
    return (
      <Tag
        {...(onClick ? { type: 'button', onClick } : {})}
        className={`bg-gray-800 rounded-xl p-4 border ${border} shadow-lg flex items-center justify-between text-left w-full ${
          onClick ? 'cursor-pointer hover:bg-gray-700/50 hover:shadow-xl transition-all group' : ''
        }`}
      >
        <div className="min-w-0">
          <p className="text-gray-400 text-xs uppercase font-bold tracking-wider flex items-center gap-1.5">
            {title}
            {onClick && <span className="text-[10px] text-blue-400 group-hover:text-blue-300">› ver detalle</span>}
          </p>
          <p className={`text-2xl font-bold font-mono mt-1 truncate ${valueColor}`}>{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
        </div>
        {Icon && <Icon className={`w-9 h-9 shrink-0 ${iconColor}`} />}
      </Tag>
    );
  };

  // KPIs del DUEÑO: cuánto quedó, cómo va vs el periodo anterior, a quién le
  // debo — las preguntas del lunes. Las métricas de operación (rake/hora,
  // ticket) viven en el detalle de horas y en Estadísticas.
  const rakeActual = stats.rake_range ?? null;
  const rakePrevio = prevStats?.rake_range ?? null;
  const delta = rakeActual != null && rakePrevio != null ? rakeActual - rakePrevio : null;
  const deltaPct = delta != null && rakePrevio > 0 ? Math.round((delta / rakePrevio) * 100) : null;

  // Histórico ordenado por fecha desc + total de horas calculado
  const sortedHistory = [...historyItems].sort((a, b) => parseServerDate(b.date) - parseServerDate(a.date));
  const totalMinutes = sortedHistory.reduce((acc, it) => acc + (it.duration_minutes || 0), 0);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8 animate-fade-in">

        <Card
          title="Neto del periodo"
          value={netPeriodo != null ? formatMoney(netPeriodo) : formatMoney(rakeActual || 0)}
          sub={netPeriodo != null ? (netPeriodo < 0 ? 'Pérdida: los gastos superaron el rake' : 'Rake bruto − dealers y cortesías') : 'Rake bruto del periodo'}
          Icon={BanknotesIcon}
          border={netPeriodo != null && netPeriodo < 0 ? 'border-red-500/40' : 'border-emerald-500/30'}
          iconColor={netPeriodo != null && netPeriodo < 0 ? 'text-red-400' : 'text-emerald-400'}
          valueColor={netPeriodo != null && netPeriodo < 0 ? 'text-red-300' : 'text-white'}
        />

        <Card
          title="Vs periodo anterior"
          value={deltaPct != null ? `${delta >= 0 ? '+' : ''}${deltaPct}%` : (delta != null ? `${delta >= 0 ? '+' : ''}${formatMoney(delta)}` : '—')}
          sub={rakePrevio != null
            ? `${prevStats?.comparacion?.parcial ? `Mismos ${prevStats.comparacion.transcurridos} días del anterior · ` : ''}${formatMoney(rakeActual || 0)} vs ${formatMoney(rakePrevio)}`
            : 'Sin datos del periodo anterior'}
          Icon={delta != null && delta < 0 ? ArrowTrendingDownIcon : ArrowTrendingUpIcon}
          border={delta != null && delta < 0 ? 'border-red-500/40' : 'border-blue-500/30'}
          iconColor={delta != null && delta < 0 ? 'text-red-400' : 'text-blue-400'}
          valueColor={delta != null && delta < 0 ? 'text-red-300' : 'text-white'}
        />

        <Card
          title="Jugadores del periodo"
          value={stats.players_range != null ? String(stats.players_range) : '—'}
          sub={stats.players_range != null
            ? (stats.new_players_range > 0
                ? `${stats.new_players_range} ${stats.new_players_range === 1 ? 'jugó' : 'jugaron'} por primera vez`
                : (stats.players_range > 0 ? 'Todos ya conocidos del club' : 'Nadie jugó en este periodo'))
            : 'Sin datos'}
          Icon={UserGroupIcon}
          border="border-violet-500/30"
          iconColor="text-violet-400"
        />

        <Card
          title="Horas operadas"
          value={`${stats.total_hours ?? 0}h`}
          sub={`${stats.total_sessions ?? 0} sesiones del periodo`}
          Icon={ClockIcon}
          border="border-blue-500/30"
          iconColor="text-blue-400"
          onClick={openHoursModal}
        />

        {quota && quota.target > 0 && (
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
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowHoursModal(false)} role="dialog" aria-modal="true" aria-label="Detalle de horas operadas">
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
