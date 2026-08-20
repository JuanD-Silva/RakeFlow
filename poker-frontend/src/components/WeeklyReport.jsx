import { useEffect, useMemo, useState } from 'react';
import api from '../api/axios';
import KPIDashboard from '../components/KPIDashboard';
import DealerPaymentsTable from './DealerPaymentsTable';
import ExportMenu from './ExportMenu';
import { statsService, historyService } from '../api/services';
import { useAuth } from '../context/AuthContext';
import { buildDistributionModel, buildDealersModel } from '../utils/reportExport';
import { formatMoney } from '../utils/formatters';
import { 
  ArrowLeftIcon, 
  ArrowRightIcon, 
  UserGroupIcon, 
  CalendarDaysIcon,
  WalletIcon,
  ScaleIcon
} from '@heroicons/react/24/outline'; 

export default function WeeklyReport() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('week');
  const [referenceDate, setReferenceDate] = useState(new Date());
  const [reportTab, setReportTab] = useState('distribution'); // 'distribution' | 'dealers'
  const { email } = useAuth();

  // Rango calculado una sola vez; lo usamos para el fetch local Y se lo pasamos
  // al KPIDashboard para que sus 4 KPIs sigan el mismo periodo que el usuario
  // esta viendo (antes el dashboard miraba solo "mes en curso del server" y
  // quedaba en 0 cuando el user navegaba mayo y el server estaba en junio).
  const range = useMemo(() => {
    const curr = new Date(referenceDate);
    if (viewMode === 'day') {
      return { start: new Date(curr), end: new Date(curr) };
    }
    if (viewMode === 'week') {
      const day = curr.getDay();
      const diff = curr.getDate() - day + (day === 0 ? -6 : 1);
      const s = new Date(curr); s.setDate(diff);
      const e = new Date(s); e.setDate(s.getDate() + 6);
      return { start: s, end: e };
    }
    return {
      start: new Date(curr.getFullYear(), curr.getMonth(), 1),
      end: new Date(curr.getFullYear(), curr.getMonth() + 1, 0),
    };
  }, [viewMode, referenceDate]);

  const formatDateISO = (d) => {
    // YYYY-MM-DD en hora local (no toISOString que convierte a UTC y
    // puede saltar de dia)
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  useEffect(() => {
    fetchData();
  }, [referenceDate, viewMode]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/stats/weekly-distribution?start_date=${formatDateISO(range.start)}&end_date=${formatDateISO(range.end)}`);

      if (res.data.error) {
        console.error("Server Error:", res.data.error);
        setData({ error: res.data.error });
      } else {
        setData(res.data);
      }
    } catch (error) {
      console.error("Error cargando reporte:", error);
      setData({ error: "Error de conexión" });
    } finally {
      setLoading(false);
    }
  };

  const changePeriod = (direction) => {
    const newDate = new Date(referenceDate);
    if (viewMode === 'day') {
      newDate.setDate(newDate.getDate() + direction);
    } else if (viewMode === 'week') {
      newDate.setDate(newDate.getDate() + (direction * 7));
    } else {
      newDate.setMonth(newDate.getMonth() + direction);
    }
    setReferenceDate(newDate);
  };


  if (loading) return (
    <div className="flex flex-col items-center justify-center h-64 space-y-4">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      <p className="text-gray-500 font-mono text-sm">Calculando estados financieros...</p>
    </div>
  );

  if (data?.error) return (
    <div className="flex justify-center items-center h-64">
        <div className="bg-red-500/10 border border-red-500/50 p-6 rounded-2xl text-center">
            <p className="text-red-500 font-bold mb-2">Error de Cálculo</p>
            <p className="text-gray-400 font-mono text-xs">{data.error}</p>
            <button onClick={fetchData} className="mt-4 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded text-xs">Reintentar</button>
        </div>
    </div>
  );

  if (!data) return <div className="text-center text-gray-500 mt-10">No hay datos disponibles.</div>;

  // --- LÓGICA DE CLASIFICACIÓN ---
  // El backend manda `type` explícito (EXPENSES/META/PARTNER/FUND): la UI NO
  // adivina por substrings del nombre — una regla llamada "...fijo..." se
  // pintaba como meta. El fallback heurístico existe SOLO para la carrera de
  // deploys (backend viejo sin type) y se puede borrar en el próximo pase.
  const itemType = (item) => {
    if (item.type) return item.type;
    if (item.percent > 0) return 'PARTNER';
    const n = item.name.toLowerCase();
    if (n.includes('caja') || n.includes('fondo') || n.includes('reserva') || n.includes('operativo')) return 'FUND';
    return 'META';
  };
  const isSocio = (item) => itemType(item) === 'PARTNER' || itemType(item) === 'FUND';
  const isMetaItem = (item) => itemType(item) === 'META';
  const isFondoItem = (item) => itemType(item) === 'FUND';

  const totalSocios = data.distribution.filter(isSocio).reduce((acc, curr) => acc + curr.total, 0);
  const totalMeta = data.distribution.filter(isMetaItem).reduce((acc, curr) => acc + curr.total, 0);
  const totalFondos = data.distribution.filter(isFondoItem).reduce((acc, curr) => acc + curr.total, 0);

  // La cuenta del periodo (mismo vocabulario en pantalla y export):
  // ingresos (rake bruto) − egresos (dealers + cortesías) = neto a repartir.
  const cajaIngresos = data.gross_week ?? data.total_week ?? 0;
  const cajaEgresos = data.expenses_week || 0;
  const cajaNeto = data.net_week ?? (cajaIngresos - cajaEgresos);

  // Arma el modelo de exportación según la pestaña activa. Dealers se trae al
  // momento (su data vive en el componente hijo); distribución ya está en `data`.
  const buildExportModel = async () => {
    if (reportTab === 'dealers') {
      const dealerData = await statsService.getDealerPayments(formatDateISO(range.start), formatDateISO(range.end));
      return buildDealersModel({ dealerData, viewMode, start: range.start, end: range.end, user: email });
    }
    // Detalle por sesión: /history/ trae todas las cerradas; lo filtra el builder
    // al rango. Si falla (rol/red), el reporte sale igual sin la hoja de detalle.
    let sessions = [];
    try { sessions = await historyService.getAll(); } catch { sessions = []; }
    return buildDistributionModel({ data, totalSocios, totalMeta, totalFondos, viewMode, start: range.start, end: range.end, user: email, sessions });
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8 animate-fade-in">
      {reportTab === 'distribution' && <KPIDashboard startDate={range.start} endDate={range.end} />}

      {/* TABS: Distribución / Dealers  +  Exportar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex bg-gray-900 p-1 rounded-xl w-full sm:w-fit">
          <button
            onClick={() => setReportTab('distribution')}
            className={`flex-1 sm:flex-none px-5 py-2 rounded-lg text-xs font-bold transition-all ${reportTab === 'distribution' ? 'bg-gray-700 text-white shadow' : 'text-gray-400 hover:text-white'}`}
          >
            DISTRIBUCIÓN
          </button>
          <button
            onClick={() => setReportTab('dealers')}
            className={`flex-1 sm:flex-none px-5 py-2 rounded-lg text-xs font-bold transition-all ${reportTab === 'dealers' ? 'bg-amber-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
          >
            🃏 DEALERS
          </button>
        </div>
        <ExportMenu getModel={buildExportModel} />
      </div>

      {/* HEADER Y NAVEGACIÓN */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gray-800/40 p-4 rounded-2xl border border-gray-700/50 backdrop-blur-sm">
        <div className="flex bg-gray-900 p-1 rounded-xl w-fit">
          <button
            onClick={() => { setViewMode('day'); setReferenceDate(new Date()); }}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${viewMode === 'day' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
          >
            DIARIO
          </button>
          <button
            onClick={() => { setViewMode('week'); setReferenceDate(new Date()); }}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${viewMode === 'week' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
          >
            SEMANAL
          </button>
          <button
            onClick={() => { setViewMode('month'); setReferenceDate(new Date()); }}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${viewMode === 'month' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
          >
            MENSUAL
          </button>
        </div>

        <div className="flex items-center gap-4 justify-between md:justify-end">
          <button onClick={() => changePeriod(-1)} className="p-2 hover:bg-gray-700 rounded-full text-gray-400 hover:text-white transition-colors">
            <ArrowLeftIcon className="w-5 h-5" />
          </button>
          
          <div className="text-center min-w-[140px]">
              <h2 className="text-sm font-bold text-white uppercase tracking-tighter italic">
                {viewMode === 'day' ? 'Día' : viewMode === 'week' ? 'Semana' : 'Mes'}
              </h2>
              <p className="text-[10px] text-blue-400 font-mono font-bold">
                {data.range.start} — {data.range.end}
              </p>
          </div>

          <button onClick={() => changePeriod(1)} className="p-2 hover:bg-gray-700 rounded-full text-gray-400 hover:text-white transition-colors">
            <ArrowRightIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* TAB DEALERS */}
      {reportTab === 'dealers' && (
        <DealerPaymentsTable startISO={formatDateISO(range.start)} endISO={formatDateISO(range.end)} />
      )}

      {/* ===== TAB DISTRIBUCIÓN ===== */}
      {reportTab === 'distribution' && <>

      {/* ===== LA CUENTA DEL PERIODO: ingresos − egresos = neto a repartir.
             Un solo vocabulario en toda la caja (pantalla y export): INGRESOS
             (rake bruto), EGRESOS (dealers + cortesías) y NETO A REPARTIR. ===== */}
      <div className="space-y-3">
        <p className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">Caja del periodo</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-gradient-to-br from-green-900/20 to-transparent border border-green-500/20 p-5 rounded-2xl">
            <p className="text-[10px] font-bold text-green-500 uppercase tracking-widest mb-1">💵 Ingresos · Rake bruto</p>
            <p className="text-3xl font-black text-white font-mono">{formatMoney(cajaIngresos)}</p>
          </div>
          <div className="bg-gradient-to-br from-red-900/15 to-transparent border border-red-500/20 p-5 rounded-2xl">
            <p className="text-[10px] font-bold text-red-400 uppercase tracking-widest mb-1">📤 Egresos · Dealers y cortesías</p>
            <p className="text-3xl font-black text-white font-mono">{cajaEgresos > 0 ? `− ${formatMoney(cajaEgresos)}` : formatMoney(0)}</p>
          </div>
          <div className="bg-gradient-to-br from-emerald-900/20 to-transparent border border-emerald-500/20 p-5 rounded-2xl">
            {/* La semana que se pierde se dice de frente: nada de celebrar un
                monto negativo con un checkmark. */}
            <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${cajaNeto < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
              {cajaNeto < 0 ? '⚠ Pérdida del periodo' : '✅ Neto a repartir'}
            </p>
            <p className={`text-3xl font-black font-mono ${cajaNeto < 0 ? 'text-red-300' : 'text-white'}`}>{formatMoney(cajaNeto)}</p>
            {cajaNeto < 0 && (
              <p className="text-red-300/80 text-xs mt-1">Los gastos (dealers y cortesías) superaron el rake. Revisa la pestaña Dealers.</p>
            )}
          </div>
        </div>
      </div>

      {/* ===== REPARTO DEL NETO: a dónde va la plata (ni ingreso ni egreso:
             asignación del neto según las reglas del club). Solo aparece si el
             reparto tiene MÁS de un concepto: cuando el 100% va a socios (ej.
             Mambo), esta fila repetiría el "Neto a repartir" — el detalle por
             socio ya está en las cards de abajo. Grilla adaptativa (2 o 3). ===== */}
      {(totalMeta > 0 || totalFondos > 0) && (
      <div className="space-y-3">
        <p className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">Reparto del neto</p>
        <div className={`grid grid-cols-1 gap-4 ${totalMeta > 0 && totalFondos > 0 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
          {totalMeta > 0 && (
             <div className="bg-gradient-to-br from-emerald-900/20 to-transparent border border-emerald-500/20 p-5 rounded-2xl">
                <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-1">🎯 Abono a meta</p>
                <p className="text-3xl font-black text-white font-mono">{formatMoney(totalMeta)}</p>
             </div>
          )}
          {totalFondos > 0 && (
            <div className="bg-gradient-to-br from-purple-900/20 to-transparent border border-purple-500/20 p-5 rounded-2xl">
                <p className="text-[10px] font-bold text-purple-500 uppercase tracking-widest mb-1">🏦 Fondos operativos</p>
                <p className="text-3xl font-black text-white font-mono">{formatMoney(totalFondos)}</p>
            </div>
          )}
          <div className="bg-gradient-to-br from-blue-900/20 to-transparent border border-blue-500/20 p-5 rounded-2xl">
            <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-1">👥 Utilidad socios</p>
            <p className="text-3xl font-black text-white font-mono">{formatMoney(totalSocios)}</p>
          </div>
        </div>
      </div>
      )}

      {/* LISTADO DETALLADO DE DISTRIBUCIÓN */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {data.distribution.length > 0 ? (
          data.distribution.map((item, idx) => {
            const t = itemType(item);
            const isMeta = t === 'META' || t === 'EXPENSES';
            const isFondo = t === 'FUND';

            let theme;
            if (isMeta && !isFondo) {
                theme = {
                    icon: ScaleIcon,
                    label: "Reparto · Abono a meta (prioridad 1)",
                    chipText: "→ META",
                    chipCls: "text-emerald-400 bg-emerald-500/10",
                    mainColor: "text-emerald-400",
                    bgColor: "bg-emerald-600/20",
                    borderColor: "border-emerald-500/30",
                    hoverBorder: "hover:border-emerald-500/50",
                    bottomBar: "bg-emerald-500/0 group-hover:bg-emerald-500/50"
                };
            } else if (isFondo) {
                theme = {
                    icon: WalletIcon,
                    label: "Reparto · Fondo operativo",
                    chipText: "→ FONDO",
                    chipCls: "text-purple-400 bg-purple-500/10",
                    mainColor: "text-purple-400",
                    bgColor: "bg-purple-600/20",
                    borderColor: "border-purple-500/30",
                    hoverBorder: "hover:border-purple-500/50",
                    bottomBar: "bg-purple-500/0 group-hover:bg-purple-500/50"
                };
            } else {
                theme = {
                    icon: UserGroupIcon,
                    label: `Reparto · Utilidad socio (${item.percent}%)`,
                    chipText: "+ UTILIDAD",
                    chipCls: "text-blue-400 bg-blue-500/10",
                    mainColor: "text-blue-400",
                    bgColor: "bg-blue-600/20",
                    borderColor: "border-blue-500/30",
                    hoverBorder: "hover:border-blue-500/50",
                    bottomBar: "bg-blue-500/0 group-hover:bg-blue-500/50"
                };
            }

            return (
              <div
                key={idx}
                className={`group relative bg-gray-800 border border-gray-700 rounded-2xl p-4 sm:p-6 transition-all hover:shadow-2xl ${theme.hoverBorder}`}
              >
                {/* Layout vertical siempre: icon+nombre arriba, valor full-width abajo.
                    El horizontal con justify-between rompia el numero cuando la card
                    quedaba angosta (ej. cuando hay 1 sola distribucion en md:grid-cols-2). */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                    <div className={`w-12 h-12 sm:w-14 sm:h-14 shrink-0 rounded-2xl flex items-center justify-center shadow-lg transition-transform group-hover:scale-110 ${theme.bgColor} ${theme.mainColor} ${theme.borderColor} border`}>
                      <theme.icon className="w-6 h-6 sm:w-7 sm:h-7" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className={`text-base sm:text-xl font-black text-white group-hover:${theme.mainColor} transition-colors uppercase tracking-tighter truncate`}>
                        {item.name}
                      </h3>
                      <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest truncate">
                        {theme.label}
                      </p>
                    </div>
                  </div>
                  <div className="border-t border-gray-700/50 pt-3 flex items-end justify-between gap-3">
                    <div className={`text-[10px] font-black px-2 py-0.5 rounded-md inline-block self-center ${theme.chipCls}`}>
                      {theme.chipText}
                    </div>
                    <p className="text-2xl sm:text-3xl font-black font-mono text-white leading-none tabular-nums whitespace-nowrap text-right">
                      {formatMoney(item.total)}
                    </p>
                  </div>
                </div>

                {/* Decoración inferior */}
                <div className={`absolute bottom-0 left-4 sm:left-6 right-4 sm:right-6 h-0.5 rounded-full transition-all duration-500 ${theme.bottomBar}`}></div>
              </div>
            );
          })
        ) : (
          <div className="col-span-full py-20 bg-gray-800/20 border-2 border-dashed border-gray-700 rounded-3xl flex flex-col items-center justify-center text-gray-500">
            <CalendarDaysIcon className="w-12 h-12 mb-4 opacity-20" />
            <p className="font-bold uppercase tracking-widest text-xs">Sin actividad financiera en este periodo</p>
          </div>
        )}
      </div>

      <div className="flex justify-center pt-4">
        <button 
          onClick={fetchData}
          className="text-[10px] font-black text-gray-500 hover:text-blue-400 uppercase tracking-[0.2em] transition-all flex items-center gap-2"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
          Actualizar Reporte en Vivo
        </button>
      </div>

      </>}
    </div>
  );
}