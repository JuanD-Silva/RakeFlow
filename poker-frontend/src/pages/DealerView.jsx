import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { publicService } from '../api/services';

const ALERTS = [
  { type: 'CHIPS', emoji: '🎰', label: 'Fichas', color: 'from-emerald-600 to-emerald-500', ring: 'ring-emerald-400/30' },
  { type: 'WAITER', emoji: '🍺', label: 'Mesero', color: 'from-blue-600 to-blue-500', ring: 'ring-blue-400/30' },
  { type: 'MANAGER', emoji: '👤', label: 'Director', color: 'from-violet-600 to-violet-500', ring: 'ring-violet-400/30' },
  { type: 'URGENT', emoji: '🚨', label: 'Urgencia', color: 'from-red-600 to-red-500', ring: 'ring-red-400/30' },
];

// Tiempo en mesa: desde que se sentó (seated_at) hasta ahora; si salió, congelado
// en busted_at. Mismo criterio que el rakeback ("Los Fieles").
function timeAtTable(seatedIso, bustedIso, now) {
  if (!seatedIso) return '—';
  const end = bustedIso ? new Date(bustedIso).getTime() : now;
  const mins = Math.max(0, Math.floor((end - new Date(seatedIso).getTime()) / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function DealerView() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sent, setSent] = useState(null);
  const [cooldown, setCooldown] = useState({});
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState({}); // {player_id: true} mientras se procesa el toggle

  const load = useCallback(async () => {
    try {
      const res = await publicService.getDealerView(token);
      setData(res); setError(false);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); const id = setInterval(load, 30000); return () => clearInterval(id); }, [load]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(id); }, []);
  useEffect(() => { if (data?.table_name) document.title = `${data.table_name} · Dealer`; }, [data]);

  const send = async (type) => {
    if (cooldown[type]) return;
    setCooldown((c) => ({ ...c, [type]: true }));
    try {
      await publicService.sendDealerAlert(token, type);
      setSent(type);
      setTimeout(() => setSent(null), 2500);
    } catch {
      setCooldown((c) => ({ ...c, [type]: false }));
      return;
    }
    setTimeout(() => setCooldown((c) => ({ ...c, [type]: false })), 30000);
  };

  const toggleBust = async (playerId) => {
    if (busy[playerId]) return;
    setBusy((b) => ({ ...b, [playerId]: true }));
    try {
      await publicService.toggleBust(token, playerId);
      await load();
    } catch {
      // ignore; el próximo poll corrige
    } finally {
      setBusy((b) => ({ ...b, [playerId]: false }));
    }
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

  const players = data.players || [];
  const seated = players.filter((p) => !p.is_busted);
  const cap = data.max_players;
  const seats = data.seats_available;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0b1220] via-[#0a0f1a] to-black text-gray-100 font-sans px-4 py-8">
      <div className="max-w-md mx-auto space-y-6">
        {/* Header */}
        <div className="text-center">
          <p className="text-emerald-500 text-[11px] font-black tracking-[0.3em] uppercase">RakeFlow · Dealer</p>
          <h1 className="text-2xl font-black text-white mt-1">{data.table_name}</h1>
          {data.dealer_name && <p className="text-gray-400 text-sm mt-0.5">Dealer: {data.dealer_name}</p>}
          <span className={`inline-block mt-2 text-[10px] font-bold uppercase px-2.5 py-1 rounded-full ${data.is_open ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30' : 'bg-gray-700 text-gray-400'}`}>
            {data.is_open ? '● En vivo' : 'Cerrada'}
          </span>
        </div>

        {/* Ocupación / cupos */}
        {cap != null && (
          <div className="bg-gray-800/50 border border-gray-700/60 rounded-2xl px-4 py-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-bold text-white">{seated.length}/{cap} jugadores</span>
              <span className={`font-bold ${seats > 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {seats > 0 ? `${seats} cupo${seats !== 1 ? 's' : ''} libre${seats !== 1 ? 's' : ''}` : 'Mesa llena'}
              </span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-gray-700/70 overflow-hidden flex gap-0.5">
              {Array.from({ length: cap }).map((_, i) => (
                <div key={i} className={`flex-1 rounded-full ${i < seated.length ? 'bg-emerald-500' : 'bg-gray-600/50'}`} />
              ))}
            </div>
          </div>
        )}

        {/* Jugadores en mesa */}
        <section className="space-y-2">
          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Jugadores en mesa</p>
          {players.length === 0 && (
            <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl px-4 py-6 text-center text-gray-500 text-sm">
              Aún no hay jugadores sentados.
            </div>
          )}
          {players.map((p) => (
            <div
              key={p.player_id}
              className={`rounded-xl px-4 py-3 flex items-center justify-between gap-3 border transition-colors ${
                p.is_busted ? 'bg-gray-800/30 border-gray-700/40 opacity-60' : 'bg-gray-800/60 border-gray-700/60'
              }`}
            >
              <div className="min-w-0">
                <p className={`font-bold truncate ${p.is_busted ? 'text-gray-400 line-through' : 'text-white'}`}>
                  {p.name}
                </p>
                <p className="text-xs mt-0.5 text-gray-400">
                  {p.cashed_out ? '💰 Cobró · ' : p.is_busted ? '👋 Salió · ' : '⏱ '}{timeAtTable(p.seated_at, p.busted_at, now)} en mesa
                </p>
              </div>
              {p.cashed_out ? (
                <span className="shrink-0 text-[10px] font-bold uppercase px-3 py-2 rounded-lg bg-gray-800 text-gray-500">Cobró</span>
              ) : (
                <button
                  onClick={() => toggleBust(p.player_id)}
                  disabled={!data.is_open || busy[p.player_id]}
                  className={`shrink-0 text-xs font-bold px-3 py-2 rounded-lg transition-all active:scale-95 disabled:opacity-40 ${
                    p.is_busted
                      ? 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                      : 'bg-red-600/90 hover:bg-red-500 text-white'
                  }`}
                >
                  {busy[p.player_id] ? '…' : p.is_busted ? 'Volvió' : 'Salió'}
                </button>
              )}
            </div>
          ))}
        </section>

        {/* Avisar al staff */}
        <section className="space-y-3 pt-2">
          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest text-center">Avisar al staff</p>
          <div className="grid grid-cols-2 gap-3">
            {ALERTS.map((a) => (
              <button
                key={a.type}
                onClick={() => send(a.type)}
                disabled={!data.is_open || cooldown[a.type]}
                className={`bg-gradient-to-br ${a.color} ring-1 ${a.ring} disabled:opacity-50 text-white rounded-2xl py-6 flex flex-col items-center gap-1.5 font-bold transition-all active:scale-[0.97] shadow-lg`}
              >
                <span className="text-3xl">{a.emoji}</span>
                <span className="text-sm">{cooldown[a.type] ? 'Enviado ✓' : a.label}</span>
              </button>
            ))}
          </div>
        </section>

        {sent && (
          <div className="bg-emerald-900/40 border border-emerald-500/40 text-emerald-200 text-sm font-bold rounded-xl px-4 py-3 text-center animate-fade-in">
            ✓ Aviso enviado al staff
          </div>
        )}

        <p className="text-center text-[10px] text-gray-600 pt-2">
          {data.is_open ? 'Marcá "Salió" cuando un jugador deje la mesa.' : 'La mesa está cerrada.'}
        </p>
      </div>
    </div>
  );
}
