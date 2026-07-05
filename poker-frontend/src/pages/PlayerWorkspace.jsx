import { useEffect, useState, useCallback, useRef } from 'react';
import { playerSelfService } from '../api/services';
import { useAuth } from '../context/AuthContext';

// Panel del Jugador (clon estructural de DealerWorkspace: móvil-first, max-w-md,
// bottom-nav). PR3: Inicio + Historial. Logros y Ranking se completan en el
// siguiente PR (placeholder mientras tanto).

const cop = (n) => '$' + Math.round(n || 0).toLocaleString('es-CO');
const signCop = (n) => (n >= 0 ? '+' : '−') + cop(Math.abs(n || 0));
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : '';

const TABS = [
  { key: 'inicio', label: 'Inicio', emoji: '🏠' },
  { key: 'historial', label: 'Historial', emoji: '📜' },
  { key: 'logros', label: 'Logros', emoji: '🏆' },
  { key: 'ranking', label: 'Ranking', emoji: '🥇' },
];

const TIER_STYLE = {
  Bronce: 'from-amber-800 to-amber-700 text-amber-100',
  Plata: 'from-slate-500 to-slate-400 text-white',
  Oro: 'from-yellow-600 to-amber-500 text-white',
  Diamante: 'from-cyan-500 to-blue-500 text-white',
};

export default function PlayerWorkspace() {
  const { logout } = useAuth();
  const [tab, setTab] = useState('inicio');

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0b1220] via-[#0a0f1a] to-black text-gray-100 font-sans">
      <div className="max-w-md mx-auto px-4 py-6 pb-28">
        <div className="flex items-center justify-between mb-5">
          <p className="text-emerald-500 text-[11px] font-black tracking-[0.3em] uppercase">RakeFlow · Jugador</p>
          <button onClick={logout} className="text-xs text-gray-400 hover:text-white font-bold">Salir</button>
        </div>

        {tab === 'inicio' && <HomeTab />}
        {tab === 'historial' && <HistoryTab />}
        {tab === 'logros' && <ComingSoon emoji="🏆" title="Logros" />}
        {tab === 'ranking' && <ComingSoon emoji="🥇" title="Ranking" />}
      </div>

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

// Mismo cargador resiliente del portal del dealer (cold start de Railway /
// pestaña dormida): reintenta rápido hasta el primer éxito y refetchea al
// volver a la pestaña; nunca confunde "falló" con "vacío".
function usePlayerResource(fetcher, pollMs) {
  const [data, setData] = useState(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState(false);
  const loadedRef = useRef(false);

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
      retryId = setTimeout(attempt, 3000);
    };
    attempt();

    const pollId = pollMs ? setInterval(load, pollMs) : null;
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

const Reconnecting = () => (
  <div className="text-center py-20">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500 mx-auto mb-4" />
    <p className="text-sm text-gray-400">Reconectando…</p>
  </div>
);

const ComingSoon = ({ emoji, title }) => (
  <div className="text-center py-20">
    <p className="text-5xl mb-4">{emoji}</p>
    <p className="font-bold text-white">{title}</p>
    <p className="text-sm text-gray-400 mt-1">Muy pronto en tu panel.</p>
  </div>
);

// ---------------------------------------------------------
// Inicio: nivel, racha, el mes, totales, archivo y club
// ---------------------------------------------------------
function HomeTab() {
  const { data, loadedOnce, error } = usePlayerResource(playerSelfService.getProfile);
  const { data: club } = usePlayerResource(playerSelfService.getClubInfo);
  if (!loadedOnce) return error ? <Reconnecting /> : <Spinner />;
  if (!data) return null;

  const t = data.totals;
  const lvl = data.level;
  const st = data.streak;

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h1 className="text-2xl font-black text-white">Hola, {data.player_name} 👋</h1>
      </div>

      {/* Nivel con progreso */}
      <div className="bg-gray-800/50 border border-gray-700/60 rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <span className={`text-xs font-black uppercase tracking-wider px-3 py-1.5 rounded-full bg-gradient-to-r ${TIER_STYLE[lvl.tier] || TIER_STYLE.Bronce}`}>
            {lvl.tier === 'Diamante' ? '💎' : lvl.tier === 'Oro' ? '🥇' : lvl.tier === 'Plata' ? '🥈' : '🥉'} {lvl.tier}
          </span>
          <span className="text-xs text-gray-400 font-bold">{lvl.visits} visitas</span>
        </div>
        {lvl.next_tier && (
          <>
            <div className="mt-3 h-2 rounded-full bg-gray-700/70 overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${lvl.progress_pct}%` }} />
            </div>
            <p className="text-[11px] text-gray-500 mt-1.5">
              A {lvl.next_tier_at - lvl.visits} visita{lvl.next_tier_at - lvl.visits !== 1 ? 's' : ''} de <b className="text-gray-300">{lvl.next_tier}</b>
            </p>
          </>
        )}
      </div>

      {/* Racha */}
      {st.weeks > 0 && (
        <div className={`rounded-2xl px-4 py-3 border flex items-center gap-3 ${st.at_risk ? 'bg-amber-900/20 border-amber-600/40' : 'bg-gray-800/50 border-gray-700/60'}`}>
          <span className="text-2xl">🔥</span>
          <div>
            <p className="text-sm font-bold text-white">{st.weeks} semana{st.weeks !== 1 ? 's' : ''} seguida{st.weeks !== 1 ? 's' : ''} viniendo</p>
            {st.at_risk && <p className="text-[11px] text-amber-300 font-bold">Tu racha se corta el domingo — pasá por el club esta semana</p>}
          </div>
        </div>
      )}

      {/* Aviso sesión en curso */}
      {data.open_session && (
        <p className="text-center text-[11px] text-emerald-300/80 font-bold">🎲 Tenés una sesión abierta — se suma a tus números al cerrar la mesa</p>
      )}

      {/* El mes en curso */}
      <section>
        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">Este mes</p>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Resultado del mes" value={signCop(data.month.profit)} tone={data.month.profit >= 0 ? 'good' : 'bad'} />
          <Stat label="Visitas del mes" value={`${data.month.visits}`} />
        </div>
      </section>

      {/* Totales de la historia visible */}
      <section>
        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">Tu juego</p>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Resultado total" value={signCop(t.profit)} tone={t.profit >= 0 ? 'good' : 'bad'} />
          <Stat label="ROI" value={t.roi != null ? `${(t.roi * 100).toFixed(1)}%` : '—'} tone={t.roi > 0 ? 'good' : undefined} />
          <Stat label="Metiste" value={cop(t.invested)} />
          <Stat label="Sacaste" value={cop(t.returned)} />
          <Stat label="$ por hora" value={t.profit_per_hour != null ? signCop(t.profit_per_hour) : '—'} />
          <Stat label="Horas en mesa" value={`${t.hours} h`} />
        </div>
        {t.expenses > 0 && (
          <p className="text-[11px] text-gray-500 mt-2">Además gastaste {cop(t.expenses)} en consumo y propinas (no cuenta en tu ROI).</p>
        )}
      </section>

      {/* Archivo bloqueado: el gancho de la venta */}
      {data.archive?.locked && (
        <div className="bg-gradient-to-br from-violet-900/40 to-gray-900/40 border border-violet-500/40 rounded-2xl p-4 text-center">
          <p className="text-3xl mb-1">🗄️</p>
          <p className="text-white font-black">Tu historia completa te espera</p>
          <p className="text-sm text-violet-200 mt-1">
            Tenés <b>{data.archive.sessions} sesion{data.archive.sessions !== 1 ? 'es' : ''}</b> y{' '}
            <b>{data.archive.tournaments} torneo{data.archive.tournaments !== 1 ? 's' : ''}</b> en el archivo
            {data.archive.oldest ? ` desde ${fmtDate(data.archive.oldest)}` : ''}.
          </p>
          <p className="text-[11px] text-violet-300/80 font-bold uppercase tracking-wide mt-2">Preguntá en caja para desbloquearla</p>
        </div>
      )}

      {/* Razones de volver: anuncio + próximos torneos */}
      {club && (club.announcement || (club.scheduled || []).length > 0) && (
        <section className="space-y-2">
          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">{club.club_name}</p>
          {club.announcement && (
            <div className="bg-gray-800/50 border border-gray-700/60 rounded-xl px-4 py-3 text-sm text-gray-200">📣 {club.announcement}</div>
          )}
          {(club.scheduled || []).map((tor, i) => (
            <div key={i} className="bg-gray-800/50 border border-gray-700/60 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-white font-bold truncate">🏆 {tor.name}</p>
                <p className="text-xs text-gray-400">
                  {tor.scheduled_start ? new Date(tor.scheduled_start).toLocaleDateString('es-CO', { weekday: 'long', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Próximamente'}
                </p>
              </div>
              <span className="shrink-0 text-emerald-400 font-bold text-sm">{tor.buyin > 0 ? cop(tor.buyin) : 'Free'}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------
// Historial de sesiones y torneos
// ---------------------------------------------------------
function HistoryTab() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadPage = useCallback(async (skip) => {
    try {
      const d = await playerSelfService.getSessions(skip, 20);
      setItems((prev) => skip === 0 ? d.items : [...prev, ...d.items]);
      setTotal(d.total);
      setHasMore(d.has_more);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPage(0); }, [loadPage]);

  if (loading) return <Spinner />;
  if (error && items.length === 0) return <Reconnecting />;
  if (items.length === 0) return (
    <div className="text-center py-20">
      <p className="text-5xl mb-4">🃏</p>
      <p className="font-bold text-white">Todavía no hay nada acá</p>
      <p className="text-sm text-gray-400 mt-1">Tu próxima visita al club va a aparecer en este historial.</p>
    </div>
  );

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-black text-white">Mis sesiones <span className="text-gray-500 text-sm font-bold">({total})</span></h2>
      {items.map((s, i) => (
        <div key={`${s.type}-${s.date}-${i}`} className="bg-gray-800/60 border border-gray-700/60 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-white font-bold truncate flex items-center gap-1.5">
              <span className="shrink-0">{s.type === 'tournament' ? '🏆' : '🃏'}</span>{s.name}
              {s.rank === 1 && <span className="shrink-0 text-[10px] font-black uppercase px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-300">Campeón</span>}
              {s.rank > 1 && s.rank <= 3 && <span className="shrink-0 text-[10px] font-black uppercase px-1.5 py-0.5 rounded bg-gray-600/40 text-gray-300">#{s.rank}</span>}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {fmtDate(s.date)}{s.type === 'cash' && s.hours > 0 ? ` · ${s.hours} h` : ''}{s.type === 'cash' && s.spend > 0 ? ` · consumo ${cop(s.spend)}` : ''}
            </p>
          </div>
          <span className={`font-bold whitespace-nowrap ${s.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{signCop(s.profit)}</span>
        </div>
      ))}
      {hasMore && (
        <button onClick={() => loadPage(items.length)}
          className="w-full py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-bold uppercase tracking-wide">
          Cargar más
        </button>
      )}
    </div>
  );
}

const Stat = ({ label, value, tone }) => (
  <div className={`rounded-2xl p-4 border ${tone === 'good' ? 'bg-emerald-900/20 border-emerald-600/40' : tone === 'bad' ? 'bg-red-900/15 border-red-700/40' : 'bg-gray-800/50 border-gray-700/60'}`}>
    <p className="text-[11px] text-gray-400 font-bold uppercase tracking-wide">{label}</p>
    <p className={`mt-1 text-xl font-black ${tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : 'text-white'}`}>{value}</p>
  </div>
);
