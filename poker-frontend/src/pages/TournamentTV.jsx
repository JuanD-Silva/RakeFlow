import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { publicService } from '../api/services';

/**
 * Vista TV pública del torneo (sin login) — para proyectar en una pantalla.
 * Reloj grande + blinds + conteo de jugadores. El backend es la fuente de verdad
 * del tiempo; acá interpolamos localmente entre polls (mismo patrón que el reloj
 * del director y el cronómetro del dealer). Cero datos sensibles.
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

  // Reloj corriendo: cuenta regresiva contra endsAt. Pausado/detenido: estático.
  const remaining = running && endsAt != null
    ? Math.max(0, (endsAt - now) / 1000)
    : (clock.remaining_seconds ?? 0);
  const levelOver = remaining <= 0 && !!level;

  const statusPill = running
    ? { txt: '● EN VIVO', cls: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40' }
    : clock.clock_status === 'PAUSED'
      ? { txt: '⏸ PAUSADO', cls: 'bg-amber-500/15 text-amber-300 ring-amber-500/40' }
      : { txt: '■ POR INICIAR', cls: 'bg-gray-600/20 text-gray-300 ring-gray-500/40' };

  return (
    <div className={`min-h-screen w-full flex flex-col text-white overflow-hidden ${
      isBreak ? 'bg-gradient-to-b from-sky-950 via-[#070b14] to-black' : 'bg-gradient-to-b from-violet-950/70 via-[#070b14] to-black'
    }`}>
      {/* Encabezado */}
      <header className="flex items-center justify-between px-6 md:px-12 pt-6 md:pt-8 shrink-0">
        <div className="min-w-0">
          <p className="text-[11px] md:text-sm font-bold uppercase tracking-[0.3em] text-violet-300/80 truncate">{data.club_name}</p>
          <h1 className="text-xl md:text-4xl font-black uppercase tracking-tight truncate">{data.tournament_name}</h1>
        </div>
        <span className={`shrink-0 text-xs md:text-base font-black uppercase px-3 md:px-4 py-1.5 md:py-2 rounded-full ring-1 ${statusPill.cls}`}>
          {statusPill.txt}
          {error && <span className="ml-2 text-amber-400/80" title="Reconectando">⚠</span>}
        </span>
      </header>

      {/* Centro: reloj + blinds */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 gap-4 md:gap-8">
        <p className="text-sm md:text-2xl font-bold uppercase tracking-[0.3em] text-gray-400">
          {isBreak ? 'Descanso' : `Nivel ${clock.current_level}`}
          <span className="text-gray-600"> / {clock.total_levels}</span>
        </p>

        <div className={`font-mono font-black leading-none tabular-nums text-center ${
          levelOver && !isBreak ? 'text-red-400 animate-pulse' : isBreak ? 'text-sky-300' : 'text-white'
        }`} style={{ fontSize: 'clamp(5rem, 26vw, 20rem)' }}>
          {fmtClock(remaining)}
        </div>

        {isBreak ? (
          <p className="text-3xl md:text-6xl font-black text-sky-300">☕ BREAK</p>
        ) : (
          <div className="text-center">
            <p className="text-xs md:text-xl font-bold uppercase tracking-[0.3em] text-gray-500 mb-1 md:mb-2">Blinds</p>
            <p className="font-black tabular-nums leading-none" style={{ fontSize: 'clamp(2.5rem, 11vw, 8rem)' }}>
              {cop(level?.small_blind)} <span className="text-gray-600">/</span> {cop(level?.big_blind)}
            </p>
            {level?.ante > 0 && (
              <p className="text-violet-300/90 text-lg md:text-3xl font-bold mt-1 md:mt-2">ante {cop(level.ante)}</p>
            )}
          </div>
        )}
      </main>

      {/* Pie: próximo nivel + jugadores */}
      <footer className="shrink-0 grid grid-cols-2 gap-4 px-6 md:px-12 pb-6 md:pb-10 text-center">
        <div className="bg-white/5 rounded-2xl py-3 md:py-5 border border-white/10">
          <p className="text-[10px] md:text-sm font-bold uppercase tracking-widest text-gray-500">Siguiente</p>
          <p className="text-lg md:text-3xl font-black mt-0.5 md:mt-1">
            {clock.next_level
              ? (clock.next_level.is_break ? '☕ Break' : `${cop(clock.next_level.small_blind)} / ${cop(clock.next_level.big_blind)}`)
              : '—'}
          </p>
        </div>
        <div className="bg-white/5 rounded-2xl py-3 md:py-5 border border-white/10">
          <p className="text-[10px] md:text-sm font-bold uppercase tracking-widest text-gray-500">Jugadores</p>
          <p className="text-lg md:text-3xl font-black mt-0.5 md:mt-1 text-emerald-300">
            {data.players_active}<span className="text-gray-600"> / {data.players_registered}</span>
          </p>
        </div>
      </footer>
    </div>
  );
}
