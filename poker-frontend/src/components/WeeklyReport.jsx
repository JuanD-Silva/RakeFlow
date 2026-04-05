import { useEffect, useState } from 'react';
import api from '../api/axios';
import KPIDashboard from '../components/KPIDashboard';
import { formatMoney } from '../utils/formatters';
import { 
  ArrowLeftIcon, 
  ArrowRightIcon, 
  UserGroupIcon, 
  CalendarDaysIcon,
  WalletIcon,
  ScaleIcon // Ícono para la Meta
} from '@heroicons/react/24/outline'; 

export default function WeeklyReport() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('week'); 
  const [referenceDate, setReferenceDate] = useState(new Date());

  useEffect(() => {
    fetchData();
  }, [referenceDate, viewMode]);

  const fetchData = async () => {
    setLoading(true);
    try {
      let start, end;
      const curr = new Date(referenceDate);

      if (viewMode === 'week') {
        const day = curr.getDay(); 
        const diff = curr.getDate() - day + (day === 0 ? -6 : 1); 
        start = new Date(curr.setDate(diff));
        end = new Date(curr.setDate(diff + 6));
      } else {
        start = new Date(curr.getFullYear(), curr.getMonth(), 1);
        end = new Date(curr.getFullYear(), curr.getMonth() + 1, 0);
      }

      const formatDate = (d) => d.toISOString().split('T')[0];
      const res = await api.get(`/stats/weekly-distribution?start_date=${formatDate(start)}&end_date=${formatDate(end)}`);
      
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
    if (viewMode === 'week') {
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
  const isMetaFunc = (name) => {
      const n = name.toLowerCase();
      return n.includes('meta') || n.includes('deuda') || n.includes('quota');
  };

  const isFondoFunc = (name) => {
      const n = name.toLowerCase();
      return n.includes('caja') || n.includes('fondo') || n.includes('reserva') || n.includes('operativo');
  };

  // Calculamos totales para las tarjetas (Filtrando correctamente)
  const totalSocios = data.distribution
    .filter(d => !isFondoFunc(d.name) && !isMetaFunc(d.name))
    .reduce((acc, curr) => acc + curr.total, 0);
    
  const totalFondos = data.distribution
    .filter(d => isFondoFunc(d.name))
    .reduce((acc, curr) => acc + curr.total, 0);

  const totalMeta = data.distribution
    .filter(d => isMetaFunc(d.name))
    .reduce((acc, curr) => acc + curr.total, 0);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8 animate-fade-in">
      <KPIDashboard />
      
      {/* HEADER Y NAVEGACIÓN */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gray-800/40 p-4 rounded-2xl border border-gray-700/50 backdrop-blur-sm">
        <div className="flex bg-gray-900 p-1 rounded-xl w-fit">
          <button 
            onClick={() => { setViewMode('week'); setReferenceDate(new Date()); }}
            className={`px-5 py-2 rounded-lg text-xs font-bold transition-all ${viewMode === 'week' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
          >
            SEMANAL
          </button>
          <button 
            onClick={() => { setViewMode('month'); setReferenceDate(new Date()); }}
            className={`px-5 py-2 rounded-lg text-xs font-bold transition-all ${viewMode === 'month' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
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
                {viewMode === 'week' ? 'Semana Actual' : 'Mes Actual'}
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

      {/* KPI CARDS (RESUMEN RÁPIDO) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Total Generado (CORREGIDO: usa total_week) */}
        <div className="bg-gradient-to-br from-green-900/20 to-transparent border border-green-500/20 p-5 rounded-2xl">
          <p className="text-[10px] font-bold text-green-500 uppercase tracking-widest mb-1">Total Generado</p>
          <p className="text-3xl font-black text-white font-mono">
            {formatMoney(data.total_week || 0)} 
          </p>
        </div>
        
        {/* Meta / Deuda (Si hay) */}
        {totalMeta > 0 ? (
             <div className="bg-gradient-to-br from-emerald-900/20 to-transparent border border-emerald-500/20 p-5 rounded-2xl">
                <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-1">Abono a Meta</p>
                <p className="text-3xl font-black text-white font-mono">{formatMoney(totalMeta)}</p>
             </div>
        ) : (
            /* Si no hay meta, mostramos Fondos */
            <div className="bg-gradient-to-br from-purple-900/20 to-transparent border border-purple-500/20 p-5 rounded-2xl">
                <p className="text-[10px] font-bold text-purple-500 uppercase tracking-widest mb-1">Fondos Operativos</p>
                <p className="text-3xl font-black text-white font-mono">{formatMoney(totalFondos)}</p>
            </div>
        )}
        
        {/* Socios */}
        <div className="bg-gradient-to-br from-blue-900/20 to-transparent border border-blue-500/20 p-5 rounded-2xl">
          <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-1">Participación Socios</p>
          <p className="text-3xl font-black text-white font-mono">{formatMoney(totalSocios)}</p>
        </div>
      </div>

      {/* LISTADO DETALLADO DE DISTRIBUCIÓN */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {data.distribution.length > 0 ? (
          data.distribution.map((item, idx) => {
            const isMeta = isMetaFunc(item.name);
            const isFondo = isFondoFunc(item.name);

            // DEFINIR ESTILOS
            let theme = {
                icon: UserGroupIcon,
                label: "Utilidad de Socio",
                mainColor: "text-blue-400",
                bgColor: "bg-blue-600/20",
                borderColor: "border-blue-500/30",
                hoverBorder: "hover:border-blue-500/50",
                bottomBar: "bg-blue-500/0 group-hover:bg-blue-500/50"
            };

            if (isMeta) {
                theme = {
                    icon: ScaleIcon,
                    label: "Pago Prioritario (Meta)",
                    mainColor: "text-emerald-400",
                    bgColor: "bg-emerald-600/20",
                    borderColor: "border-emerald-500/30",
                    hoverBorder: "hover:border-emerald-500/50",
                    bottomBar: "bg-emerald-500/0 group-hover:bg-emerald-500/50"
                };
            } else if (isFondo) {
                theme = {
                    icon: WalletIcon,
                    label: "Gasto Operativo / Fondo",
                    mainColor: "text-purple-400",
                    bgColor: "bg-purple-600/20",
                    borderColor: "border-purple-500/30",
                    hoverBorder: "hover:border-purple-500/50",
                    bottomBar: "bg-purple-500/0 group-hover:bg-purple-500/50"
                };
            }

            return (
              <div 
                key={idx} 
                className={`group relative bg-gray-800 border border-gray-700 rounded-2xl p-6 transition-all hover:shadow-2xl ${theme.hoverBorder}`}
              >
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-4">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg transition-transform group-hover:scale-110 ${theme.bgColor} ${theme.mainColor} ${theme.borderColor} border`}>
                      <theme.icon className="w-7 h-7" />
                    </div>
                    <div>
                      <h3 className={`text-xl font-black text-white group-hover:${theme.mainColor} transition-colors uppercase tracking-tighter`}>
                        {item.name}
                      </h3>
                      <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">
                        {theme.label}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-black text-green-500 bg-green-500/10 px-2 py-0.5 rounded-md mb-2 inline-block">
                      + GANANCIA
                    </div>
                    <p className="text-3xl font-black font-mono text-white leading-none">
                      {formatMoney(item.total)}
                    </p>
                  </div>
                </div>
                
                {/* Decoración inferior */}
                <div className={`absolute bottom-0 left-6 right-6 h-0.5 rounded-full transition-all duration-500 ${theme.bottomBar}`}></div>
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
    </div>
  );
}