import { useEffect, useState, useCallback } from 'react';
import { dealerSelfService } from '../api/services';
import { useAuth } from '../context/AuthContext';

const ALERTS = [
  { type: 'CHIPS', emoji: '🎰', label: 'Fichas', color: 'from-emerald-600 to-emerald-500', ring: 'ring-emerald-400/30' },
  { type: 'WAITER', emoji: '🍺', label: 'Mesero', color: 'from-blue-600 to-blue-500', ring: 'ring-blue-400/30' },
  { type: 'MANAGER', emoji: '👤', label: 'Director', color: 'from-violet-600 to-violet-500', ring: 'ring-violet-400/30' },
  { type: 'URGENT', emoji: '🚨', label: 'Urgencia', color: 'from-red-600 to-red-500', ring: 'ring-red-400/30' },
];

const cop = (n) => '$' + Math.round(n || 0).toLocaleString('es-CO');

function dur(seatedIso, bustedIso, now) {
  if (!seatedIso) return '—';
  const end = bustedIso ? new Date(bustedIso).getTime() : now;
  const mins = Math.max(0, Math.floor((end - new Date(seatedIso).getTime()) / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const TABS = [
  { key: 'table', label: 'Mi mesa', emoji: '🃏' },
  { key: 'shift', label: 'Turno', emoji: '⏱' },
  { key: 'history', label: 'Historial', emoji: '📜' },
  { key: 'summary', label: 'Resumen', emoji: '💵' },
];

export default function DealerWorkspace() {
  const { logout } = useAuth();
  const [tab, setTab] = useState('table');
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(id); }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0b1220] via-[#0a0f1a] to-black text-gray-100 font-sans">
      <div className="max-w-md mx-auto px-4 py-6 pb-28">
        <div className="flex items-center justify-between mb-5">
          <p className="text-emerald-500 text-[11px] font-black tracking-[0.3em] uppercase">RakeFlow · Dealer</p>
          <button onClick={logout} className="text-xs text-gray-400 hover:text-white font-bold">Salir</button>
        </div>

        {tab === 'table' && <TableTab now={now} />}
        {tab === 'shift' && <ShiftTab />}
        {tab === 'history' && <HistoryTab />}
        {tab === 'summary' && <SummaryTab />}
      </div>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 inset-x-0 bg-[#0a0f1a]/95 backdrop-blur border-t border-gray-800">
        <div className="max-w-md mx-auto grid grid-cols-4">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`py-3 flex flex-col items-center gap-0.5 text-[10px] font-bold transition-colors ${
                tab === t.key ? 'text-emerald-400' : 'text-gray-500'
              }`}
            >
              <span className="text-lg">{t.emoji}</span>
              {t.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

const Spinner = () => (
  <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" /></div>
);

// ---------------------------------------------------------
// Mi mesa
// ---------------------------------------------------------
function TableTab({ now }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState({});
  const [busy, setBusy] = useState({});

  const load = useCallback(async () => {
    try { setData(await dealerSelfService.getMyTable()); } catch { /* poll corrige */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); const id = setInterval(load, 30000); return () => clearInterval(id); }, [load]);

  const send = async (type) => {
    if (cooldown[type]) return;
    setCooldown((c) => ({ ...c, [type]: true }));
    try { await dealerSelfService.sendAlert(type); setSent(true); setTimeout(() => setSent(false), 2500); }
    catch { setCooldown((c) => ({ ...c, [type]: false })); return; }
    setTimeout(() => setCooldown((c) => ({ ...c, [type]: false })), 30000);
  };

  const toggleBust = async (playerId) => {
    if (busy[playerId]) return;
    setBusy((b) => ({ ...b, [playerId]: true }));
    try { await dealerSelfService.toggleBust(playerId); await load(); }
    catch { /* noop */ } finally { setBusy((b) => ({ ...b, [playerId]: false })); }
  };

  if (loading) return <Spinner />;

  if (!data?.has_table) return (
    <div className="text-center py-20">
      <p className="text-5xl mb-4">☕</p>
      <p className="font-bold text-white">Sin mesa asignada</p>
      <p className="text-sm text-gray-400 mt-1">Esperá a que el cajero te asigne un turno.</p>
      {data?.dealer_name && <p className="text-xs text-gray-600 mt-3">Hola, {data.dealer_name}</p>}
    </div>
  );

  const players = data.players || [];
  const seated = players.filter((p) => !p.is_busted);
  const cap = data.max_players;
  const seats = data.seats_available;

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h1 className="text-2xl font-black text-white">{data.table_name}</h1>
        <span className="inline-block mt-2 text-[10px] font-bold uppercase px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30">● En vivo</span>
      </div>

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

      <section className="space-y-2">
        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Jugadores en mesa</p>
        {players.length === 0 && (
          <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl px-4 py-6 text-center text-gray-500 text-sm">Aún no hay jugadores sentados.</div>
        )}
        {players.map((p) => (
          <div key={p.player_id} className={`rounded-xl px-4 py-3 flex items-center justify-between gap-3 border ${p.is_busted ? 'bg-gray-800/30 border-gray-700/40 opacity-60' : 'bg-gray-800/60 border-gray-700/60'}`}>
            <div className="min-w-0">
              <p className={`font-bold truncate ${p.is_busted ? 'text-gray-400 line-through' : 'text-white'}`}>{p.name}</p>
              <p className="text-xs mt-0.5 text-gray-400">{p.is_busted ? '👋 Salió · ' : '⏱ '}{dur(p.seated_at, p.busted_at, now)} en mesa</p>
            </div>
            <button
              onClick={() => toggleBust(p.player_id)}
              disabled={busy[p.player_id]}
              className={`shrink-0 text-xs font-bold px-3 py-2 rounded-lg transition-all active:scale-95 disabled:opacity-40 ${p.is_busted ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-red-600/90 hover:bg-red-500 text-white'}`}
            >
              {busy[p.player_id] ? '…' : p.is_busted ? 'Volvió' : 'Salió'}
            </button>
          </div>
        ))}
      </section>

      <section className="space-y-3 pt-1">
        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest text-center">Avisar al staff</p>
        <div className="grid grid-cols-2 gap-3">
          {ALERTS.map((a) => (
            <button
              key={a.type}
              onClick={() => send(a.type)}
              disabled={cooldown[a.type]}
              className={`bg-gradient-to-br ${a.color} ring-1 ${a.ring} disabled:opacity-50 text-white rounded-2xl py-6 flex flex-col items-center gap-1.5 font-bold transition-all active:scale-[0.97] shadow-lg`}
            >
              <span className="text-3xl">{a.emoji}</span>
              <span className="text-sm">{cooldown[a.type] ? 'Enviado ✓' : a.label}</span>
            </button>
          ))}
        </div>
        {sent && <div className="bg-emerald-900/40 border border-emerald-500/40 text-emerald-200 text-sm font-bold rounded-xl px-4 py-3 text-center">✓ Aviso enviado al staff</div>}
      </section>
    </div>
  );
}

// ---------------------------------------------------------
// Turno actual
// ---------------------------------------------------------
function ShiftTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { dealerSelfService.getMyShift().then(setData).catch(() => {}).finally(() => setLoading(false)); }, []);
  if (loading) return <Spinner />;
  if (!data?.has_shift) return (
    <div className="text-center py-20">
      <p className="text-5xl mb-4">⏱</p>
      <p className="font-bold text-white">No tenés turno abierto</p>
      <p className="text-sm text-gray-400 mt-1">Tu pago empieza a correr cuando el cajero abra tu turno.</p>
    </div>
  );
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-black text-white">Turno actual</h2>
      <div className="bg-gray-800/50 border border-gray-700/60 rounded-2xl p-5 space-y-3">
        <Row label="Mesa" value={data.table_name} />
        <Row label="Tiempo dealeado" value={`${data.hours} h`} />
        <Row label="Tarifa" value={`${cop(data.hourly_rate_cop)}/h`} />
        <Row label="% rake del turno" value={`${data.rake_pct}%`} />
        <div className="border-t border-gray-700 pt-3">
          <Row label="Pago estimado (horas)" value={cop(data.estimated_pay_hours_only)} strong />
          <p className="text-[11px] text-gray-500 mt-2">{data.note}</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// Historial
// ---------------------------------------------------------
function HistoryTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { dealerSelfService.getMyHistory().then(setData).catch(() => {}).finally(() => setLoading(false)); }, []);
  if (loading) return <Spinner />;
  const shifts = data?.shifts || [];
  if (shifts.length === 0) return (
    <div className="text-center py-20"><p className="text-5xl mb-4">📜</p><p className="font-bold text-white">Sin turnos aún</p><p className="text-sm text-gray-400 mt-1">Acá vas a ver tus sesiones y lo que ganaste.</p></div>
  );
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-black text-white">Mis turnos</h2>
      {shifts.map((s) => (
        <div key={s.shift_id} className="bg-gray-800/60 border border-gray-700/60 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-white font-bold truncate">{s.table_name}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {s.start_time ? new Date(s.start_time).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : ''} · {s.hours} h
            </p>
          </div>
          <span className="text-emerald-400 font-bold whitespace-nowrap">{cop(s.payment)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------
// Resumen
// ---------------------------------------------------------
function SummaryTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { dealerSelfService.getMySummary().then(setData).catch(() => {}).finally(() => setLoading(false)); }, []);
  if (loading) return <Spinner />;
  if (!data) return null;
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-black text-white">Hola, {data.dealer_name} 👋</h2>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Ganado este mes" value={cop(data.earned_month)} accent />
        <Stat label="Ganado total" value={cop(data.earned_total)} />
        <Stat label="Horas dealeadas" value={`${data.hours_total} h`} />
        <Stat label="Turnos" value={`${data.shifts_count}`} />
      </div>
      <div className="bg-gray-800/50 border border-gray-700/60 rounded-2xl p-5 space-y-3">
        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Liquidación</p>
        <Row label="Devengado" value={cop(data.earned_total)} />
        <Row label="Pagado" value={cop(data.paid_total)} />
        <div className="border-t border-gray-700 pt-3">
          <Row label="Pendiente de pago" value={cop(data.pending_total)} strong />
        </div>
      </div>
    </div>
  );
}

const Row = ({ label, value, strong }) => (
  <div className="flex items-center justify-between">
    <span className="text-sm text-gray-400">{label}</span>
    <span className={strong ? 'text-lg font-black text-emerald-400' : 'text-white font-bold'}>{value}</span>
  </div>
);

const Stat = ({ label, value, accent }) => (
  <div className={`rounded-2xl p-4 border ${accent ? 'bg-emerald-900/20 border-emerald-600/40' : 'bg-gray-800/50 border-gray-700/60'}`}>
    <p className="text-[11px] text-gray-400 font-bold uppercase tracking-wide">{label}</p>
    <p className={`mt-1 text-xl font-black ${accent ? 'text-emerald-300' : 'text-white'}`}>{value}</p>
  </div>
);
