import { useEffect, useState, useCallback, useRef } from 'react';
import { tournamentService } from '../api/services';
import {
  PlayIcon, PauseIcon, ChevronLeftIcon, ChevronRightIcon, PencilSquareIcon, TvIcon, CheckIcon, ClockIcon,
} from '@heroicons/react/24/solid';
import Modal from './Modal';
import BlindStructureEditor, { DEFAULT_BLINDS } from './BlindStructureEditor';

/**
 * Reloj del torneo (vista del director). El backend es la fuente de verdad del
 * tiempo (elapsed/remaining); acá sólo tickeamos localmente cada segundo a partir
 * del último estado servido y resincronizamos con un poll cada 5s. Mismo espíritu
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
  const [copiedTv, setCopiedTv] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editBlinds, setEditBlinds] = useState([]);
  const [editStack, setEditStack] = useState(0);
  const [savingBlinds, setSavingBlinds] = useState(false);
  const [editError, setEditError] = useState(null);
  const [, forceTick] = useState(0); // sólo para re-renderizar el contador local cada segundo
  const fetchedAtRef = useRef(0);
  // Instante (epoch ms) en que vence el nivel actual + timestamp del último refetch
  // de borde: al llegar a 0 dispara un refetch inmediato (debounce 2s) para ver el
  // auto-avance al toque, sin ráfaga si el reloj del cliente está sucio y
  // reintentando si el refetch del borde falló.
  const endsAtRef = useRef(null);
  const lastEdgeReloadRef = useRef(0);

  const openEdit = () => {
    const current = tournament?.blind_structure?.length ? tournament.blind_structure : DEFAULT_BLINDS;
    setEditBlinds(current.map((l) => ({ ...l })));
    setEditStack(tournament?.starting_stack || 0);
    setEditError(null);
    setEditOpen(true);
  };

  const saveBlinds = async () => {
    if (savingBlinds || !tournament?.id) return;
    if (!editBlinds.length) { setEditError('La estructura necesita al menos un nivel.'); return; }
    setSavingBlinds(true);
    setEditError(null);
    try {
      await tournamentService.updateBlinds(tournament.id, editBlinds, Number(editStack) || 0);
      await load();          // refresca el reloj con la estructura nueva
      setEditOpen(false);
    } catch (err) {
      setEditError(err.response?.data?.detail || 'No se pudo guardar la estructura.');
    } finally { setSavingBlinds(false); }
  };

  const shareTv = async () => {
    const tk = tournament?.public_token;
    if (!tk) return;
    const url = `${window.location.origin}/torneo/${tk}/tv`;
    try { await navigator.clipboard.writeText(url); } catch { /* ignora */ }
    setCopiedTv(true);
    setTimeout(() => setCopiedTv(false), 2000);
  };

  const apply = useCallback((state) => {
    setClock(state);
    fetchedAtRef.current = Date.now();
    // endsAt solo si corre y queda tiempo (>0); en el último nivel en overtime
    // queda null para no recargar en loop.
    endsAtRef.current = (state?.clock_status === 'RUNNING' && (state?.remaining_seconds || 0) > 0)
      ? Date.now() + state.remaining_seconds * 1000 : null;
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
    const poll = setInterval(load, 5000);  // 5s: el reloj auto-avanza server-side, poll ágil para reflejarlo
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(poll); document.removeEventListener('visibilitychange', onVisible); };
  }, [tournamentId, load]);

  // Tick local cada segundo: re-renderiza el contador y, al vencer el nivel,
  // dispara un refetch inmediato (una vez por endsAt) para ver el auto-avance.
  useEffect(() => {
    const id = setInterval(() => {
      forceTick((t) => t + 1);
      const ea = endsAtRef.current;
      if (ea && Date.now() >= ea && Date.now() - lastEdgeReloadRef.current > 2000) {
        lastEdgeReloadRef.current = Date.now();
        load();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [load]);

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
  // Torneo sin estructura de blinds (ej. torneos viejos con []): no mostrar el
  // reloj congelado en "Nivel 1 / 0"; invitar a configurarla con "Editar".
  const noStructure = !level || (clock?.total_levels ?? 0) === 0;

  // Tiempo restante interpolado localmente desde el último estado servido.
  const driftSec = running ? (Date.now() - fetchedAtRef.current) / 1000 : 0;
  const remaining = Math.max(0, (clock?.remaining_seconds ?? 0) - driftSec);
  const levelOver = remaining <= 0;

  const statusPill = running
    ? { txt: '● En vivo', cls: 'bg-violet-500/15 text-violet-300 ring-violet-500/30' }
    : clock?.clock_status === 'PAUSED'
      ? { txt: '⏸ Pausado', cls: 'bg-amber-500/15 text-amber-300 ring-amber-500/30' }
      : { txt: '■ Detenido', cls: 'bg-gray-600/20 text-gray-300 ring-gray-500/30' };

  return (
    <div className={`mb-6 rounded-2xl border p-5 md:p-6 transition-colors ${
      isBreak ? 'border-sky-500/40 bg-sky-950/30' : 'border-violet-500/40 bg-gradient-to-b from-violet-950/40 to-gray-900/60'
    }`}>
      {/* En 390px el título + 3 pastillas no caben en una fila: la fila
          ENVUELVE y cada pastilla es de una sola línea. Sin esto el header
          desbordaba la card y ensanchaba TODA la página (scroll horizontal,
          logo y nav cortados). */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-3">
        <span className="text-[11px] font-black uppercase tracking-[0.25em] text-violet-300 flex items-center gap-1.5 whitespace-nowrap"><ClockIcon className="w-3.5 h-3.5" /> Reloj del torneo</span>
        <div className="flex flex-wrap items-center justify-end gap-2 ml-auto">
          <button
            onClick={openEdit}
            title="Editar la estructura de blinds"
            className="text-xs font-bold uppercase px-2.5 py-1 rounded-full border border-gray-600 text-gray-300 hover:bg-gray-700/50 transition-colors flex items-center gap-1 whitespace-nowrap"
          >
            <PencilSquareIcon className="w-3 h-3" /> Editar
          </button>
          {tournament?.public_token && (
            <button
              onClick={shareTv}
              title="Copiar link de la pantalla TV (para proyectar)"
              className={`text-xs font-bold uppercase px-2.5 py-1 rounded-full border transition-colors flex items-center gap-1 whitespace-nowrap ${
                copiedTv
                  ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10'
                  : 'border-violet-500/40 text-violet-300 hover:bg-violet-500/10'
              }`}
            >
              {copiedTv ? <><CheckIcon className="w-3 h-3" /> Link TV</> : <><TvIcon className="w-3 h-3" /> Compartir TV</>}
            </button>
          )}
          <span className={`text-xs font-bold uppercase px-2.5 py-1 rounded-full ring-1 whitespace-nowrap ${statusPill.cls}`}>{statusPill.txt}</span>
          {error && <span className="text-[10px] text-amber-400/80 font-bold" title="Reconectando">⚠</span>}
        </div>
      </div>

      {noStructure ? (
        <div className="text-center py-10">
          <PencilSquareIcon className="w-12 h-12 text-violet-400/60 mx-auto mb-3" />
          <p className="font-bold text-white">Sin estructura de blinds</p>
          <p className="text-sm text-gray-400 mt-1">Toca <span className="text-violet-300 font-bold">Editar</span> para configurar los niveles del reloj.</p>
        </div>
      ) : (
      <>
      <div className="flex flex-col md:flex-row md:items-center gap-5">
        {/* Contador grande */}
        <div className="flex-1 text-center md:text-left">
          <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">
            {isBreak ? 'Descanso' : `Nivel ${clock?.current_level}`}
            <span className="text-gray-600"> / {clock?.total_levels}</span>
          </p>
          <p className={`font-mono font-black leading-none tabular-nums mt-1 text-6xl md:text-7xl ${
            levelOver ? 'text-red-400 animate-pulse' : isBreak ? 'text-sky-300' : 'text-white'
          }`}>
            {fmtClock(remaining)}
          </p>
          {levelOver && !isBreak && (
            <p className="text-red-400/90 text-xs font-bold mt-1.5">
              {clock?.current_level >= clock?.total_levels ? 'Nivel terminado' : 'Nivel terminado · subiendo…'}
            </p>
          )}
        </div>

        {/* Blinds */}
        <div className="md:w-px md:h-20 md:bg-gray-700/60 hidden md:block" />
        <div className="flex-1">
          {isBreak ? (
            <p className="text-center md:text-left text-sky-300 font-bold text-lg">Descanso</p>
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
            <p className="text-[11px] text-gray-400 mt-2">
              Sigue:{' '}
              {clock.next_level.is_break
                ? 'Descanso'
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
          <ChevronLeftIcon className="w-4 h-4" /> Anterior
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
          Siguiente <ChevronRightIcon className="w-4 h-4" />
        </button>
      </div>
      </>
      )}

      <Modal isOpen={editOpen} onClose={() => setEditOpen(false)} title="Editar estructura de blinds">
        <div className="space-y-4">
          <p className="text-[11px] text-gray-400">
            Editar mientras corre el torneo no reinicia el reloj. Si recortas la
            estructura, el nivel actual se acota al último disponible.
          </p>
          <div>
            <label className="block text-violet-300/80 text-[10px] font-bold uppercase mb-1">Stack inicial (fichas)</label>
            <input type="number" min="0" inputMode="numeric" value={editStack}
              onChange={(e) => setEditStack(e.target.value)}
              className="w-full bg-gray-900 border border-gray-600 focus:border-violet-500 rounded-lg p-2 text-white font-mono outline-none" />
          </div>
          <BlindStructureEditor
            value={editBlinds} onChange={setEditBlinds}
            startingStack={Number(editStack) || 0}
            onLoadTemplate={(tpl) => { if (tpl.starting_stack != null) setEditStack(tpl.starting_stack); }}
          />
          {editError && <p className="text-red-400 text-xs font-bold">{editError}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={saveBlinds} disabled={savingBlinds}
              className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg text-xs uppercase">
              {savingBlinds ? 'Guardando…' : 'Guardar estructura'}
            </button>
            <button onClick={() => setEditOpen(false)}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold py-2.5 rounded-lg text-xs uppercase">
              Cancelar
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
