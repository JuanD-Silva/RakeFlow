import { useEffect, useState } from 'react';
import api from '../api/axios';
import { TrophyIcon, StarIcon, FireIcon, ArrowPathIcon } from '@heroicons/react/24/solid';

export default function PlayerLeaderboard() {
  const [rankings, setRankings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => { fetchRankings(); }, []);

  const fetchRankings = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/stats/rankings');
      setRankings(res.data);
    } catch (err) {
      console.error("Error cargando rankings", err);
      setError("Error al cargar los rankings");
    } finally {
      setLoading(false);
    }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-20 space-y-4">
      <ArrowPathIcon className="w-10 h-10 text-blue-500 animate-spin" />
      <p className="text-gray-500 font-black uppercase tracking-widest text-xs">Consultando el Hall de la Fama...</p>
    </div>
  );
  const currentMonthName = new Date().toLocaleString('es-ES', { month: 'long' });

  if (error) return <div className="text-red-400 text-center py-10 bg-red-900/10 rounded-xl border border-red-500/20">{error}</div>;
  if (!rankings) return null;

  const RankingCard = ({ title, icon, data, accentColor, valueLabel, formatValue }) => {
    const topThree = data.slice(0, 3);
    const rest = data.slice(3);

    return (
      <div className="bg-gray-800/40 border border-gray-700/50 rounded-3xl overflow-hidden flex flex-col h-full backdrop-blur-sm group hover:border-blue-500/30 transition-all duration-500 shadow-2xl">
        {/* Header */}
        <div className={`p-6 bg-gradient-to-b ${accentColor} to-transparent border-b border-gray-700/30`}>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gray-900/50 rounded-xl shadow-inner">
              {icon}
            </div>
            <h3 className="font-black text-white uppercase tracking-tighter text-lg">{title}</h3>
          </div>
        </div>

        <div className="p-4 flex-1 space-y-6">
          {data.length === 0 ? (
            <p className="text-center text-gray-600 py-10 font-bold uppercase tracking-widest text-[10px]">Sin datos este periodo</p>
          ) : (
            <>
              {/* PODIO (Top 3 Visual) */}
              <div className="flex items-end justify-center gap-2 pt-4 pb-2 px-2">
                {/* Segundo Lugar */}
                {topThree[1] && (
                  <div className="flex flex-col items-center flex-1">
                    <div className="w-12 h-12 rounded-full bg-gray-400/20 border-2 border-gray-400 flex items-center justify-center mb-2 shadow-lg">
                      <span className="text-gray-300 font-black">2</span>
                    </div>
                    <p className="text-xs font-bold text-gray-300 truncate w-full text-center uppercase tracking-tighter">{topThree[1].name}</p>
                    <div className="h-12 w-full bg-gray-700/50 rounded-t-lg mt-2 flex items-center justify-center">
                       <span className="text-[10px] font-mono font-bold text-gray-400">{formatValue(topThree[1].value)}</span>
                    </div>
                  </div>
                )}

                {/* PRIMER LUGAR */}
                {topThree[0] && (
                  <div className="flex flex-col items-center flex-1 scale-110 -translate-y-2">
                    <TrophyIcon className="w-8 h-8 text-yellow-500 mb-1 drop-shadow-glow" />
                    <div className="w-14 h-14 rounded-full bg-yellow-500/20 border-2 border-yellow-500 flex items-center justify-center mb-2 shadow-yellow-500/20 shadow-xl">
                      <span className="text-yellow-500 font-black text-xl">1</span>
                    </div>
                    <p className="text-sm font-black text-white truncate w-full text-center uppercase tracking-tighter">{topThree[0].name}</p>
                    <div className="h-20 w-full bg-yellow-600/20 rounded-t-xl mt-2 flex items-center justify-center border-x border-t border-yellow-500/30">
                       <span className="text-xs font-mono font-black text-yellow-500">{formatValue(topThree[0].value)}</span>
                    </div>
                  </div>
                )}

                {/* Tercer Lugar */}
                {topThree[2] && (
                  <div className="flex flex-col items-center flex-1">
                    <div className="w-10 h-10 rounded-full bg-orange-700/20 border-2 border-orange-700 flex items-center justify-center mb-2 shadow-lg">
                      <span className="text-orange-600 font-black text-sm">3</span>
                    </div>
                    <p className="text-xs font-bold text-gray-400 truncate w-full text-center uppercase tracking-tighter">{topThree[2].name}</p>
                    <div className="h-8 w-full bg-gray-700/50 rounded-t-lg mt-2 flex items-center justify-center">
                       <span className="text-[10px] font-mono font-bold text-gray-400">{formatValue(topThree[2].value)}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* LISTA DEL RESTO (4 y 5) */}
              {rest.length > 0 && (
                <div className="space-y-2 bg-gray-900/50 rounded-2xl p-2">
                  {rest.map((player, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-800 transition-colors">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-gray-600 font-bold text-xs">{idx + 4}</span>
                        <span className="text-xs font-bold text-gray-300 uppercase">{player.name}</span>
                      </div>
                      <span className="text-xs font-mono font-bold text-white bg-gray-800 px-2 py-1 rounded">
                        {formatValue(player.value)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-10 animate-fade-in">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-4xl font-black text-white tracking-tighter uppercase italic">
  Hall de la Fama <span className="text-emerald-500 text-2xl not-italic capitalize">| {currentMonthName}</span>
</h2>
          <p className="text-blue-500 text-xs font-bold uppercase tracking-[0.3em] mt-1">Reconocimiento a la excelencia del club</p>
        </div>
        <button onClick={fetchRankings} className="p-2 text-gray-500 hover:text-white transition-colors">
          <ArrowPathIcon className="w-6 h-6" />
        </button>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        <RankingCard 
          title="Tiburones" 
          icon={<TrophyIcon className="w-6 h-6 text-green-500" />} 
          data={rankings.winners}
          accentColor="from-green-500/20"
          valueLabel="Utilidad"
          formatValue={(val) => `+$${val.toLocaleString()}`}
        />

        <RankingCard 
          title="Consumo VIP" 
          icon={<StarIcon className="w-6 h-6 text-purple-500" />} 
          data={rankings.spenders}
          accentColor="from-purple-500/20"
          valueLabel="Gastado"
          formatValue={(val) => `$${val.toLocaleString()}`}
        />

        <RankingCard 
          title="Los Fieles" 
          icon={<FireIcon className="w-6 h-6 text-blue-500" />} 
          data={rankings.active}
          accentColor="from-blue-500/20"
          valueLabel="Sesiones"
          formatValue={(val) => `${Number(val).toFixed(1)}h`}
        />

      </div>

      <div className="text-center pt-10">
        <p className="text-[10px] text-gray-600 font-bold uppercase tracking-widest border-t border-gray-800 pt-6">
          * Los rankings se actualizan automáticamente al cerrar cada sesión financiera
        </p>
      </div>
    </div>
  );
}