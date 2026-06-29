import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { publicService } from '../api/services';

/**
 * Vista TV pública del torneo (sin login) — para proyectar en una pantalla.
 * Reloj grande + blinds + jugadores/rebuys/addons. El backend es la fuente de
 * verdad del tiempo; acá interpolamos localmente entre polls (mismo patrón que el
 * reloj del director y el cronómetro del dealer). Cero datos sensibles.
 */
const fmtClock = (secs) => {
  const s = Math.max(0, Math.round(secs));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${String(ss).padStart(2, '0')}`;
};
const cop = (n) => Number(n || 0).toLocaleString('es-CO');

export default function TournamentTV() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => Date.now());  // tick local para interpolar el reloj
  // Si el reloj corre, guardamos el instante (epoch ms) en que termina el nivel;
  // así el render es puro (resta now − endsAt, sin Date ni refs en render).
  const [endsAt, setEndsAt] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await publicService.getTournamentTV(token);
      const c = d?.clock || {};
      setData(d);
      setEndsAt(c.clock_status === 'RUNNING' ? Date.now() + (c.remaining_seconds || 0) * 1000 : null);
      setError(false);
      setLoadedOnce(true);
    } catch {
      setError(true);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const refresh = () => { load(); };
    refresh();
    const poll = setInterval(refresh, 5000);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(poll); document.removeEventListener('visibilitychange', onVisible); };
  }, [token, load]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!loadedOnce) {
    return (
      <div className="min-h-screen bg-[#070b14] flex items-center justify-center text-gray-400 text-lg">
        {error ? 'Reconectando…' : 'Cargando torneo…'}
      </div>
    );
  }

  const clock = data?.clock || {};
  const level = clock.level;
  const running = clock.clock_status === 'RUNNING';
  const isBreak = !!level?.is_break;
  // Torneo sin estructura de blinds configurada (ej. torneos viejos): estado neutro.
  const noStructure = !level || (clock.total_levels ?? 0) === 0;

  // Reloj corriendo: cuenta regresiva contra endsAt. Pausado/detenido: estático.
  const remaining = running && endsAt != null
    ? Math.max(0, (endsAt - now) / 1000)
    : (clock.remaining_seconds ?? 0);
  const levelOver = remaining <= 0 && !!level;

  const durationSec = (level?.duration_min || 0) * 60;
  const progress = durationSec > 0 ? Math.min(1, Math.max(0, 1 - remaining / durationSec)) : 0;

  const statusPill = running
    ? { txt: '● EN VIVO', cls: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40' }
    : clock.clock_status === 'PAUSED'
      ? { txt: '⏸ PAUSADO', cls: 'bg-amber-500/15 text-amber-300 ring-amber-500/40' }
      : { txt: '■ POR INICIAR', cls: 'bg-gray-600/20 text-gray-300 ring-gray-500/40' };

  return (
    <div className={`relative min-h-screen w-full flex flex-col text-white overflow-hidden bg-[#070b14]`}>
      {/* Fondo: glows + grilla sutil */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className={`absolute -top-1/4 left-1/4 w-[60vw] h-[60vw] rounded-full blur-[140px] ${isBreak ? 'bg-sky-600/10' : 'bg-violet-600/10'}`} />
        <div className="absolute bottom-0 right-1/4 w-[45vw] h-[45vw] rounded-full blur-[120px] bg-emerald-600/5" />
        <div className="absolute inset-0 opacity-[0.025]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)', backgroundSize: '64px 64px' }} />
      </div>

      {/* Encabezado: logo RakeFlow + club/torneo + estado */}
      <header className="relative z-10 flex items-center justify-between px-6 md:px-12 pt-6 md:pt-8 shrink-0 gap-4">
        <div className="flex items-center gap-3 md:gap-4 min-w-0">
          <img src="/rakeflow-logo.svg" alt="RakeFlow" className="h-9 md:h-14 w-auto drop-shadow-[0_0_12px_rgba(16,185,129,0.25)] shrink-0" />
          <div className="min-w-0">
            <p className="text-[11px] md:text-sm font-bold uppercase tracking-[0.3em] text-violet-300/80 truncate">{data.club_name}</p>
            <h1 className="text-xl md:text-4xl font-black uppercase tracking-tight truncate leading-tight">{data.tournament_name}</h1>
          </div>
        </div>
        <span className={`shrink-0 text-xs md:text-base font-black uppercase px-3 md:px-5 py-1.5 md:py-2.5 rounded-full ring-1 ${statusPill.cls}`}>
          {statusPill.txt}
          {error && <span className="ml-2 text-amber-400/80" title="Reconectando">⚠</span>}
        </span>
      </header>

      {/* Centro: reloj + blinds */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 gap-3 md:gap-6">
        {noStructure ? (
          <div className="text-center">
            <p className="font-black text-gray-200 leading-none" style={{ fontSize: 'clamp(2.5rem, 10vw, 7rem)' }}>⏳</p>
            <p className="text-2xl md:text-5xl font-black text-gray-200 mt-4">Torneo por iniciar</p>
            <p className="text-sm md:text-2xl text-gray-500 mt-3">El reloj aparece cuando el director arranca los niveles.</p>
          </div>
        ) : (
          <>
            <p className="text-sm md:text-2xl font-bold uppercase tracking-[0.3em] text-gray-400">
              {isBreak ? 'Descanso' : `Nivel ${clock.current_level}`}
              <span className="text-gray-600"> / {clock.total_levels}</span>
            </p>

            <div className={`font-mono font-black leading-none tabular-nums text-center ${
              levelOver && !isBreak ? 'text-red-400 animate-pulse' : isBreak ? 'text-sky-300' : 'text-white'
            }`} style={{ fontSize: 'clamp(5rem, 27vw, 21rem)', textShadow: '0 0 60px rgba(139,92,246,0.25)' }}>
              {fmtClock(remaining)}
            </div>

            {/* Barra de progreso del nivel */}
            <div className="w-full max-w-3xl h-1.5 md:h-2 rounded-full bg-white/10 overflow-hidden">
              <div className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${isBreak ? 'bg-sky-400' : 'bg-gradient-to-r from-violet-500 to-emerald-400'}`}
                   style={{ width: `${progress * 100}%` }} />
            </div>

            {isBreak ? (
              <p className="text-3xl md:text-6xl font-black text-sky-300 mt-2">☕ BREAK</p>
            ) : (
              <div className="text-center mt-1 md:mt-2">
                <p className="text-xs md:text-xl font-bold uppercase tracking-[0.3em] text-gray-500 mb-1 md:mb-2">Blinds</p>
                <p className="font-black tabular-nums leading-none" style={{ fontSize: 'clamp(2.5rem, 11vw, 8rem)' }}>
                  {cop(level?.small_blind)} <span className="text-violet-500/70">/</span> {cop(level?.big_blind)}
                </p>
                {level?.ante > 0 && (
                  <p className="text-violet-300/90 text-lg md:text-3xl font-bold mt-1 md:mt-2">ante {cop(level.ante)}</p>
                )}
              </div>
            )}
            {data.starting_stack > 0 && (
              <p className="text-gray-500 text-xs md:text-lg font-bold mt-1 uppercase tracking-widest">Stack inicial {cop(data.starting_stack)}</p>
            )}
          </>
        )}
      </main>

      {/* Pie: stats del torneo */}
      <footer className="relative z-10 shrink-0 grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 px-6 md:px-12 pb-6 md:pb-10">
        <StatCard label="Jugadores" emoji="👥"
          value={<><span className="text-emerald-300">{data.players_active}</span><span className="text-gray-600"> / {data.players_registered}</span></>} />
        <StatCard label="Rebuys" emoji="🔁" value={data.rebuys_total ?? 0} />
        <StatCard label="Add-ons" emoji="➕" value={data.addons_total ?? 0} />
        <StatCard label="Siguiente" emoji="⏭"
          value={noStructure || !clock.next_level
            ? '—'
            : (clock.next_level.is_break ? '☕ Break' : `${cop(clock.next_level.small_blind)}/${cop(clock.next_level.big_blind)}`)} />
      </footer>
    </div>
  );
}

const StatCard = ({ label, emoji, value }) => (
  <div className="bg-white/[0.04] rounded-2xl py-3 md:py-5 px-3 border border-white/10 text-center backdrop-blur-sm">
    <p className="text-[10px] md:text-sm font-bold uppercase tracking-widest text-gray-500">
      <span className="mr-1">{emoji}</span>{label}
    </p>
    <p className="text-lg md:text-3xl font-black mt-0.5 md:mt-1 tabular-nums">{value}</p>
  </div>
);
