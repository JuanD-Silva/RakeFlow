import { useEffect, useState, useCallback, useRef } from 'react';
import { tournamentService } from '../api/services';
import {
  PlayIcon, PauseIcon, ChevronLeftIcon, ChevronRightIcon,
} from '@heroicons/react/24/solid';

/**
 * Reloj del torneo (vista del director). El backend es la fuente de verdad del
 * tiempo (elapsed/remaining); acá sólo tickeamos localmente cada segundo a partir
 * del último estado servido y resincronizamos con un poll cada 10s. Mismo espíritu
 * que el cronómetro del dealer: nunca confiamos en el reloj del navegador como
 * fuente, sólo para interpolar entre polls.
 */
const fmtClock = (secs) => {
  const s = Math.max(0, Math.round(secs));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${String(ss).padStart(2, '0')}`;
};

const cop = (n) => Number(n || 0).toLocaleString('es-CO');

export default function TournamentClock({ tournament }) {
  const tournamentId = tournament?.id;
  const [clock, setClock] = useState(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, forceTick] = useState(0); // sólo para re-renderizar el contador local cada segundo
  const fetchedAtRef = useRef(0);

  const apply = useCallback((state) => {
    setClock(state);
    fetchedAtRef.current = Date.now();
    setError(false);
    setLoadedOnce(true);
  }, []);

  const load = useCallback(async () => {
    if (!tournamentId) return;
    try { apply(await tournamentService.getClock(tournamentId)); }
    catch { setError(true); }
  }, [tournamentId, apply]);

  // Carga inicial + poll de resync + refetch al volver a la pestaña.
  useEffect(() => {
    if (!tournamentId) return;
    load();
    const poll = setInterval(load, 10000);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(poll); document.removeEventListener('visibilitychange', onVisible); };
  }, [tournamentId, load]);

  // Tick local cada segundo (sólo re-renderiza; el cálculo usa el último estado).
  useEffect(() => {
    const id = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const control = async (fn) => {
    if (busy || !tournamentId) return;
    setBusy(true);
    try { apply(await fn(tournamentId)); }
    catch { setError(true); }
    finally { setBusy(false); }
  };

  if (!loadedOnce) {
    return (
      <div className="mb-6 rounded-2xl border border-violet-500/30 bg-gray-900/60 p-6 text-center text-sm text-gray-400">
        {error ? 'Reconectando con el reloj…' : 'Cargando reloj…'}
      </div>
    );
  }

  const level = clock?.level;
  const running = clock?.clock_status === 'RUNNING';
  const isBreak = !!level?.is_break;

  // Tiempo restante interpolado localmente desde el último estado servido.
  const driftSec = running ? (Date.now() - fetchedAtRef.current) / 1000 : 0;
  const remaining = Math.max(0, (clock?.remaining_seconds ?? 0) - driftSec);
  const levelOver = remaining <= 0;

  const statusPill = running
    ? { txt: '● En vivo', cls: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' }
    : clock?.clock_status === 'PAUSED'
      ? { txt: '⏸ Pausado', cls: 'bg-amber-500/15 text-amber-300 ring-amber-500/30' }
      : { txt: '■ Detenido', cls: 'bg-gray-600/20 text-gray-300 ring-gray-500/30' };

  return (
    <div className={`mb-6 rounded-2xl border p-5 md:p-6 transition-colors ${
      isBreak ? 'border-sky-500/40 bg-sky-950/30' : 'border-violet-500/40 bg-gradient-to-b from-violet-950/40 to-gray-900/60'
    }`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-black uppercase tracking-[0.25em] text-violet-300">⏱ Reloj del torneo</span>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded-full ring-1 ${statusPill.cls}`}>{statusPill.txt}</span>
          {error && <span className="text-[10px] text-amber-400/80 font-bold" title="Reconectando">⚠</span>}
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center gap-5">
        {/* Contador grande */}
        <div className="flex-1 text-center md:text-left">
          <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">
            {isBreak ? 'Break' : `Nivel ${clock?.current_level}`}
            <span className="text-gray-600"> / {clock?.total_levels}</span>
          </p>
          <p className={`font-mono font-black leading-none tabular-nums mt-1 text-6xl md:text-7xl ${
            levelOver ? 'text-red-400 animate-pulse' : isBreak ? 'text-sky-300' : 'text-white'
          }`}>
            {fmtClock(remaining)}
          </p>
          {levelOver && !isBreak && (
            <p className="text-red-400/90 text-xs font-bold mt-1.5">Nivel terminado · subí de nivel ▶</p>
          )}
        </div>

        {/* Blinds */}
        <div className="md:w-px md:h-20 md:bg-gray-700/60 hidden md:block" />
        <div className="flex-1">
          {isBreak ? (
            <p className="text-center md:text-left text-sky-300 font-bold text-lg">☕ Descanso</p>
          ) : (
            <>
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-1">Blinds</p>
              <p className="text-3xl md:text-4xl font-black text-white tabular-nums">
                {cop(level?.small_blind)} <span className="text-gray-500">/</span> {cop(level?.big_blind)}
              </p>
              {level?.ante > 0 && (
                <p className="text-violet-300/90 text-sm font-bold mt-0.5">ante {cop(level.ante)}</p>
              )}
            </>
          )}
          {clock?.next_level && (
            <p className="text-[11px] text-gray-500 mt-2">
              Sigue:{' '}
              {clock.next_level.is_break
                ? '☕ Break'
                : `${cop(clock.next_level.small_blind)}/${cop(clock.next_level.big_blind)}`}
            </p>
          )}
        </div>
      </div>

      {/* Controles del director */}
      <div className="grid grid-cols-3 gap-2 mt-5">
        <button
          onClick={() => control(tournamentService.clockPrevLevel)}
          disabled={busy || clock?.current_level <= 1}
          className="flex items-center justify-center gap-1.5 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 font-bold text-xs uppercase tracking-wider border border-gray-700 disabled:opacity-40 transition-all active:scale-[0.98]"
        >
          <ChevronLeftIcon className="w-4 h-4" /> Nivel
        </button>
        <button
          onClick={() => control(running ? tournamentService.clockPause : tournamentService.clockStart)}
          disabled={busy}
          className={`flex items-center justify-center gap-1.5 py-3 rounded-xl font-black text-xs uppercase tracking-wider disabled:opacity-50 transition-all active:scale-[0.98] ${
            running
              ? 'bg-amber-600 hover:bg-amber-500 text-white'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white'
          }`}
        >
          {running ? <><PauseIcon className="w-4 h-4" /> Pausar</> : <><PlayIcon className="w-4 h-4" /> {clock?.clock_status === 'PAUSED' ? 'Reanudar' : 'Iniciar'}</>}
        </button>
        <button
          onClick={() => control(tournamentService.clockNextLevel)}
          disabled={busy || clock?.current_level >= clock?.total_levels}
          className="flex items-center justify-center gap-1.5 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 font-bold text-xs uppercase tracking-wider border border-gray-700 disabled:opacity-40 transition-all active:scale-[0.98]"
        >
          Nivel <ChevronRightIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
