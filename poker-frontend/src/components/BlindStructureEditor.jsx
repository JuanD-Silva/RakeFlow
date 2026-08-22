import { useEffect, useState } from 'react';
import { TrashIcon, ChevronUpIcon, ChevronDownIcon, PlusIcon, BookmarkIcon, FolderOpenIcon, XMarkIcon, Bars3Icon } from '@heroicons/react/24/solid';
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors } from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { blindTemplateService } from '../api/services';

/**
 * Editor de la estructura de blinds de un torneo (T4). Controlado: recibe `value`
 * (array de niveles) y emite `onChange(nuevoArray)`. Cada nivel:
 *   { level, small_blind, big_blind, ante, duration_min, is_break }
 * El campo `level` se reindexa solo según la posición (1-based).
 */

// Plantilla default editable (espeja la del backend en tournament_clock.py; acá es
// solo el punto de partida del editor, el usuario la ajusta).
export const DEFAULT_BLINDS = [
  { small_blind: 100, big_blind: 200, ante: 0, duration_min: 20, is_break: false },
  { small_blind: 200, big_blind: 400, ante: 0, duration_min: 20, is_break: false },
  { small_blind: 300, big_blind: 600, ante: 0, duration_min: 20, is_break: false },
  { small_blind: 500, big_blind: 1000, ante: 100, duration_min: 20, is_break: false },
  { small_blind: 0, big_blind: 0, ante: 0, duration_min: 10, is_break: true },
  { small_blind: 800, big_blind: 1600, ante: 200, duration_min: 20, is_break: false },
  { small_blind: 1000, big_blind: 2000, ante: 300, duration_min: 20, is_break: false },
  { small_blind: 1500, big_blind: 3000, ante: 400, duration_min: 20, is_break: false },
  { small_blind: 2000, big_blind: 4000, ante: 500, duration_min: 20, is_break: false },
  { small_blind: 0, big_blind: 0, ante: 0, duration_min: 10, is_break: true },
  { small_blind: 3000, big_blind: 6000, ante: 1000, duration_min: 20, is_break: false },
  { small_blind: 5000, big_blind: 10000, ante: 1000, duration_min: 20, is_break: false },
].map((l, i) => ({ ...l, level: i + 1 }));

// `_uid`: id estable de cliente por nivel, para keys de React y drag&drop. Sin él,
// usar el índice como key hace que al reordenar/borrar se "mezclen" los valores de
// los inputs. El backend lo descarta solo (Pydantic BlindLevel ignora campos extra).
let _uidCounter = 0;
const newUid = () => `lvl_${++_uidCounter}`;
const withUids = (levels) => levels.map((l) => (l._uid ? l : { ...l, _uid: newUid() }));
const uidOf = (l, i) => l._uid || `init-${i}`;  // fallback estable hasta que se asigna el _uid real

const reindex = (levels) => levels.map((l, i) => ({ ...l, level: i + 1 }));

const nextLevelFrom = (prev) => {
  const lastBB = prev?.big_blind || 0;
  const bb = lastBB ? lastBB * 2 : 200;
  return { small_blind: Math.round(bb / 2), big_blind: bb, ante: prev?.ante || 0, duration_min: prev?.duration_min || 20, is_break: false };
};

function NumInput({ value, onChange, className = '' }) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min="0"
      value={value}
      onChange={(e) => onChange(e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value, 10) || 0))}
      className={`w-full bg-gray-900 border border-gray-600 focus:border-violet-500 rounded p-1.5 text-white text-sm font-mono text-center outline-none ${className}`}
    />
  );
}

// Fila de un nivel: arrastrable (handle ≡), con flechas ↑↓, trash y resaltado al
// seleccionar/editar. `id` es el _uid estable; index es la posición 1-based visible.
function SortableLevel({ id, level: l, index, total, selected, onSelect, onUpdate, onRemove, onMove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const base = l.is_break ? 'bg-sky-950/30 border-sky-500/30' : 'bg-gray-900/40 border-gray-700/60';
  return (
    <div
      ref={setNodeRef} style={style}
      onClick={() => onSelect(id)} onFocusCapture={() => onSelect(id)}
      className={`rounded-lg border p-2 transition-shadow ${isDragging ? 'opacity-70 shadow-xl shadow-black/40 relative z-10' : ''} ${
        selected ? 'ring-2 ring-violet-500 border-violet-500/60 bg-violet-950/20' : base
      }`}
    >
      <div className="flex items-center gap-1.5">
        {/* Handle de arrastre */}
        <button
          type="button" {...attributes} {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 cursor-grab active:cursor-grabbing touch-none p-1 text-gray-600 hover:text-violet-300 focus:text-violet-300 outline-none"
          title="Arrastrar para reordenar" aria-label={`Reordenar nivel ${index + 1}`}
        >
          <Bars3Icon className="w-4 h-4" />
        </button>
        <span className={`shrink-0 w-6 text-center text-xs font-black ${l.is_break ? 'text-sky-300' : 'text-violet-300'}`}>
          {l.is_break ? '☕' : index + 1}
        </span>
        {l.is_break ? (
          <div className="flex-1 flex items-center gap-2">
            <span className="text-sky-300 text-xs font-bold uppercase flex-1">Break</span>
            <span className="text-[10px] text-gray-500">min</span>
            <div className="w-16"><NumInput value={l.duration_min} onChange={(v) => onUpdate(index, { duration_min: v })} /></div>
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-4 gap-1.5">
            <NumInput value={l.small_blind} onChange={(v) => onUpdate(index, { small_blind: v })} />
            <NumInput value={l.big_blind} onChange={(v) => onUpdate(index, { big_blind: v })} />
            <NumInput value={l.ante} onChange={(v) => onUpdate(index, { ante: v })} className="text-violet-300/90" />
            <NumInput value={l.duration_min} onChange={(v) => onUpdate(index, { duration_min: v })} className="text-gray-400" />
          </div>
        )}
        <div className="flex shrink-0">
          <button type="button" onClick={(e) => { e.stopPropagation(); onMove(index, -1); }} disabled={index === 0} className="p-1 text-gray-500 hover:text-white disabled:opacity-30"><ChevronUpIcon className="w-4 h-4" /></button>
          <button type="button" onClick={(e) => { e.stopPropagation(); onMove(index, 1); }} disabled={index === total - 1} className="p-1 text-gray-500 hover:text-white disabled:opacity-30"><ChevronDownIcon className="w-4 h-4" /></button>
          <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(index); }} className="p-1 text-gray-500 hover:text-red-400"><TrashIcon className="w-4 h-4" /></button>
        </div>
      </div>
    </div>
  );
}

/**
 * Barra de biblioteca de plantillas (PR3): cargar (presets fijos + las del club)
 * y guardar la estructura actual como plantilla propia. Maneja su propio fetch.
 */
function TemplateBar({ levels, startingStack, onLoad }) {
  const [data, setData] = useState({ presets: [], saved: [] });
  const [openLoad, setOpenLoad] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [loadErr, setLoadErr] = useState(false);

  const fetchTemplates = async () => {
    try {
      const res = await blindTemplateService.list();
      setData({ presets: res.presets || [], saved: res.saved || [] });
      setLoadErr(false);
    } catch {
      // El editor sigue funcionando sin plantillas; marcamos el fallo para
      // distinguir "no hay guardadas" de "no se pudo cargar".
      setLoadErr(true);
    }
  };

  useEffect(() => { fetchTemplates(); }, []);

  // Re-sincronizar al abrir el panel de carga (puede haber plantillas nuevas
  // creadas en otra pestaña/sesión desde que se montó el editor).
  const toggleLoad = () => {
    setOpenLoad((v) => {
      if (!v) fetchTemplates();
      return !v;
    });
    setNaming(false);
  };

  const apply = (tpl) => {
    onLoad(tpl);
    setOpenLoad(false);
  };

  const save = async () => {
    const clean = name.trim();
    if (!clean) { setErr('Poné un nombre.'); return; }
    if (!levels.length) { setErr('No hay niveles para guardar.'); return; }
    setBusy(true); setErr('');
    try {
      await blindTemplateService.save({ name: clean, blind_structure: levels, starting_stack: startingStack || 0 });
      setName(''); setNaming(false);
      await fetchTemplates();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id, e) => {
    e.stopPropagation();
    setBusy(true); setErr('');
    try {
      await blindTemplateService.remove(id);
      await fetchTemplates();
    } catch (e2) {
      setErr(e2?.response?.data?.detail || 'No se pudo borrar la plantilla.');
    } finally {
      setBusy(false);
    }
  };

  // Fila clickeable como <div role="button"> para poder anidar el botón de
  // borrar sin meter un control interactivo dentro de un <button> (HTML inválido).
  const Item = ({ tpl, deletable }) => (
    <div role="button" tabIndex={0} onClick={() => apply(tpl)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apply(tpl); } }}
      className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer hover:bg-violet-500/10 outline-none focus:bg-violet-500/10">
      <span className="flex-1 text-sm text-white truncate">{tpl.name}</span>
      <span className="text-[10px] text-gray-500 shrink-0">{(tpl.blind_structure || []).length} niv.</span>
      {deletable && (
        <button type="button" onClick={(e) => remove(tpl.id, e)} disabled={busy}
          className="shrink-0 p-1 -mr-1 text-gray-600 hover:text-red-400 disabled:opacity-40" title="Borrar plantilla">
          <XMarkIcon className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );

  return (
    <div className="relative flex flex-wrap items-center gap-2">
      {/* Cargar plantilla */}
      <button type="button" onClick={toggleLoad}
        className="text-[10px] font-bold uppercase px-2.5 py-1.5 rounded-lg border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 flex items-center gap-1">
        <FolderOpenIcon className="w-3.5 h-3.5" /> Cargar plantilla
      </button>
      {/* Guardar como plantilla */}
      <button type="button" onClick={() => { setNaming((v) => !v); setOpenLoad(false); setErr(''); }}
        className="text-[10px] font-bold uppercase px-2.5 py-1.5 rounded-lg border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 flex items-center gap-1">
        <BookmarkIcon className="w-3.5 h-3.5" /> Guardar como plantilla
      </button>

      {/* Panel de carga (presets + guardadas) */}
      {openLoad && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpenLoad(false)} />
          <div className="absolute z-20 top-full left-0 mt-1 w-64 max-h-[50vh] overflow-y-auto rounded-xl border border-gray-700 bg-gray-900 shadow-2xl divide-y divide-gray-800">
            <p className="px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-emerald-400/70 bg-gray-950/50">Presets</p>
            {data.presets.map((tpl) => <Item key={tpl.id} tpl={tpl} deletable={false} />)}
            <p className="px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-violet-400/70 bg-gray-950/50">Mis plantillas</p>
            {loadErr
              ? <p className="px-3 py-2 text-xs text-red-400/80 italic">No se pudieron cargar las plantillas.</p>
              : data.saved.length === 0
                ? <p className="px-3 py-2 text-xs text-gray-600 italic">Ninguna guardada aún.</p>
                : data.saved.map((tpl) => <Item key={tpl.id} tpl={tpl} deletable />)}
            {err && <p className="px-3 py-2 text-[11px] text-red-400">{err}</p>}
          </div>
        </>
      )}

      {/* Fila inline para nombrar y guardar */}
      {naming && (
        <div className="w-full flex flex-col gap-1.5 mt-1">
          <div className="flex items-center gap-2">
            <input
              autoFocus type="text" value={name} maxLength={60}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
              placeholder="Nombre de la plantilla"
              className="flex-1 bg-gray-900 border border-gray-600 focus:border-amber-500 rounded-lg p-2 text-white text-sm outline-none"
            />
            <button type="button" onClick={save} disabled={busy}
              className="text-[10px] font-bold uppercase px-3 py-2 rounded-lg bg-amber-500 text-gray-900 hover:bg-amber-400 disabled:opacity-50">
              {busy ? '...' : 'Guardar'}
            </button>
            <button type="button" onClick={() => { setNaming(false); setErr(''); }}
              className="text-[10px] font-bold uppercase px-2 py-2 rounded-lg text-gray-400 hover:text-white">
              Cancelar
            </button>
          </div>
          {err && <p className="text-[11px] text-red-400">{err}</p>}
        </div>
      )}
    </div>
  );
}

export default function BlindStructureEditor({ value, onChange, startingStack, onLoadTemplate }) {
  const levels = value || [];
  const [selectedUid, setSelectedUid] = useState(null);
  const set = (next) => onChange(reindex(withUids(next)));
  const update = (i, patch) => set(levels.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const remove = (i) => set(levels.filter((_, idx) => idx !== i));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= levels.length) return;
    const next = [...levels];
    [next[i], next[j]] = [next[j], next[i]];
    set(next);
  };

  // Asignar _uid a los niveles que llegan sin él (estructura default, de la DB o
  // de una plantilla) una sola vez al montar, ANTES de editar, para que el primer
  // tecleo no remonte la fila (no perder el foco). Las mutaciones posteriores ya
  // pasan por `set`, que mantiene los _uid.
  useEffect(() => {
    if (levels.length && levels.some((l) => !l._uid)) onChange(reindex(withUids(levels)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sensores: puntero (con umbral de 6px para no confundir tap con drag) y teclado.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const from = levels.findIndex((l, i) => uidOf(l, i) === active.id);
    const to = levels.findIndex((l, i) => uidOf(l, i) === over.id);
    if (from < 0 || to < 0) return;
    const next = [...levels];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    set(next);
  };

  const playLevels = levels.filter((l) => !l.is_break).length;

  // Cargar una plantilla (preset o guardada): reemplaza la estructura y, si el
  // padre lo soporta, también aplica el starting_stack sugerido.
  const loadTemplate = (tpl) => {
    set(tpl.blind_structure || []);
    onLoadTemplate?.(tpl);
  };

  return (
    <div className="space-y-2">
      <TemplateBar levels={levels} startingStack={startingStack} onLoad={loadTemplate} />

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-gray-500 font-bold uppercase tracking-wider">
          {levels.length} niveles · {playLevels} de juego
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => set([...levels, nextLevelFrom(levels[levels.length - 1])])}
            className="text-[10px] font-bold uppercase px-2.5 py-1.5 rounded-lg border border-violet-500/40 text-violet-300 hover:bg-violet-500/10 flex items-center gap-1">
            <PlusIcon className="w-3.5 h-3.5" /> Nivel
          </button>
          <button type="button" onClick={() => set([...levels, { small_blind: 0, big_blind: 0, ante: 0, duration_min: 10, is_break: true }])}
            className="text-[10px] font-bold uppercase px-2.5 py-1.5 rounded-lg border border-sky-500/40 text-sky-300 hover:bg-sky-500/10 flex items-center gap-1">
            <PlusIcon className="w-3.5 h-3.5" /> Break
          </button>
        </div>
      </div>

      {levels.length > 0 && (
        <p className="text-[10px] text-gray-600 px-0.5">Arrastra <Bars3Icon className="w-3 h-3 inline -mt-0.5" /> para reordenar · toca un nivel para resaltarlo.</p>
      )}

      {levels.length === 0 && (
        <p className="text-gray-600 text-xs text-center py-4 italic">Sin niveles. Agregá uno o un break.</p>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} modifiers={[restrictToVerticalAxis]}>
        <SortableContext items={levels.map(uidOf)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1.5 max-h-[40vh] overflow-y-auto pr-1">
            {levels.map((l, i) => {
              const id = uidOf(l, i);
              return (
                <SortableLevel
                  key={id} id={id} level={l} index={i} total={levels.length}
                  selected={selectedUid === id} onSelect={setSelectedUid}
                  onUpdate={update} onRemove={remove} onMove={move}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      {/* Leyenda de columnas (no-break) */}
      {levels.some((l) => !l.is_break) && (
        <div className="flex items-center gap-1.5 px-2 text-[9px] text-gray-600 font-bold uppercase tracking-wider">
          <span className="w-[52px]" />
          <div className="flex-1 grid grid-cols-4 gap-1.5 text-center">
            <span>SB</span><span>BB</span><span className="text-violet-500/70">Ante</span><span>Min</span>
          </div>
          <span className="w-[84px]" />
        </div>
      )}
    </div>
  );
}
