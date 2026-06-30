import { useEffect, useState, useCallback, useRef } from 'react';
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
  const [now, setNow] = useState(() => Date.now());
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

// Cargador resiliente para el portal del dealer: ante un cold-start de Railway o
// un blip de red (la pestaña dormida que se reactiva) el primer fetch falla. En
// vez de quedarse 30s hasta el próximo poll y mostrar un estado vacío engañoso,
// reintenta rápido hasta el primer éxito, refetchea al volver a la pestaña, y
// distingue "falló" (loadedOnce=false + error) de "vacío de verdad".
function useDealerResource(fetcher, pollMs) {
  const [data, setData] = useState(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState(false);
  const loadedRef = useRef(false);

  // El fetcher es un método de módulo (referencia estable), así que load es estable.
  const load = useCallback(async () => {
    try {
      const d = await fetcher();
      setData(d);
      setError(false);
      setLoadedOnce(true);
      loadedRef.current = true;
      return true;
    } catch {
      setError(true);
      return false;
    }
  }, [fetcher]);

  useEffect(() => {
    let cancelled = false;
    let retryId = null;
    const attempt = async () => {
      const ok = await load();
      if (cancelled || ok || loadedRef.current) return;
      // Cold start / blip: reintento rápido hasta el primer éxito (no esperar al poll).
      retryId = setTimeout(attempt, 3000);
    };
    attempt();

    const pollId = pollMs ? setInterval(load, pollMs) : null;
    // Volver a la pestaña/dispositivo tras un rato dormido => refetch inmediato.
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      cancelled = true;
      if (retryId) clearTimeout(retryId);
      if (pollId) clearInterval(pollId);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [load, pollMs]);

  return { data, loadedOnce, error, reload: load };
}

// Mientras nunca cargó y está fallando: spinner + "Reconectando…" (el hook
// reintenta solo cada 3s). NO mostramos el estado vacío para no confundir un
// fallo de red con "no tenés mesa/turno".
const Reconnecting = () => (
  <div className="text-center py-20">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500 mx-auto mb-4" />
    <p className="text-sm text-gray-400">Reconectando…</p>
  </div>
);

// Aviso sutil cuando ya había datos buenos y un poll posterior falló: se siguen
// mostrando los últimos datos.
const StaleHint = () => (
  <p className="text-center text-[11px] text-amber-400/80 font-bold">⚠ Reconectando… mostrando últimos datos</p>
);

// ---------------------------------------------------------
// Mi mesa
// ---------------------------------------------------------
function TableTab({ now }) {
  const { data, loadedOnce, error, reload } = useDealerResource(dealerSelfService.getMyTable, 30000);
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState({});
  const [busy, setBusy] = useState({});

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
    try { await dealerSelfService.toggleBust(playerId); await reload(); }
    catch { /* noop */ } finally { setBusy((b) => ({ ...b, [playerId]: false })); }
  };

  if (!loadedOnce) return error ? <Reconnecting /> : <Spinner />;

  if (!data?.has_table) return (
    <div className="text-center py-20">
      <p className="text-5xl mb-4">☕</p>
      <p className="font-bold text-white">Sin mesa asignada</p>
      <p className="text-sm text-gray-400 mt-1">Esperá a que el cajero te asigne un turno.</p>
      {data?.dealer_name && <p className="text-xs text-gray-600 mt-3">Hola, {data.dealer_name}</p>}
    </div>
  );

  // Mesa de TORNEO: reloj + jugadores de la mesa + eliminar (Fase 1b).
  if (data.mode === 'tournament') return <TournamentTableView data={data} error={error} reload={reload} />;

  const players = data.players || [];
  const seated = players.filter((p) => !p.is_busted);
  const cap = data.max_players;
  const seats = data.seats_available;

  return (
    <div className="space-y-5">
      {error && <StaleHint />}
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

// Mesa de TORNEO del dealer: reloj del nivel + jugadores + eliminar.
const fmtClock = (secs) => {
  const s = Math.max(0, Math.floor(secs));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function TournamentTableView({ data, error, reload }) {
  const clock = data.clock || {};
  const lvl = clock.level || {};
  const [remaining, setRemaining] = useState(clock.remaining_seconds || 0);
  const [busy, setBusy] = useState({});
  const [confirmId, setConfirmId] = useState(null);

  // Resync con el dato del poll (cada 30s) y tick local de 1s si el reloj corre.
  useEffect(() => { setRemaining(clock.remaining_seconds || 0); }, [clock.remaining_seconds, clock.current_level, clock.clock_status]);
  useEffect(() => {
    if (clock.clock_status !== 'RUNNING') return undefined;
    const id = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(id);
  }, [clock.clock_status, clock.remaining_seconds, clock.current_level]);

  const eliminate = async (pid) => {
    if (busy[pid]) return;
    if (confirmId !== pid) { setConfirmId(pid); setTimeout(() => setConfirmId((c) => (c === pid ? null : c)), 3000); return; }
    setConfirmId(null);
    setBusy((b) => ({ ...b, [pid]: true }));
    try { await dealerSelfService.eliminate(pid); await reload(); }
    catch { /* noop */ } finally { setBusy((b) => ({ ...b, [pid]: false })); }
  };

  const players = data.players || [];
  const cap = data.max_players;
  const seats = data.seats_available;
  const running = clock.clock_status === 'RUNNING';

  return (
    <div className="space-y-5">
      {error && <StaleHint />}
      <div className="text-center">
        <p className="text-[11px] text-violet-300/80 font-bold uppercase tracking-widest">{data.tournament_name}</p>
        <h1 className="text-2xl font-black text-white mt-0.5">{data.table_name}</h1>
      </div>

      {/* Reloj del nivel */}
      <div className="bg-gradient-to-b from-violet-900/30 to-gray-900/40 border border-violet-500/30 rounded-2xl p-4 text-center">
        <p className="text-[10px] text-violet-300/70 font-bold uppercase tracking-widest">
          {lvl.is_break ? 'Break' : `Nivel ${clock.current_level || 1}`}
          {clock.total_levels ? <span className="text-gray-600"> / {clock.total_levels}</span> : null}
        </p>
        <p className={`text-5xl font-black font-mono my-1 ${running ? 'text-white' : 'text-gray-500'}`}>{fmtClock(remaining)}</p>
        {!lvl.is_break && (lvl.big_blind ? (
          <p className="text-sm text-violet-200 font-bold">Blinds {lvl.small_blind}/{lvl.big_blind}{lvl.ante ? ` · ante ${lvl.ante}` : ''}</p>
        ) : null)}
        {!running && <p className="text-[10px] text-amber-400/80 font-bold uppercase mt-1">{clock.clock_status === 'PAUSED' ? 'Pausado' : 'Detenido'}</p>}
      </div>

      {/* Cupos */}
      {cap != null && (
        <div className="bg-gray-800/50 border border-gray-700/60 rounded-2xl px-4 py-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-bold text-white">{players.length}/{cap} en mesa</span>
            <span className={`font-bold ${seats > 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
              {seats > 0 ? `${seats} cupo${seats !== 1 ? 's' : ''} libre${seats !== 1 ? 's' : ''}` : 'Mesa llena'}
            </span>
          </div>
        </div>
      )}

      {/* Jugadores */}
      <section className="space-y-2">
        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Jugadores en tu mesa</p>
        {players.length === 0 && (
          <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl px-4 py-6 text-center text-gray-500 text-sm">Aún no hay jugadores sentados.</div>
        )}
        {players.map((p) => (
          <div key={p.player_id} className="rounded-xl px-4 py-3 flex items-center justify-between gap-3 border bg-gray-800/60 border-gray-700/60">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="shrink-0 w-6 h-6 rounded-full bg-violet-500/15 text-violet-300 text-xs font-black flex items-center justify-center">{p.seat_number ?? '·'}</span>
              <p className="font-bold text-white truncate">{p.name}</p>
            </div>
            <button
              onClick={() => eliminate(p.player_id)}
              disabled={busy[p.player_id]}
              className={`shrink-0 text-xs font-bold px-3 py-2 rounded-lg transition-all active:scale-95 disabled:opacity-40 ${confirmId === p.player_id ? 'bg-red-500 text-white' : 'bg-red-600/80 hover:bg-red-500 text-white'}`}
            >
              {busy[p.player_id] ? '…' : confirmId === p.player_id ? '¿Seguro?' : 'Eliminar'}
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}

// ---------------------------------------------------------
// Turno actual
// ---------------------------------------------------------
function ShiftTab() {
  const { data, loadedOnce, error } = useDealerResource(dealerSelfService.getMyShift);
  if (!loadedOnce) return error ? <Reconnecting /> : <Spinner />;
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
  const { data, loadedOnce, error } = useDealerResource(dealerSelfService.getMyHistory);
  if (!loadedOnce) return error ? <Reconnecting /> : <Spinner />;
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
  const { data, loadedOnce, error } = useDealerResource(dealerSelfService.getMySummary);
  if (!loadedOnce) return error ? <Reconnecting /> : <Spinner />;
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
