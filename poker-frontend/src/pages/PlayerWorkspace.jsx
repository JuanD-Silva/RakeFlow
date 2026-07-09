import { useEffect, useState, useCallback, useRef } from 'react';
import confetti from 'canvas-confetti';
import { playerSelfService } from '../api/services';
import { useAuth } from '../context/AuthContext';
import ProfitSparkline from '../components/ProfitSparkline';
import PlayerShareCard from '../components/PlayerShareCard';
import AchievementShareCard from '../components/AchievementShareCard';
import { cop, signCop, fmtDate, monthName } from '../utils/formatters';

// Panel del Jugador (clon estructural de DealerWorkspace: móvil-first, max-w-md,
// bottom-nav). PR3: Inicio + Historial. PR4: Logros (badges + confetti),
// Ranking (posición propia) y card mensual compartible.

// Íconos de la bottom-nav: set SVG line consistente (Lucide) en vez de emojis
// —que se renderizan distinto por SO y dan aire casero—. Los emojis expresivos
// de las cards (🔥 racha, 🏅 destaque, 🎯 reto…) SÍ se conservan: ahí comunican.
const NavIcon = ({ className, children }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    {children}
  </svg>
);
const IconInicio = (p) => <NavIcon {...p}><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 22V12h6v10" /></NavIcon>;
const IconHistorial = (p) => <NavIcon {...p}><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" /></NavIcon>;
const IconLogros = (p) => <NavIcon {...p}><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></NavIcon>;
const IconRanking = (p) => <NavIcon {...p}><path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526" /><circle cx="12" cy="8" r="6" /></NavIcon>;
// Ícono de tipo de sesión en el Historial (reemplaza los emojis 🃏/🏆 de fila):
// pica (cash) / trofeo (torneo).
const TypeIcon = ({ type, className }) => type === 'tournament'
  ? <NavIcon className={className}><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></NavIcon>
  : <NavIcon className={className}><path d="M5 9c-1.5 1.5-3 3.2-3 5.5A5.5 5.5 0 0 0 7.5 20c1.8 0 3-.5 4.5-2 1.5 1.5 2.7 2 4.5 2a5.5 5.5 0 0 0 5.5-5.5c0-2.3-1.5-4-3-5.5l-7-7-7 7Z" /><path d="M12 18v4" /></NavIcon>;

const TABS = [
  { key: 'inicio', label: 'Inicio', Icon: IconInicio },
  { key: 'historial', label: 'Historial', Icon: IconHistorial },
  { key: 'logros', label: 'Logros', Icon: IconLogros },
  { key: 'ranking', label: 'Ranking', Icon: IconRanking },
];

const TIER_STYLE = {
  Bronce: 'from-amber-800 to-amber-700 text-amber-100',
  Plata: 'from-slate-500 to-slate-400 text-white',
  Oro: 'from-yellow-600 to-amber-500 text-white',
  Diamante: 'from-cyan-500 to-blue-500 text-white',
};

// --- Motion helpers (PR10). Todo respeta prefers-reduced-motion. ---
function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduce(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduce;
}

// Cuenta hacia el valor (celebración/glanceabilidad). render(v) formatea el número
// en curso. Con reduced-motion salta directo al final.
function CountUp({ value, render = (v) => Math.round(v), duration = 900, className }) {
  const reduce = usePrefersReducedMotion();
  const [v, setV] = useState(reduce ? value : 0);
  useEffect(() => {
    if (reduce) { setV(value); return; }
    let raf, start;
    const step = (t) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / duration);
      setV(value * (1 - Math.pow(1 - p, 3)));   // easeOutCubic
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, reduce]);
  return <span className={className}>{render(v)}</span>;
}

// Sección que entra escalonada al cargar (peak-end: la apertura "respira").
const Section = ({ i = 0, className = '', children }) => (
  <div className={`rf-in ${className}`} style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}>{children}</div>
);

// Skeletons de carga (percepción de velocidad; reemplazan el spinner pelado).
const HomeSkeleton = () => (
  <div className="space-y-5">
    <div className="rf-skel h-8 w-2/3 mx-auto" />
    <div className="rf-skel h-24 w-full" />
    <div className="rf-skel h-16 w-full" />
    <div className="grid grid-cols-2 gap-3">
      <div className="rf-skel h-20" /><div className="rf-skel h-20" />
    </div>
    <div className="rf-skel h-28 w-full" />
  </div>
);
const ListSkeleton = () => (
  <div className="space-y-3">
    <div className="rf-skel h-6 w-40" />
    <div className="rf-skel h-24 w-full" />
    {[0, 1, 2, 3].map((i) => <div key={i} className="rf-skel h-16 w-full" />)}
  </div>
);
const GridSkeleton = () => (
  <div className="space-y-4">
    <div className="rf-skel h-6 w-40" />
    <div className="rf-skel h-2.5 w-full" />
    <div className="grid grid-cols-2 gap-3">
      {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="rf-skel h-32" />)}
    </div>
  </div>
);

export default function PlayerWorkspace() {
  const { logout } = useAuth();
  const [tab, setTab] = useState('inicio');
  // El club protagoniza el header: el jugador es cliente del CLUB, no del SaaS.
  // Se lo pasamos a HomeTab para no duplicar el GET /player/club-info.
  const { data: club, error: clubError } = usePlayerResource(playerSelfService.getClubInfo);
  // El perfil se sube acá (un solo fetch, se pasa a HomeTab): además de alimentar
  // el Inicio, decide el AURA VIP que envuelve TODA la pantalla del pilar del club.
  const { data: profile, loadedOnce: profileLoaded, error: profileError } = usePlayerResource(playerSelfService.getProfile);
  const isVip = !!profile?.is_vip;

  return (
    <div className={`relative min-h-screen text-gray-100 font-sans ${isVip ? 'rf-aura' : 'bg-gradient-to-b from-[#0b1220] via-[#0a0f1a] to-black'}`}>
      {/* Aura VIP: halo dorado que respira en los bordes de toda la pantalla. */}
      {isVip && <div className="pointer-events-none fixed inset-0 z-0 rf-aura-ring" aria-hidden="true" />}
      {/* pb reserva el alto de la nav + el home-indicator del iPhone (safe-area).
          `relative` SIN z-index: mantiene el contenido sobre el aura-ring por orden
          de árbol pero NO crea stacking context, así el modal de compartir (z-50)
          escapa por encima de la bottom-nav (z-20) en vez de quedar atrapado. */}
      <div className="relative max-w-md mx-auto px-4 py-6 pb-[calc(6.5rem+env(safe-area-inset-bottom))] min-h-screen flex flex-col">
        <header className="flex items-center justify-between gap-3 mb-5">
          {/* No es <h1>: el título de contenido de cada tab (ej. "Hola, …") es el
              h1. Acá el club es contexto/marca. En outage sostenido de club-info
              cae a un texto neutro en vez de un skeleton eterno. */}
          <div className="min-w-0">
            {club?.club_name
              ? <p className="text-white text-lg font-black tracking-tight leading-none truncate">{club.club_name}</p>
              : clubError
                ? <p className="text-white text-lg font-black tracking-tight leading-none">Tu panel</p>
                : <div className="rf-skel h-5 w-28" />}
            <p className="text-emerald-500/80 text-[9px] font-black tracking-[0.28em] uppercase mt-1">Panel del jugador</p>
          </div>
          <button onClick={logout} className="rf-tap shrink-0 text-xs text-gray-400 hover:text-white font-bold px-2 py-1">Salir</button>
        </header>

        {/* flex-1 empuja el footer al fondo cuando el contenido es corto (Ranking),
            sin afectar las vistas largas (Inicio). */}
        <div className="flex-1">
          {tab === 'inicio' && <HomeTab club={club} data={profile} loaded={profileLoaded} error={profileError} />}
          {tab === 'historial' && <HistoryTab />}
          {tab === 'logros' && <AchievementsTab club={club} profile={profile} />}
          {tab === 'ranking' && <RankingTab />}
        </div>

        <footer className="mt-10 text-center">
          <p className="text-[10px] text-gray-600 font-black tracking-[0.25em] uppercase">RakeFlow</p>
        </footer>
      </div>

      <nav className="fixed bottom-0 inset-x-0 z-20 bg-[#0a0f1a]/95 backdrop-blur border-t border-gray-800 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-md mx-auto grid grid-cols-4">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                aria-current={active ? 'page' : undefined}
                className={`relative rf-tap py-2.5 flex flex-col items-center gap-1 text-[10px] font-bold ${
                  active ? 'text-emerald-400' : 'text-gray-500'
                }`}
              >
                {active && <span className="absolute top-0 h-[3px] w-8 rounded-full bg-emerald-400" />}
                <t.Icon className={`w-[22px] h-[22px] transition-transform duration-200 motion-reduce:transition-none ${active ? 'scale-110' : ''}`} />
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

// Mismo cargador resiliente del portal del dealer (cold start de Railway /
// pestaña dormida): reintenta rápido hasta el primer éxito y refetchea al
// volver a la pestaña; nunca confunde "falló" con "vacío".
function usePlayerResource(fetcher, pollMs) {
  const [data, setData] = useState(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState(false);
  const loadedRef = useRef(false);
  // Si el fetcher cambia (ej: Ranking navegando meses), una respuesta en vuelo
  // del fetcher viejo puede llegar DESPUÉS que la nueva y pisarla. Se descarta
  // todo lo que no venga del fetcher vigente.
  const fetcherRef = useRef(fetcher);

  const load = useCallback(async () => {
    try {
      const d = await fetcher();
      if (fetcherRef.current !== fetcher) return true; // respuesta vieja: se descarta
      setData(d);
      setError(false);
      setLoadedOnce(true);
      loadedRef.current = true;
      return true;
    } catch {
      if (fetcherRef.current === fetcher) setError(true);
      return false;
    }
  }, [fetcher]);

  useEffect(() => {
    fetcherRef.current = fetcher;
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
  }, [load, pollMs, fetcher]);

  return { data, loadedOnce, error, reload: load };
}

const Reconnecting = () => (
  <div className="text-center py-20">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500 mx-auto mb-4" />
    <p className="text-sm text-gray-400">Reconectando…</p>
  </div>
);

const EmptyState = ({ emoji, title, subtitle }) => (
  <div className="text-center py-20">
    <p className="text-5xl mb-4">{emoji}</p>
    <p className="font-bold text-white">{title}</p>
    <p className="text-sm text-gray-400 mt-1">{subtitle}</p>
  </div>
);

// ---------------------------------------------------------
// Inicio: nivel, racha, el mes, totales, archivo y club
// ---------------------------------------------------------
function HomeTab({ club, data, loaded, error }) {
  const { data: challengeData } = usePlayerResource(playerSelfService.getChallenge);
  const { data: highlightData } = usePlayerResource(playerSelfService.getHighlight);
  const [showShare, setShowShare] = useState(false);
  const [showVipShare, setShowVipShare] = useState(false);
  const [showChallengeShare, setShowChallengeShare] = useState(false);
  if (!loaded) return error ? <Reconnecting /> : <HomeSkeleton />;
  if (!data) return null;

  const t = data.totals;
  const lvl = data.level;
  const st = data.streak;
  const sc = data.self_compare || {};
  const challenge = challengeData?.challenge || null;
  const highlight = highlightData?.highlight || null;
  const clubName = club?.club_name;

  return (
    <div className="space-y-4">
      {/* Distinción VIP (pilar del club). Es lo PRIMERO que ve: se siente importante.
          Reconocimiento, no plata — jamás muestra el volumen (no premiamos el gasto
          a la vista). Solo aparece si el backend lo marca (top del club por volumen). */}
      {data.is_vip && (
        <button onClick={() => setShowVipShare(true)} aria-label="Compartir mi estatus de Miembro distinguido"
          className="rf-tap rf-in relative overflow-hidden w-full text-left rounded-2xl border border-cyan-400/50 bg-gradient-to-r from-cyan-500/25 via-sky-500/10 to-blue-500/15 px-4 py-3 flex items-center gap-3 shadow-lg shadow-cyan-900/20">
          <span className="text-2xl shrink-0">💎</span>
          <span className="min-w-0 flex-1 block">
            <span className="block text-cyan-200 font-black tracking-wide text-sm leading-tight">Miembro distinguido</span>
            <span className="block text-[11px] text-cyan-100/70 font-bold leading-tight">Uno de los pilares {club?.club_name ? `de ${club.club_name}` : 'del club'}</span>
          </span>
          <span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-cyan-300/90 whitespace-nowrap">📤 Compartir</span>
        </button>
      )}

      {/* Apertura (peak-end): glow atmosférico + nivel como métrica-héroe grande.
          Los tiers son la palanca de retención del jugador recreativo → protagonista. */}
      <div className="relative rf-glow pt-1">
        <div className="relative text-center mb-4">
          <h1 className="text-[1.7rem] leading-tight font-black text-white tracking-tight">Hola, {data.player_name} 👋</h1>
        </div>

        <Section i={0} className="relative bg-gradient-to-br from-gray-800/70 to-gray-900/50 border border-gray-700/60 rounded-2xl p-5 shadow-lg shadow-black/30">
          <div className="flex items-center justify-between">
            <span className={`text-xs font-black uppercase tracking-wider px-3 py-1.5 rounded-full bg-gradient-to-r ${TIER_STYLE[lvl.tier] || TIER_STYLE.Bronce}`}>
              {lvl.tier === 'Diamante' ? '💎' : lvl.tier === 'Oro' ? '🥇' : lvl.tier === 'Plata' ? '🥈' : '🥉'} {lvl.tier}
            </span>
            <span className="text-[10px] text-gray-400 font-black uppercase tracking-[0.2em]">Nivel</span>
          </div>
          <div className="mt-2.5 flex items-baseline gap-2">
            <CountUp value={lvl.visits ?? 0} className="text-[2.75rem] font-black text-white nums leading-none tracking-tight" />
            <span className="text-sm text-gray-400 font-bold">visita{lvl.visits !== 1 ? 's' : ''}</span>
          </div>
          {lvl.next_tier && (
            <>
              <div className="mt-3 h-2.5 rounded-full bg-gray-700/60 overflow-hidden">
                <div className="rf-bar h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full" style={{ width: `${lvl.progress_pct}%` }} />
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">
                A <b className="text-gray-300 nums">{lvl.next_tier_at - lvl.visits}</b> visita{lvl.next_tier_at - lvl.visits !== 1 ? 's' : ''} de <b className="text-gray-300">{lvl.next_tier}</b>
              </p>
            </>
          )}
        </Section>
      </div>

      {/* Destaque: peak positivo NO-monetario. El mejor "Top X%" del jugador en el
          club (horas / visitas / constancia) — un estado ganador honesto para el
          que no tiene profit que lucir. Solo su posición (nunca otros). Si no
          llega al tercio superior en nada, no aparece: no forzamos un top falso. */}
      {highlight && (
        <Section i={1} className="rounded-2xl px-4 py-3.5 border bg-gradient-to-br from-emerald-900/25 to-gray-900/40 border-emerald-500/40 flex items-center gap-3">
          <span className="text-2xl">🏅</span>
          <div className="min-w-0">
            <p className="text-[10px] font-black text-emerald-400/80 uppercase tracking-[0.18em]">Tu lugar en {club?.club_name || 'el club'}</p>
            <p className="text-white font-black truncate">{highlight.label}</p>
          </div>
        </Section>
      )}

      {/* Racha (loss-aversion): la llama viva refuerza que hay algo que proteger. */}
      {st.weeks > 0 && (
        <Section i={2} className={`rounded-2xl px-4 py-3.5 border flex items-center gap-3 ${st.at_risk ? 'bg-amber-900/25 border-amber-600/50' : 'bg-gray-800/50 border-gray-700/60'}`}>
          <span className={`text-2xl ${st.at_risk ? 'rf-flame' : ''}`}>🔥</span>
          <div>
            <p className="text-sm font-bold text-white"><span className="nums">{st.weeks}</span> semana{st.weeks !== 1 ? 's' : ''} seguida{st.weeks !== 1 ? 's' : ''} viniendo</p>
            {st.at_risk && <p className="text-[11px] text-amber-300 font-bold">Tu racha se corta el domingo — pasá por el club esta semana</p>}
          </div>
        </Section>
      )}

      {/* Reto del mes — contenido que ROTA (combate el novelty effect de los
          badges fijos). Progreso atado a competencia sentida (barra hacia meta),
          no a un sticker. La recompensa la entrega el staff en caja. */}
      {challenge && (
        <Section i={3} className={`rounded-2xl p-4 border ${challenge.progress.done ? 'bg-emerald-900/25 border-emerald-500/50' : 'bg-gradient-to-br from-violet-900/30 to-gray-900/40 border-violet-500/40'}`}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-black text-violet-300 uppercase tracking-widest">🎯 Reto del mes</p>
            {challenge.progress.done
              ? <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-500 text-black">¡Logrado!</span>
              : challenge.tiers && (
                  <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-200 nums">
                    {challenge.progress.completed}/{challenge.tiers.length}
                  </span>
                )}
          </div>
          <p className="mt-1.5 text-white font-black">{challenge.title}</p>
          {challenge.description && <p className="text-xs text-gray-400 mt-0.5">{challenge.description}</p>}
          <div className="mt-3 h-2.5 rounded-full bg-gray-700/60 overflow-hidden">
            <div className={`rf-bar h-full rounded-full ${challenge.progress.done ? 'bg-gradient-to-r from-emerald-500 to-emerald-400' : 'bg-gradient-to-r from-violet-500 to-violet-400'}`}
              style={{ width: `${Math.min(100, Math.round((100 * challenge.progress.current) / challenge.progress.target))}%` }} />
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <p className="text-[11px] text-gray-400 nums">
              {challenge.progress.current} / {challenge.progress.target} {challenge.metric}
            </p>
            {!challenge.tiers && challenge.reward_text && (
              <p className="text-[11px] text-violet-300/90 font-bold">🎁 {challenge.reward_text}</p>
            )}
          </div>
          {/* Escalonado: la escalera de tramos con su estado y la recompensa que
              le toca a ESTE jugador (el backend ya eligió VIP vs base). */}
          {challenge.tiers && (
            <ul className="mt-3 space-y-1.5">
              {challenge.tiers.map((t, i) => (
                <li key={i} className={`flex items-center gap-2 text-[11px] ${t.done ? 'text-emerald-300' : 'text-gray-400'}`}>
                  <span className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black ${t.done ? 'bg-emerald-500 text-black' : 'bg-gray-700 text-gray-500'}`}>
                    {t.done ? '✓' : i + 1}
                  </span>
                  <span className="nums font-bold shrink-0">{t.target} {challenge.metric}</span>
                  {t.reward && <span className="text-gray-500 truncate">· 🎁 {t.reward}</span>}
                </li>
              ))}
            </ul>
          )}
          {/* Logrado → presumirlo: card-imagen del reto (no un link). */}
          {challenge.progress.done && (
            <button onClick={() => setShowChallengeShare(true)}
              className="rf-tap w-full mt-3 py-2.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-xs font-black uppercase tracking-wide">
              📤 Compartir mi logro
            </button>
          )}
        </Section>
      )}

      {/* Horas esta semana — métrica-héroe donde el que pierde también progresa,
          con barra hacia el récord (goal-gradient). Solo si hay historia de horas
          (el jugador solo-torneo no tiene horas → no se muestra). */}
      {(sc.week_hours > 0 || sc.best_week_hours > 0) && (
        <Section i={4} className="bg-gray-800/50 border border-gray-700/60 rounded-2xl p-4">
          <div className="flex items-baseline justify-between">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">⏱️ Horas esta semana</p>
            <p className="text-2xl font-black text-white nums">{sc.week_hours} <span className="text-sm text-gray-400 font-bold">h</span></p>
          </div>
          {sc.best_week_hours > 0 && (
            <>
              <div className="mt-2 h-2.5 rounded-full bg-gray-700/60 overflow-hidden">
                <div className="rf-bar h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full"
                  style={{ width: `${Math.min(100, Math.round((100 * sc.week_hours) / sc.best_week_hours))}%` }} />
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">
                {sc.week_hours >= sc.best_week_hours
                  ? '🔥 ¡Récord de horas en una semana!'
                  : <>Tu récord: <b className="text-gray-300 nums">{sc.best_week_hours} h</b> · promedio <span className="nums">{sc.avg_week_hours} h</span></>}
              </p>
            </>
          )}
        </Section>
      )}

      {/* Aviso sesión en curso */}
      {data.open_session && (
        <p className="text-center text-[11px] text-emerald-300/80 font-bold">🎲 Tenés una sesión abierta — se suma a tus números al cerrar la mesa</p>
      )}

      {/* Archivo bloqueado: el gancho de la venta. Va ARRIBA de los números:
          el jugador recién activado tiene que verlo sin scrollear. */}
      {data.archive?.locked && (
        <div className="bg-gradient-to-br from-violet-900/40 to-gray-900/40 border border-violet-500/40 rounded-2xl p-4 text-center">
          <p className="text-3xl mb-1">🗄️</p>
          <p className="text-white font-black">Tu historia completa te espera</p>
          <p className="text-sm text-violet-200 mt-1">
            {/* Solo se menciona lo que HAY: "y 0 torneos" mata el pitch */}
            Tenés{' '}
            {data.archive.sessions > 0 && (
              <b>{data.archive.sessions} {data.archive.sessions !== 1 ? 'sesiones' : 'sesión'}</b>
            )}
            {data.archive.sessions > 0 && data.archive.tournaments > 0 && ' y '}
            {data.archive.tournaments > 0 && (
              <b>{data.archive.tournaments} torneo{data.archive.tournaments !== 1 ? 's' : ''}</b>
            )}
            {' '}en el archivo{data.archive.oldest ? ` desde ${fmtDate(data.archive.oldest)}` : ''}.
          </p>
          <p className="text-[11px] text-violet-300/80 font-bold uppercase tracking-wide mt-2">Preguntá en caja para desbloquearla</p>
        </div>
      )}

      {/* El mes en curso. Peak-end rule + finding on-domain: mostrar la pérdida
          como número de apertura baja las visitas al local. Lideramos con lo
          no-monetario (visitas, horas, mejor noche — donde el que pierde también
          gana); la plata del mes SOLO se muestra si ganó. El detalle (incluida la
          pérdida) queda en el Historial, no en la cara al abrir. */}
      <section className="rf-in" style={{ animationDelay: '240ms' }}>
        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">Este mes</p>
        {/* Horas = solo cash; para el jugador solo-torneo son 0 y no aportan
            protagonismo — se oculta y visitas ocupa el ancho. */}
        <div className={`grid gap-3 ${data.month.hours > 0 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <Stat label="Visitas del mes" value={`${data.month.visits}`} />
          {data.month.hours > 0 && <Stat label="Horas del mes" value={`${data.month.hours} h`} />}
        </div>

        {/* Comparación contra uno mismo (no social): nudge positivo si va por
            encima de su promedio histórico de visitas/mes. */}
        {sc.avg_month_visits > 0 && (
          <p className="text-[11px] text-gray-400 mt-2">
            {data.month.visits >= sc.avg_month_visits
              ? <>👏 Vas por encima de tu promedio (<b className="text-gray-400">{sc.avg_month_visits}/mes</b>)</>
              : <>Tu promedio son <b className="text-gray-400">{sc.avg_month_visits} visitas</b> al mes.</>}
          </p>
        )}

        {/* Mejor noche: el peak positivo. Solo si de verdad ganó una noche —
            no fabricamos un peak con la noche "menos mala". */}
        {data.best_session && data.best_session.profit > 0 && (
          <div className="mt-3 rounded-2xl p-4 border bg-emerald-900/20 border-emerald-600/40">
            <p className="text-[11px] text-emerald-400/80 font-bold uppercase tracking-wide">🌟 Tu mejor noche del mes</p>
            <p className="mt-1 text-white font-bold truncate">
              {data.best_session.name} <span className="text-emerald-300 nums">{signCop(data.best_session.profit)}</span>
            </p>
            <p className="text-[11px] text-gray-400">{fmtDate(data.best_session.date)}</p>
          </div>
        )}

        {/* Resultado en plata del mes: SOLO si ganó. Al que va en negativo no se
            le muestra la pérdida — priorizamos retención (decisión de producto:
            la pérdida es lo que más deprime la visita, Wohl 2017 + peak-end). */}
        {data.month.profit >= 0 && (
          <div className="mt-3">
            <Stat label="Resultado del mes" value={signCop(data.month.profit)} tone="good" />
          </div>
        )}

        {/* Acción de marketing boca-a-boca: se muestra como acción (acento
            emerald), no como botón secundario apagado. */}
        <button onClick={() => setShowShare(true)}
          className="rf-tap w-full mt-4 py-3 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-sm font-black uppercase tracking-wide">
          📤 Compartir mi mes
        </button>
      </section>

      {/* Totales de la historia visible. Encuadre ADAPTATIVO por resultado
          acumulado (priorizamos retención): el que va en verde luce su profit/ROI;
          al que va en negativo NO se le muestra la pérdida acumulada —que es lo que
          más deprime la visita (Wohl 2017 + peak-end)— sino su fidelidad: horas,
          visitas, sesiones. El detalle noche-por-noche sigue en el Historial. */}
      <section className="rf-in" style={{ animationDelay: '300ms' }}>
        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">Tu juego</p>
        {/* Jerarquía: 2 métricas-héroe grandes + el detalle agrupado en UNA card
            compacta (antes eran 6 cajas del mismo peso compitiendo). */}
        {t.profit >= 0 ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Resultado total" value={signCop(t.profit)} tone="good" big />
              <Stat label="ROI" value={t.roi != null ? `${(t.roi * 100).toFixed(1)}%` : '—'} tone={t.roi > 0 ? 'good' : undefined} big />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 bg-gray-800/40 border border-gray-700/50 rounded-2xl p-4">
              <Detail label="Metiste" value={cop(t.invested)} />
              <Detail label="Sacaste" value={cop(t.returned)} />
              <Detail label="$ por hora" value={t.profit_per_hour != null ? signCop(t.profit_per_hour) : '—'} />
              <Detail label="Horas en mesa" value={`${t.hours} h`} />
            </div>
            {t.expenses > 0 && (
              <p className="text-[11px] text-gray-400 mt-2">Además gastaste {cop(t.expenses)} en consumo y propinas (no cuenta en tu ROI).</p>
            )}
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Horas en mesa" value={`${t.hours} h`} big />
              <Stat label="Visitas" value={`${t.visits}`} big />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 bg-gray-800/40 border border-gray-700/50 rounded-2xl p-4">
              <Detail label="Sesiones cash" value={`${t.cash_sessions}`} />
              <Detail label="Torneos" value={`${t.tournaments}`} />
            </div>
          </>
        )}
      </section>

      {/* Razones de volver: anuncio + próximos torneos */}
      {club && (club.announcement || (club.scheduled || []).length > 0) && (
        <section className="space-y-2 rf-in" style={{ animationDelay: '360ms' }}>
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

      {showShare && <PlayerShareCard onClose={() => setShowShare(false)} />}
      {showVipShare && (
        <AchievementShareCard
          accent="vip" tag="Distinción" emoji="💎"
          kicker="Miembro distinguido"
          title={data.player_name}
          subtitle={`Uno de los pilares ${clubName ? `de ${clubName}` : 'del club'}`}
          clubName={clubName} playerName={data.player_name}
          shareText={`💎 Miembro distinguido de ${clubName || 'mi club'} — uno de los pilares del club 🃏`}
          fileSlug="miembro-distinguido"
          onClose={() => setShowVipShare(false)}
        />
      )}
      {showChallengeShare && challenge && (
        <AchievementShareCard
          accent="challenge" tag="Reto" emoji="🎯"
          kicker="Reto del mes logrado"
          title={challenge.title}
          subtitle={(() => {
            // Escalonado: al completar todo, presumir la recompensa del tramo tope
            // (ya viene elegida por VIP/base). Meta única: reward_text de siempre.
            const topReward = challenge.tiers?.length ? challenge.tiers[challenge.tiers.length - 1].reward : null;
            const reward = challenge.reward_text || topReward;
            return reward ? `🎁 ${reward}` : challenge.description;
          })()}
          clubName={clubName} playerName={data.player_name}
          shareText={`🎯 Completé el reto del mes en ${clubName || 'mi club'}: ${challenge.title} 🃏`}
          fileSlug="reto-del-mes"
          onClose={() => setShowChallengeShare(false)}
        />
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
  const [curve, setCurve] = useState([]);
  const [activityCurve, setActivityCurve] = useState([]);
  const [activityTotal, setActivityTotal] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  const loadPage = useCallback(async (skip) => {
    try {
      const d = await playerSelfService.getSessions(skip, 20);
      setItems((prev) => skip === 0 ? d.items : [...prev, ...d.items]);
      setTotal(d.total);
      setCurve(d.profit_curve || []);
      setActivityCurve(d.activity_curve || []);
      setActivityTotal(d.activity_total || '');
      setHasMore(d.has_more);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPage(0); }, [loadPage]);

  if (loading) return <ListSkeleton />;
  if (error && items.length === 0) return <Reconnecting />;
  if (items.length === 0) return (
    <div className="text-center py-20">
      <p className="text-5xl mb-4">🃏</p>
      <p className="font-bold text-white">Todavía no hay nada acá</p>
      <p className="text-sm text-gray-400 mt-1">Tu próxima visita al club va a aparecer en este historial.</p>
    </div>
  );

  // Reencuadre de la curva (adaptativo por resultado acumulado). `neg` solo si va
  // en negativo Y ya llegó la curva de actividad — blindaje de orden de deploy: si
  // el front nuevo sale antes que el backend, activityCurve viene vacío y mostramos
  // la curva de profit vieja en vez de un bloque "Tu constancia" en blanco.
  const neg = curve.length >= 2 && curve[curve.length - 1] < 0 && activityCurve.length >= 2;
  const curveGreen = neg || (curve.length >= 2 && curve[curve.length - 1] >= 0);
  // El que va en negativo abre colapsado (resumen positivo); el detalle
  // noche-por-noche —con montos reales— queda a un toque de distancia.
  const collapsed = neg && !showDetail;

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-black text-white tracking-tight">Mis sesiones <span className="text-gray-500 text-sm font-bold nums">({total})</span></h2>

      {/* Curva acumulada sobre TODO el histórico visible. Si el resultado va en
          negativo, en vez de la curva de plata (roja, cae = la pérdida acumulada,
          lo que más deprime) se muestra la de actividad (horas/visitas, verde,
          sube = "tu presencia crece"). */}
      {curve.length >= 2 && (
        <div className="rf-in bg-gray-800/50 border border-gray-700/60 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[11px] text-gray-400 font-bold uppercase tracking-wide">{neg ? 'Tu constancia' : 'Tu curva'}</p>
            <span className={`text-sm font-black nums ${curveGreen ? 'text-emerald-400' : 'text-red-400'}`}>
              {neg ? activityTotal : signCop(curve[curve.length - 1])}
            </span>
          </div>
          <ProfitSparkline points={neg ? activityCurve : curve}
            label={neg ? 'Constancia acumulada' : 'Resultado acumulado'} />
          <p className="text-[10px] text-gray-400 mt-1.5">
            {neg ? 'Tu presencia en el club, de tu primera noche a la última' : 'Resultado acumulado, de tu primera noche a la última'}
          </p>
        </div>
      )}

      {collapsed ? (
        /* El que va en negativo abre con lo positivo (su constancia, arriba) + un
           resumen no-monetario. El detalle noche-por-noche —con montos REALES— vive
           detrás de "Ver detalle": no se esconde el dato (transparencia), pero no
           golpea con un mar de rojo al abrir (Wohl 2017). */
        <>
          <div className="rf-in bg-gray-800/50 border border-gray-700/60 rounded-2xl p-5 text-center">
            <p className="text-3xl font-black text-white nums leading-none">{total}</p>
            <p className="text-sm text-gray-400 font-bold mt-1">noches en el club</p>
            {/* Solo la segunda línea si son HORAS: para el jugador solo-torneo
                activityTotal es "N visitas" (= total) y "N visitas en mesa" duplica
                el número y se lee forzado. */}
            {activityTotal.includes(' h') && <p className="text-sm text-emerald-300 font-black mt-2 nums">{activityTotal} en mesa</p>}
          </div>
          <button onClick={() => setShowDetail(true)}
            className="rf-tap w-full py-3 rounded-xl bg-gray-800/70 hover:bg-gray-700 border border-gray-700/60 text-gray-300 text-sm font-bold uppercase tracking-wide">
            Ver el detalle noche por noche
          </button>
        </>
      ) : (
        <>
          {items.map((s, i) => (
            <div key={`${s.type}-${s.date}-${i}`} className="rf-in bg-gray-800/60 border border-gray-700/60 rounded-xl px-4 py-3 flex items-center justify-between gap-3" style={{ animationDelay: `${Math.min(i, 10) * 35}ms` }}>
              <div className="min-w-0">
                <p className="text-white font-bold truncate flex items-center gap-1.5">
                  <TypeIcon type={s.type} className="w-4 h-4 shrink-0 text-gray-400" />{s.name}
                  {s.rank === 1 && <span className="shrink-0 text-[10px] font-black uppercase px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-300">Campeón</span>}
                  {s.rank > 1 && s.rank <= 3 && <span className="shrink-0 text-[10px] font-black uppercase px-1.5 py-0.5 rounded bg-gray-600/40 text-gray-300">#{s.rank}</span>}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {fmtDate(s.date)}{s.type === 'cash' && s.hours > 0 ? ` · ${s.hours} h` : ''}{s.type === 'cash' && s.spend > 0 ? ` · consumo ${cop(s.spend)}` : ''}
                </p>
              </div>
              {/* Monto real, pero el negativo en rojo SUAVIZADO (no alarmante). */}
              <span className={`font-bold whitespace-nowrap nums ${s.profit >= 0 ? 'text-emerald-400' : 'text-red-400/70'}`}>{signCop(s.profit)}</span>
            </div>
          ))}
          {hasMore && (
            <button onClick={() => loadPage(items.length)}
              className="rf-tap w-full py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-bold uppercase tracking-wide">
              Cargar más
            </button>
          )}
          {neg && (
            <button onClick={() => setShowDetail(false)}
              className="rf-tap w-full py-2 text-xs text-gray-500 hover:text-gray-300 font-bold uppercase tracking-wide">
              Ocultar detalle
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------
// Logros: grid de 12 badges + confetti al desbloquear uno nuevo
// ---------------------------------------------------------
function AchievementsTab({ club, profile }) {
  const { clubId, userId } = useAuth();
  const { data, loadedOnce, error } = usePlayerResource(playerSelfService.getAchievements);
  const [fresh, setFresh] = useState([]);
  const [shareBadge, setShareBadge] = useState(null); // badge desbloqueado a presumir
  // Línea base leída UNA vez por montaje: el effect escribe localStorage, y si
  // releyera en cada corrida (StrictMode lo corre doble) se pisaría a sí mismo
  // y el festejo no saldría nunca. null = primera visita en este dispositivo.
  const baseRef = useRef(undefined);

  // Diff contra lo último visto en ESTE dispositivo (localStorage): si hay
  // badges nuevos → confetti. La primera visita solo guarda la línea base
  // (nada de festejar en cada dispositivo nuevo lo ya ganado).
  useEffect(() => {
    if (!data) return;
    const key = `rf_badges_seen_${clubId}_${userId}`;
    const achieved = data.badges.filter((b) => b.achieved).map((b) => b.key);
    if (baseRef.current === undefined) {
      let prev = null;
      try { prev = JSON.parse(localStorage.getItem(key)); } catch { prev = null; }
      baseRef.current = Array.isArray(prev) ? prev : null;
    }
    const base = baseRef.current;
    const nuevos = base ? achieved.filter((k) => !base.includes(k)) : [];
    const persist = () => {
      baseRef.current = achieved;
      try { localStorage.setItem(key, JSON.stringify(achieved)); } catch { /* sin storage no hay festejo, no pasa nada */ }
    };
    if (nuevos.length === 0) { persist(); return; }
    // El festejo va después del primer paint: el grid se ve y AHÍ explota.
    // La línea base se persiste RECIÉN al festejar: si el tab se desmonta antes,
    // el logro queda pendiente y se celebra en la próxima visita.
    const t = setTimeout(() => {
      persist();
      setFresh(nuevos);
      confetti({ particleCount: 160, spread: 75, origin: { y: 0.6 } });
    }, 200);
    return () => clearTimeout(t);
  }, [data, clubId, userId]);

  if (!loadedOnce) return error ? <Reconnecting /> : <GridSkeleton />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="rf-in">
        <h2 className="text-xl font-black text-white tracking-tight">Mis logros</h2>
        <p className="text-sm text-gray-400 font-bold"><span className="nums">{data.unlocked_count}</span> de <span className="nums">{data.badges.length}</span> desbloqueados</p>
        <div className="mt-2 h-2.5 rounded-full bg-gray-700/60 overflow-hidden">
          <div className="rf-bar h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full" style={{ width: `${data.badges.length ? (100 * data.unlocked_count) / data.badges.length : 0}%` }} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {/* onShare solo cuando el perfil cargó: la card lleva el nombre del jugador
            (a diferencia del VIP/reto, acá el nombre viene de profile, no de data). */}
        {data.badges.map((b, i) => <BadgeCard key={b.key} badge={b} isNew={fresh.includes(b.key)} i={i} onShare={profile?.player_name ? setShareBadge : undefined} />)}
      </div>
      <p className="text-[11px] text-gray-400 text-center">Los logros se ganan jugando: cada visita cuenta.</p>
      {shareBadge && (
        <AchievementShareCard
          accent="badge" tag="Logro" emoji={shareBadge.emoji}
          kicker="Logro desbloqueado"
          title={shareBadge.name}
          subtitle={shareBadge.description}
          clubName={club?.club_name} playerName={profile?.player_name}
          shareText={`🏆 Desbloqueé "${shareBadge.name}" en ${club?.club_name || 'mi club'} 🃏`}
          fileSlug={`logro-${shareBadge.key}`}
          onClose={() => setShareBadge(null)}
        />
      )}
    </div>
  );
}

const BadgeCard = ({ badge, isNew, i = 0, onShare }) => {
  const pct = Math.min(100, Math.round((100 * badge.progress.current) / badge.progress.target));
  return (
    <div className={`rf-in relative rounded-2xl p-4 border ${badge.achieved ? 'bg-emerald-900/20 border-emerald-600/40' : 'bg-gray-800/40 border-gray-700/60'} ${isNew ? 'ring-2 ring-yellow-400' : ''}`}
      style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}>
      {isNew && <span className="absolute -top-2 right-2 text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-yellow-400 text-black">¡Nuevo!</span>}
      <p className={`text-3xl ${badge.achieved ? '' : 'grayscale opacity-60'}`}>{badge.emoji}</p>
      <p className={`mt-1 font-black text-sm ${badge.achieved ? 'text-white' : 'text-gray-400'}`}>{badge.name}</p>
      <p className="text-[10px] text-gray-400 leading-tight mt-0.5">{badge.description}</p>
      {!badge.achieved && badge.progress.target > 1 && (
        <>
          <div className="mt-2 h-1.5 rounded-full bg-gray-700/70 overflow-hidden">
            <div className="rf-bar h-full bg-gray-500 rounded-full" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[9px] text-gray-400 mt-1 font-bold nums">{badge.progress.current} / {badge.progress.target}</p>
        </>
      )}
      {/* Desbloqueado → se puede presumir como card-imagen. */}
      {badge.achieved && onShare && (
        <button onClick={() => onShare(badge)} aria-label={`Compartir logro ${badge.name}`}
          className="rf-tap mt-2 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-emerald-300/90 hover:text-emerald-200">
          📤 Compartir
        </button>
      )}
    </div>
  );
};

// ---------------------------------------------------------
// Ranking: posición propia en los rankings del mes (jamás
// nombres ni montos de otros — eso es privado de cada uno)
// ---------------------------------------------------------
// El fallback de cada card distingue "jugaste pero no aplicás a ESTE ranking"
// de "no viniste": en winners solo entran los que cerraron el mes en verde, y
// decir "sin actividad" a alguien que jugó 11 noches se lee como datos perdidos
// (pasó con el abril en rojo de Juan).
const RANK_CARDS = [
  { key: 'winners', emoji: '🏆', label: 'Ganadores del mes', fmt: (r) => signCop(r.value),
    empty: (d) => (d.active || d.spenders)
      ? 'Ese mes no cerraste en verde — acá solo entran los que terminan ganando'
      : 'Sin actividad este mes' },
  { key: 'active', emoji: '⏱️', label: 'Horas en mesa', fmt: (r) => `${r.hours} h`,
    empty: () => 'Sin horas en mesa este mes' },
  // spenders = consumo + propinas (SPEND/TIP), no buy-ins
  { key: 'spenders', emoji: '🥂', label: 'Los que más invitan', fmt: (r) => cop(r.value),
    empty: () => 'Sin consumo registrado este mes' },
];

// Encuadre favorable del ranking (evidencia: el puesto crudo bajo — "#47 de 50" —
// hunde al jugador recreativo). Podio → "#1"; tercio superior → "Top X%"; de la
// mitad para abajo NO se muestra el puesto, solo participación neutra (el valor
// de la métrica sigue visible a la derecha, así que no se esconde su desempeño).
function rankLabel(r) {
  if (r.rank === 1) return { text: `#1 de ${r.total}`, good: true };
  const pct = Math.ceil((r.rank / r.total) * 100);
  if (pct <= 33) return { text: `Top ${pct}%`, good: true };
  return { text: `En la tabla · ${r.total} jugador${r.total !== 1 ? 'es' : ''}`, good: false };
}

function RankingTab() {
  const [period, setPeriod] = useState(null); // null = mes en curso
  const fetcher = useCallback(
    () => playerSelfService.getRank(period?.year, period?.month),
    [period],
  );
  const { data, loadedOnce, error } = usePlayerResource(fetcher);

  if (!loadedOnce) return error ? <Reconnecting /> : <ListSkeleton />;
  if (!data) return null;

  const now = new Date();
  const isCurrent = data.period.year === now.getFullYear() && data.period.month === now.getMonth() + 1;
  const move = (delta) => {
    let { year, month } = data.period;
    month += delta;
    if (month === 0) { month = 12; year -= 1; }
    if (month === 13) { month = 1; year += 1; }
    if (year === now.getFullYear() && month === now.getMonth() + 1) setPeriod(null);
    else setPeriod({ year, month });
  };
  const mes = monthName(data.period.year, data.period.month);
  const inAny = RANK_CARDS.some((c) => data[c.key]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={() => move(-1)} aria-label="Mes anterior"
          className="rf-tap px-4 py-2 text-lg leading-none rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold">‹</button>
        <h2 className="text-sm font-black text-white uppercase tracking-widest">{mes} <span className="nums">{data.period.year}</span></h2>
        <button onClick={() => move(1)} disabled={isCurrent} aria-label="Mes siguiente"
          className="rf-tap px-4 py-2 text-lg leading-none rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold disabled:opacity-30">›</button>
      </div>

      {/* Celebración del #1, con distintivo propio por tipo. Prioriza HORAS
          (fidelidad): el que más viene sostiene el club aunque no gane plata.
          Horas → ⏱️ sobre verde (el color de "Constancia" del panel); ganancias →
          👑 sobre dorado. Así cada jugador tiene su propia distinción. */}
      {data.active?.rank === 1 ? (
        <div className="bg-gradient-to-br from-emerald-600/30 to-gray-900/40 border border-emerald-500/40 rounded-2xl p-4 text-center">
          <p className="text-3xl">⏱️</p>
          <p className="text-white font-black">¡Sos quien más horas juega en {mes}!</p>
        </div>
      ) : data.winners?.rank === 1 ? (
        <div className="bg-gradient-to-br from-yellow-600/30 to-gray-900/40 border border-yellow-500/40 rounded-2xl p-4 text-center">
          <p className="text-3xl">👑</p>
          <p className="text-white font-black">¡Sos el #1 ganador de {mes}!</p>
        </div>
      ) : null}

      {!inAny && (
        <EmptyState emoji="🥇" title={`Todavía no rankeás en ${mes}`}
          subtitle="Jugá una noche en el club y entrás a la tabla." />
      )}

      {inAny && RANK_CARDS.map(({ key, emoji, label, fmt, empty }, idx) => {
        const r = data[key];
        const rl = r ? rankLabel(r) : null;
        return (
          <div key={key} className="rf-in bg-gray-800/50 border border-gray-700/60 rounded-2xl px-4 py-3 flex items-center gap-3"
            style={{ animationDelay: `${idx * 70}ms` }}>
            <span className="text-2xl shrink-0">{emoji}</span>
            <div className="min-w-0 flex-1">
              <p className="text-white font-bold text-sm">{label}</p>
              <p className="text-xs text-gray-400">
                {rl ? <b className={rl.good ? 'text-emerald-300 nums' : 'text-gray-400 font-normal nums'}>{rl.text}</b> : empty(data)}
              </p>
            </div>
            {r && <span className="shrink-0 font-black text-white nums">{fmt(r)}</span>}
          </div>
        );
      })}

      <p className="text-[11px] text-gray-400 text-center">Ves solo tu posición — los números de los demás son privados, como los tuyos.</p>
    </div>
  );
}

const Stat = ({ label, value, tone, big }) => (
  <div className={`rounded-2xl p-4 border ${tone === 'good' ? 'bg-emerald-900/20 border-emerald-600/40' : tone === 'bad' ? 'bg-red-900/15 border-red-700/40' : 'bg-gray-800/50 border-gray-700/60'}`}>
    <p className="text-[11px] text-gray-400 font-bold uppercase tracking-wide">{label}</p>
    <p className={`mt-1 font-black nums leading-tight ${big ? 'text-2xl' : 'text-xl'} ${tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : 'text-white'}`}>{value}</p>
  </div>
);

// Métrica secundaria: vive agrupada dentro de una card (sin caja propia), para
// no competir con las métricas-héroe. Glanceable, cifras con tabular-nums.
const Detail = ({ label, value }) => (
  <div className="min-w-0">
    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wide truncate">{label}</p>
    <p className="mt-0.5 text-base font-black text-white nums truncate">{value}</p>
  </div>
);
