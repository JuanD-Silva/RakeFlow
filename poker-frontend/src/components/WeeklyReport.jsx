import { useEffect, useMemo, useState, useRef } from 'react';
import api from '../api/axios';
import KPIDashboard from '../components/KPIDashboard';
import { useToast, Toast } from './Toast';
import DealerPaymentsTable, { LiquidarModal } from './DealerPaymentsTable';
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
  // Default anti-"trampa del lunes": si la semana en curso lleva menos de un
  // día completo (lunes), arrancamos en la semana CERRADA — que es la que el
  // dueño viene a revisar. Navegar con → siempre permite volver a hoy.
  // Recarga de la lista de dealers pendientes tras liquidar
  const [payoutReload, setPayoutReload] = useState(0);
  const [liquidarFor, setLiquidarFor] = useState(null); // dealer (lista "a quién le debo")
  // Dealers del periodo: alimentan la lista "A quién le debo".
  // Si falla, la lista lo DICE (no finge "nadie pendiente").
  const [dealersDue, setDealersDue] = useState({ rows: [], error: false });
  const { toast, showToast, dismissToast } = useToast();
  const [referenceDate, setReferenceDate] = useState(() => {
    const hoy = new Date();
    if (hoy.getDay() === 1) { const d = new Date(hoy); d.setDate(d.getDate() - 7); return d; }
    return hoy;
  });
  // El ancla -7 es un hack SOLO para la vista semanal: al saltar a día/mes sin
  // haber navegado, volvemos a hoy (DIARIO del lunes = hoy, no hace 7 días;
  // MENSUAL del 1° = este mes, no el pasado). Si el usuario ya navegó con las
  // flechas, el periodo elegido se preserva en todos los modos.
  const inicioLunesRef = useRef(new Date().getDay() === 1);
  const navegadoRef = useRef(false);
  const cambiarModo = (m) => {
    setViewMode(m);
    if (m !== 'week' && inicioLunesRef.current && !navegadoRef.current) {
      setReferenceDate(new Date());
      inicioLunesRef.current = false;
    }
  };
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await statsService.getDealerPayments(formatDateISO(range.start), formatDateISO(range.end));
        if (!cancelled) setDealersDue({ rows: res?.dealers || [], error: false });
      } catch (e) {
        console.error("Error cargando dealers del periodo", e);
        if (!cancelled) setDealersDue({ rows: [], error: true });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceDate, viewMode, payoutReload]);

  // Secuencia anti-respuestas-viejas: encadenar taps de ← dispara varios
  // fetches; solo la respuesta del MÁS reciente puede pintar (patrón reqSeq
  // de GameControl).
  const fetchSeqRef = useRef(0);
  const fetchData = async () => {
    const myReq = ++fetchSeqRef.current;
    setLoading(true);
    try {
      const res = await api.get(`/stats/weekly-distribution?start_date=${formatDateISO(range.start)}&end_date=${formatDateISO(range.end)}`);
      if (myReq !== fetchSeqRef.current) return;

      if (res.data.error) {
        console.error("Server Error:", res.data.error);
        setData({ error: res.data.error });
      } else {
        setData(res.data);
      }
    } catch (error) {
      if (myReq !== fetchSeqRef.current) return;
      console.error("Error cargando reporte:", error);
      setData({ error: "Error de conexión" });
    } finally {
      if (myReq === fetchSeqRef.current) setLoading(false);
    }
  };

  const changePeriod = (direction) => {
    navegadoRef.current = true;
    const newDate = new Date(referenceDate);
    if (viewMode === 'day') {
      newDate.setDate(newDate.getDate() + direction);
    } else if (viewMode === 'week') {
      newDate.setDate(newDate.getDate() + (direction * 7));
    } else {
      // Sobre el día 1: setMonth con día 29-31 desborda (31-mar − 1 mes = 3-mar)
      // y el "mes anterior" era un no-op silencioso.
      return setReferenceDate(new Date(newDate.getFullYear(), newDate.getMonth() + direction, 1));
    }
    setReferenceDate(newDate);
  };


  if (loading && (!data || data.error)) return (
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
  // FUND cuenta SOLO en la card de Fondos (sumarlo también a socios lo
  // duplicaba en pantalla y en el export para clubes sin reglas PERCENTAGE).
  const isSocio = (item) => itemType(item) === 'PARTNER';
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

  // "A quién le debo": dealers con pendiente positivo del periodo. (El pago
  // de utilidades a socios NO se registra aquí — decisión de Juan 2026-08-21.)
  const deudas = [
    ...dealersDue.rows
      .filter((d) => d.pending > 0 && !d.paid_external)
      .map((d) => ({
        key: `d-${d.dealer_id}`,
        kind: 'Dealer',
        kindCls: 'bg-amber-500/15 text-amber-300',
        name: d.name,
        sub: `${d.hours}h del periodo${d.paid > 0 ? ` · pagado ${formatMoney(d.paid)} de ${formatMoney(d.club_payment)}` : ''}`,
        amount: d.pending,
        cta: 'Liquidar',
        onPay: () => setLiquidarFor(d),
      })),
  ].sort((a, b) => b.amount - a.amount);
  const totalDeudas = deudas.reduce((acc, d) => acc + d.amount, 0);
  // Dealers con un pago registrado a otro nivel de periodo (ej. el mes): no
  // entran a la lista, pero el KPI sí los cuenta — se explica, no se esconde.
  const dealersExternos = dealersDue.rows.filter((d) => d.pending > 0 && d.paid_external).length;

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
    <div className={`transition-opacity ${loading ? "opacity-60" : ""} max-w-5xl mx-auto p-6 space-y-8 animate-fade-in`}>
      {reportTab === 'distribution' && (
        <KPIDashboard
          startDate={range.start}
          endDate={range.end}
          netPeriodo={cajaNeto}
          rakeBruto={cajaIngresos}
          egresos={cajaEgresos}
          refreshKey={payoutReload}
        />
      )}

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
            onClick={() => cambiarModo('day')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${viewMode === 'day' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
          >
            DIARIO
          </button>
          <button
            onClick={() => cambiarModo('week')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${viewMode === 'week' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
          >
            SEMANAL
          </button>
          <button
            onClick={() => cambiarModo('month')}
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

      {/* ===== A QUIÉN LE DEBO: dealers con pago pendiente del periodo,
             ordenados por monto, con Liquidar en la fila. La utilidad de
             socios se reparte fuera de la app (no se registra aquí). La
             cuenta del periodo (rake − gastos = neto) vive arriba, en el hero. ===== */}
      <section aria-labelledby="deudas-titulo" className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="deudas-titulo" className="text-sm font-bold text-white">Dealers por pagar</h2>
          {deudas.length > 0 && (
            <p className="text-sm text-gray-400 tabular-nums">Total <span className="font-mono font-bold text-amber-300">{formatMoney(totalDeudas)}</span></p>
          )}
        </div>
        {dealersDue.error && (
          <p className="text-xs text-red-300 bg-red-900/10 border border-red-500/20 rounded-lg px-3 py-2">
            No pude cargar lo pendiente a dealers — la lista puede estar incompleta. <button type="button" onClick={() => setPayoutReload((k) => k + 1)} className="underline font-bold">Reintentar</button>
          </p>
        )}
        {deudas.length === 0 ? (
          <p className={`rounded-2xl border px-4 py-4 text-sm ${dealersDue.error ? 'border-gray-700 text-gray-400' : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'}`}>
            {dealersDue.error ? 'No se pudo cargar la lista.' : 'Al día: ningún dealer pendiente en este periodo.'}
          </p>
        ) : (
          <ul className="rounded-2xl border border-gray-700 bg-gray-800 divide-y divide-gray-700/70 overflow-hidden">
            {/* Móvil: dos líneas (quién / cuánto + botón); desktop: una fila
                con columnas alineadas. */}
            {deudas.map((d) => (
              <li key={d.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <div className="flex items-center gap-3 min-w-0 basis-full sm:basis-auto sm:flex-1">
                  <span className={`shrink-0 text-[11px] font-bold uppercase tracking-wider rounded-md px-1.5 py-0.5 ${d.kindCls}`}>{d.kind}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-white font-bold truncate">{d.name}</p>
                    {d.sub && <p className="text-xs text-gray-400 truncate">{d.sub}</p>}
                  </div>
                </div>
                <p className="ml-auto sm:ml-0 font-mono font-bold text-white tabular-nums whitespace-nowrap sm:min-w-[7.5rem] sm:text-right">{formatMoney(d.amount)}</p>
                <button
                  type="button"
                  onClick={d.onPay}
                  className="shrink-0 min-h-11 px-3 sm:min-w-[10rem] rounded-lg bg-emerald-600/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/25 text-xs font-bold uppercase tracking-wider transition-colors"
                >
                  {d.cta}
                </button>
              </li>
            ))}
          </ul>
        )}
        {dealersExternos > 0 && (
          <p className="text-xs text-blue-300/90">
            {dealersExternos === 1 ? 'Un dealer tiene' : `${dealersExternos} dealers tienen`} un pago registrado en otro periodo (ej. el mes): no aparece{dealersExternos === 1 ? '' : 'n'} aquí para que no lo repitas.
          </p>
        )}
      </section>

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
            const isMeta = t === 'META';
            const isFondo = t === 'FUND';
            const isGastoItem = t === 'EXPENSES';

            let theme;
            if (isGastoItem) {
                theme = {
                    icon: ScaleIcon,
                    label: "Egreso · Dealers y cortesías (sale antes del reparto)",
                    chipText: "→ GASTO",
                    chipCls: "text-red-400 bg-red-500/10",
                    mainColor: "text-red-400",
                    bgColor: "bg-red-600/20",
                    borderColor: "border-red-500/30",
                    hoverBorder: "hover:border-red-500/50",
                    bottomBar: "bg-red-500/0 group-hover:bg-red-500/50"
                };
            } else if (isMeta) {
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
            <button
              onClick={() => changePeriod(-1)}
              className="mt-4 px-4 py-2.5 rounded-xl bg-blue-600/15 border border-blue-500/40 text-blue-300 hover:bg-blue-600/25 text-xs font-bold uppercase tracking-wider transition-colors"
            >
              ‹ Ver {viewMode === 'day' ? 'el día anterior' : viewMode === 'week' ? 'la semana pasada' : 'el mes pasado'}
            </button>
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

      <Toast toast={toast} onDismiss={dismissToast} />

      {liquidarFor && (
        <LiquidarModal
          dealer={liquidarFor}
          startISO={formatDateISO(range.start)}
          endISO={formatDateISO(range.end)}
          onClose={() => setLiquidarFor(null)}
          onDone={({ amount, dealer }) => {
            setLiquidarFor(null);
            setPayoutReload((k) => k + 1);
            showToast(`Liquidaste ${formatMoney(amount)} a ${dealer.name}`, "success");
          }}
        />
      )}

    </div>
  );
}
