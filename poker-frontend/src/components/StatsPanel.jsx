// src/components/StatsPanel.jsx
import { useState, useEffect } from 'react';
import { statsService } from '../api/services'; // 👈 Mantenemos tu servicio
import { BanknotesIcon, ChartBarIcon } from '@heroicons/react/24/solid'; // Necesitas instalar heroicons o usar emojis

// Recibimos la señal de recarga aquí
export default function StatsPanel({ refreshTrigger }) {
  const [jackpot, setJackpot] = useState(0);
  const [quota, setQuota] = useState({ target: 0, paid: 0, remaining: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadStats = async () => {
      try {
        // 1. Cargar Jackpot Global (Tu endpoint existente)
        const jackpotVal = await statsService.getGlobalJackpot();
        setJackpot(jackpotVal?.total_jackpot || jackpotVal || 0); // Ajuste por si devuelve objeto o número

        // 2. Cargar Estado de la Deuda (Tu endpoint existente)
        const quotaData = await statsService.getMonthlyQuota();
        setQuota({
          target: quotaData.target,
          paid: quotaData.paid_so_far,
          remaining: quotaData.remaining
        });

      } catch (error) {
        console.error("Error cargando estadísticas:", error);
      } finally {
        setLoading(false);
      }
    };

    loadStats();
    
    // Polling cada 30 segundos para actualizar en tiempo real
    const interval = setInterval(loadStats, 30000);
    return () => clearInterval(interval);

  }, [refreshTrigger]); 

  // Cálculo de porcentaje seguro
  const progressPercent = quota.target > 0 
    ? Math.min(100, (quota.paid / quota.target) * 100) 
    : 0;

  if (loading) return <div className="h-24 bg-gray-800 animate-pulse rounded-2xl mb-6 border border-gray-700"></div>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6 animate-fade-in mb-8">
      
      {/* 1. TARJETA JACKPOT ACUMULADO (Diseño Premium) */}
      <div className="bg-gradient-to-r from-purple-900/90 to-indigo-900/90 border border-purple-500/30 rounded-2xl p-5 relative overflow-hidden shadow-xl group hover:shadow-purple-500/20 transition-all">
        <div className="relative z-10 flex justify-between items-start">
          <div>
            <p className="text-purple-300 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2">
              <BanknotesIcon className="w-4 h-4" /> Jackpot Club
            </p>
            <h3 className="text-4xl font-black text-white mt-2 font-mono tracking-tight drop-shadow-md">
              ${jackpot.toLocaleString('es-CO')}
            </h3>
            <p className="text-[10px] text-purple-200/60 mt-1 font-medium">Fondo reservado para premios</p>
          </div>
          {/* Decoración de fondo */}
          <div className="absolute -right-6 -top-6 bg-purple-500/20 w-32 h-32 rounded-full blur-3xl group-hover:bg-purple-400/30 transition-all duration-700"></div>
        </div>
      </div>

      {/* 2. TARJETA META MENSUAL (Diseño Barra Progreso) */}
      <div className="bg-gray-800/80 border border-gray-700 rounded-2xl p-5 flex flex-col justify-center shadow-xl relative overflow-hidden">
        <div className="flex justify-between items-end mb-3 relative z-10">
          <div>
            <p className="text-blue-400 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2">
              <ChartBarIcon className="w-4 h-4" /> Meta Mensual
            </p>
            <div className="flex items-baseline gap-2 mt-1">
                <span className={`text-xs font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                    quota.remaining <= 0 ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                }`}>
                {quota.remaining <= 0 ? "¡Completada!" : "En Progreso"}
                </span>
            </div>
          </div>
          <div className="text-right">
             <span className="text-3xl font-black text-white font-mono leading-none">
               {progressPercent.toFixed(0)}%
             </span>
          </div>
        </div>

        {/* Barra de Progreso */}
        <div className="w-full bg-gray-700/50 rounded-full h-3 overflow-hidden relative border border-gray-700">
          <div 
            className={`h-full rounded-full transition-all duration-1000 ease-out shadow-[0_0_15px_rgba(0,0,0,0.3)] ${
              quota.remaining <= 0 
                ? 'bg-gradient-to-r from-green-500 to-emerald-400' 
                : 'bg-gradient-to-r from-blue-600 to-cyan-500'
            }`}
            style={{ width: `${progressPercent}%` }}
          ></div>
        </div>
        
        <div className="flex justify-between mt-3 text-[10px] font-mono font-bold text-gray-500 relative z-10">
           <span>Pagado: <span className="text-gray-300">${quota.paid.toLocaleString()}</span></span>
           <span>Meta: <span className="text-gray-300">${quota.target.toLocaleString()}</span></span>
        </div>

        {/* Decoración sutil */}
        {quota.remaining <= 0 && (
             <div className="absolute inset-0 bg-green-500/5 pointer-events-none"></div>
        )}
      </div>

    </div>
  );
}