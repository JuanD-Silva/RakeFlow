import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { publicService } from '../api/services';

const ALERTS = [
  { type: 'CHIPS', emoji: '🎰', label: 'Fichas', color: 'bg-emerald-600 hover:bg-emerald-500' },
  { type: 'WAITER', emoji: '🍺', label: 'Mesero', color: 'bg-blue-600 hover:bg-blue-500' },
  { type: 'MANAGER', emoji: '👤', label: 'Director', color: 'bg-violet-600 hover:bg-violet-500' },
  { type: 'URGENT', emoji: '🚨', label: 'Urgencia', color: 'bg-red-600 hover:bg-red-500' },
];

export default function DealerView() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sent, setSent] = useState(null);      // tipo recién enviado
  const [cooldown, setCooldown] = useState({}); // {type: true} mientras está en cooldown

  const load = useCallback(async () => {
    try {
      const res = await publicService.getDealerView(token);
      setData(res); setError(false);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); const id = setInterval(load, 30000); return () => clearInterval(id); }, [load]);
  useEffect(() => { if (data?.table_name) document.title = `${data.table_name} · Dealer`; }, [data]);

  const send = async (type) => {
    if (cooldown[type]) return;
    setCooldown((c) => ({ ...c, [type]: true }));
    try {
      await publicService.sendDealerAlert(token, type);
      setSent(type);
      setTimeout(() => setSent(null), 2500);
    } catch {
      // si falla, liberamos el cooldown para reintentar
      setCooldown((c) => ({ ...c, [type]: false }));
      return;
    }
    setTimeout(() => setCooldown((c) => ({ ...c, [type]: false })), 30000); // anti-spam visual
  };

  if (loading) return (
    <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-500" />
    </div>
  );
  if (error || !data) return (
    <div className="min-h-screen bg-[#0a0f1a] text-gray-400 flex flex-col items-center justify-center px-6 text-center">
      <p className="text-5xl mb-4">🔍</p>
      <p className="font-bold text-white">Mesa no encontrada</p>
      <p className="text-sm mt-1">El link no es válido o la mesa se cerró.</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0a0f1a] text-gray-100 font-sans px-4 py-8">
      <div className="max-w-md mx-auto space-y-6">
        <div className="text-center">
          <p className="text-emerald-500 text-[11px] font-black tracking-[0.3em] uppercase">RakeFlow · Dealer</p>
          <h1 className="text-2xl font-black text-white mt-1">{data.table_name}</h1>
          {data.dealer_name && <p className="text-gray-400 text-sm mt-1">Dealer: {data.dealer_name}</p>}
          <span className={`inline-block mt-2 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${data.is_open ? 'bg-emerald-700/50 text-emerald-200' : 'bg-gray-700 text-gray-400'}`}>
            {data.is_open ? 'Abierta' : 'Cerrada'}
          </span>
        </div>

        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest text-center">Avisar al staff</p>

        <div className="grid grid-cols-2 gap-3">
          {ALERTS.map((a) => (
            <button
              key={a.type}
              onClick={() => send(a.type)}
              disabled={!data.is_open || cooldown[a.type]}
              className={`${a.color} disabled:opacity-50 text-white rounded-2xl py-6 flex flex-col items-center gap-1.5 font-bold transition-all active:scale-[0.97] shadow-lg`}
            >
              <span className="text-3xl">{a.emoji}</span>
              <span className="text-sm">{cooldown[a.type] ? 'Enviado ✓' : a.label}</span>
            </button>
          ))}
        </div>

        {sent && (
          <div className="bg-emerald-900/40 border border-emerald-500/40 text-emerald-200 text-sm font-bold rounded-xl px-4 py-3 text-center animate-fade-in">
            ✓ Aviso enviado al staff
          </div>
        )}

        <p className="text-center text-[10px] text-gray-600 pt-4">
          {data.is_open ? 'Tocá un botón para avisar al cajero.' : 'La mesa está cerrada.'}
        </p>
      </div>
    </div>
  );
}
