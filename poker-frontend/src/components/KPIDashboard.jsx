// src/components/KPIDashboard.jsx
import { useEffect, useState } from 'react';
// 👇 CORRECCIÓN IMPORTANTE: Apuntamos al archivo axios.js que creamos
import api from '../api/axios'; 

export default function KPIDashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await api.get('/stats/dashboard');
        setStats(res.data);
      } catch (e) {
        console.error("Error KPIs", e);
        setError("Error al cargar indicadores");
      }
    }
    fetchStats();
  }, []);

  if (error) return <div className="text-red-400 text-center py-6 bg-red-900/10 rounded-xl border border-red-500/20 mb-8">{error}</div>;
  if (!stats) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-gray-800/50 rounded-xl p-4 border border-gray-700 h-24 animate-pulse flex flex-col justify-center">
            <div className="h-3 w-1/2 bg-gray-700 rounded mb-3"></div> {/* Título falso */}
            <div className="h-6 w-3/4 bg-gray-600 rounded"></div>   {/* Valor falso */}
          </div>
        ))}
      </div>
    );
  }

  // Helpers de estilo (Componente interno para las tarjetas)
  const Card = ({ title, value, sub, icon, color }) => (
    <div className={`bg-gray-800 rounded-xl p-4 border-l-4 ${color} shadow-lg flex items-center justify-between`}>
      <div>
        <p className="text-gray-400 text-xs uppercase font-bold tracking-wider">{title}</p>
        <p className="text-2xl font-bold text-white font-mono mt-1">{value}</p>
        {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
      </div>
      <div className="text-3xl opacity-20 text-white select-none">{icon}</div>
    </div>
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8 animate-fade-in">
      
      {/* KPI 1: Rake por Hora */}
      <Card 
        title="Rake / Hora" 
        value={`$${stats.avg_rake_hour?.toLocaleString() ?? 0}`} 
        sub="Promedio Histórico"
        icon="⚡"
        color="border-yellow-500"
      />

      {/* KPI 2: Volumen de Juego */}
      <Card 
        title="Horas Operadas" 
        value={`${stats.total_hours ?? 0}h`} 
        sub={`${stats.total_sessions ?? 0} Sesiones cerradas`}
        icon="⏱️"
        color="border-blue-500"
      />

      {/* KPI 3: Ticket Promedio */}
      <Card 
        title="Buy-in Promedio" 
        value={`$${stats.avg_ticket?.toLocaleString() ?? 0}`} 
        sub="Gasto por jugador"
        icon="🎟️"
        color="border-purple-500"
      />

      {/* KPI 4: Control de Caja */}
      <Card 
        title="Descuadre Neto" 
        value={`$${stats.efficiency?.toLocaleString() ?? 0}`} 
        sub={stats.efficiency >= 0 ? "✅ A favor (Sobra)" : "⚠️ En contra (Falta)"}
        icon="⚖️"
        color={stats.efficiency >= 0 ? "border-green-500" : "border-red-500"}
      />

    </div>
  );
}