// src/components/StatsPanel.jsx
import { useState, useEffect } from 'react';
import { statsService } from '../api/services';
import api from '../api/axios';
import { formatMoney } from '../utils/formatters';
import {
  BanknotesIcon,
  UserGroupIcon,
  PencilSquareIcon,
  XMarkIcon,
  MinusIcon,
  PlusIcon,
  CheckIcon
} from '@heroicons/react/24/solid';

export default function StatsPanel({ refreshTrigger, sessionId = null }) {
  const [jackpot, setJackpot] = useState(0);
  const [avgBuyin, setAvgBuyin] = useState(0);
  const [playerCount, setPlayerCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Ajuste de jackpot
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustType, setAdjustType] = useState('subtract'); // 'add' o 'subtract'
  const [adjusting, setAdjusting] = useState(false);

  const loadStats = async () => {
    try {
      const jackpotVal = await statsService.getGlobalJackpot();
      setJackpot(jackpotVal?.total_jackpot || jackpotVal || 0);

      try {
        const path = sessionId
          ? `/sessions/${sessionId}/players-stats`
          : '/sessions/current/players-stats';
        const res = await api.get(path);
        const players = res.data || [];
        setPlayerCount(players.length);
        if (players.length > 0) {
          const totalBuyins = players.reduce((acc, p) => acc + (p.total_buyin || 0), 0);
          setAvgBuyin(totalBuyins / players.length);
        } else {
          setAvgBuyin(0);
        }
      } catch {
        setAvgBuyin(0);
        setPlayerCount(0);
      }
    } catch (err) {
      console.error("Error cargando estadisticas:", err);
      setError("Error al cargar estadisticas");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 30000);
    return () => clearInterval(interval);
  }, [refreshTrigger, sessionId]);

  const handleAdjust = async () => {
    const amt = parseFloat(adjustAmount);
    if (!amt || amt <= 0) return;
    setAdjusting(true);
    try {
      const finalAmount = adjustType === 'subtract' ? -amt : amt;
      await api.post('/stats/jackpot-adjust', { amount: finalAmount, reason: adjustReason });
      setShowAdjust(false);
      setAdjustAmount('');
      setAdjustReason('');
      await loadStats();
    } catch (err) {
      console.error(err);
    } finally {
      setAdjusting(false);
    }
  };

  if (loading) return <div className="h-24 bg-gray-800 animate-pulse rounded-2xl mb-6 border border-gray-700"></div>;
  if (error) return <div className="text-red-400 text-center py-6 bg-red-900/10 rounded-xl border border-red-500/20 mb-6">{error}</div>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6 animate-fade-in mb-8">

      {/* JACKPOT ACUMULADO */}
      <div className="bg-gradient-to-r from-purple-900/90 to-indigo-900/90 border border-purple-500/30 rounded-2xl p-5 relative overflow-hidden shadow-xl group hover:shadow-purple-500/20 transition-all">
        <div className="relative z-10">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-purple-300 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2">
                <BanknotesIcon className="w-4 h-4" /> Jackpot Club
              </p>
              <h3 className="text-4xl font-black text-white mt-2 font-mono tracking-tight drop-shadow-md">
                {formatMoney(jackpot)}
              </h3>
              <p className="text-[10px] text-purple-200/60 mt-1 font-medium">Fondo reservado para premios</p>
            </div>
            <button
              onClick={() => setShowAdjust(!showAdjust)}
              className="p-2 rounded-xl hover:bg-purple-500/20 text-purple-400 hover:text-purple-200 transition-colors"
            >
              {showAdjust ? <XMarkIcon className="w-5 h-5" /> : <PencilSquareIcon className="w-5 h-5" />}
            </button>
          </div>

          {/* PANEL DE AJUSTE */}
          {showAdjust && (
            <div className="mt-4 bg-black/30 rounded-xl p-4 border border-purple-500/20 space-y-3">
              {/* Tipo: Retirar o Agregar */}
              <div className="flex gap-2 bg-gray-900 p-1 rounded-xl">
                <button
                  onClick={() => setAdjustType('subtract')}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${
                    adjustType === 'subtract' ? 'bg-red-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <MinusIcon className="w-4 h-4" /> Retirar
                </button>
                <button
                  onClick={() => setAdjustType('add')}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${
                    adjustType === 'add' ? 'bg-emerald-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <PlusIcon className="w-4 h-4" /> Agregar
                </button>
              </div>

              {/* Monto */}
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-bold">$</span>
                <input
                  type="number"
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(e.target.value)}
                  placeholder="Monto"
                  min="1"
                  className="w-full bg-gray-900 border border-gray-600 rounded-xl py-3 pl-8 pr-4 text-white font-mono text-lg font-bold outline-none focus:border-purple-500 transition-colors"
                />
              </div>

              {/* Razon */}
              <input
                type="text"
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="Motivo (opcional)"
                className="w-full bg-gray-900 border border-gray-600 rounded-xl py-3 px-4 text-white text-sm outline-none focus:border-purple-500 transition-colors placeholder-gray-600"
              />

              {/* Confirmar */}
              <button
                onClick={handleAdjust}
                disabled={adjusting || !adjustAmount || parseFloat(adjustAmount) <= 0}
                className={`w-full py-3 rounded-xl font-bold text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed ${
                  adjustType === 'subtract'
                    ? 'bg-red-600 hover:bg-red-500 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                {adjusting ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : (
                  <>
                    <CheckIcon className="w-4 h-4" />
                    {adjustType === 'subtract' ? 'Confirmar Retiro' : 'Confirmar Ingreso'}
                  </>
                )}
              </button>
            </div>
          )}
        </div>
        <div className="absolute -right-6 -top-6 bg-purple-500/20 w-32 h-32 rounded-full blur-3xl group-hover:bg-purple-400/30 transition-all duration-700"></div>
      </div>

      {/* BUY-IN PROMEDIO */}
      <div className="bg-gradient-to-r from-emerald-900/90 to-teal-900/90 border border-emerald-500/30 rounded-2xl p-5 relative overflow-hidden shadow-xl group hover:shadow-emerald-500/20 transition-all">
        <div className="relative z-10 flex justify-between items-start">
          <div>
            <p className="text-emerald-300 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2">
              <UserGroupIcon className="w-4 h-4" /> Buy-in Promedio
            </p>
            <h3 className="text-4xl font-black text-white mt-2 font-mono tracking-tight drop-shadow-md">
              {formatMoney(avgBuyin)}
            </h3>
            <p className="text-[10px] text-emerald-200/60 mt-1 font-medium">{playerCount} jugador{playerCount !== 1 ? 'es' : ''} en mesa</p>
          </div>
          <div className="absolute -right-6 -top-6 bg-emerald-500/20 w-32 h-32 rounded-full blur-3xl group-hover:bg-emerald-400/30 transition-all duration-700"></div>
        </div>
      </div>
    </div>
  );
}
