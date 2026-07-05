import { useEffect, useMemo, useState } from 'react';
import { MagnifyingGlassIcon } from '@heroicons/react/24/solid';
import { playerService } from '../api/services';
import { useAuth } from '../context/AuthContext';
import PlayerAppAccount from './PlayerAppAccount';

// ---------------------------------------------------------
// Directorio de jugadores: TODAS las fichas del club, con buscador y las
// acciones de la app (invitar / re-invitar / resetear / desbloquear) SIN
// depender de una mesa abierta. La mesa activa sigue teniendo el mismo
// bloque para el jugador sentado; esto sirve para invitar en frío
// (campañas, el jugador que pregunta por WhatsApp, etc.).
// ---------------------------------------------------------

const PAGE = 40;

// Búsqueda insensible a tildes: "sebastian" encuentra "Sebastián"
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const FILTERS = [
  { key: 'all', label: 'Todos' },
  { key: 'none', label: '📵 Sin cuenta' },
  { key: 'pending', label: '⏳ Pendiente' },
  { key: 'active', label: '✓ Con app' },
];

const matchFilter = (p, f) => {
  if (f === 'none') return !p.has_account;
  if (f === 'pending') return p.has_account && p.invitation_pending;
  if (f === 'active') return p.has_account && !p.invitation_pending;
  return true;
};

export default function PlayersDirectory() {
  const { isOwner, isManager } = useAuth();
  const canManageApp = isOwner || isManager;
  const [players, setPlayers] = useState(null); // null = cargando
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [shown, setShown] = useState(PAGE);

  const [reloadKey, setReloadKey] = useState(0);
  const load = () => setReloadKey((k) => k + 1); // para onChanged/reintentar

  useEffect(() => {
    let cancelled = false;
    playerService.getAll()
      .then((all) => { if (!cancelled) { setPlayers(all); setError(false); } })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  // Cambió la búsqueda o el filtro → la paginación vuelve al inicio
  // (ajuste de estado durante render, patrón de la doc de React)
  const [prevKey, setPrevKey] = useState('');
  const listKey = `${filter}|${query}`;
  if (listKey !== prevKey) {
    setPrevKey(listKey);
    setShown(PAGE);
  }

  const filtered = useMemo(() => {
    if (!players) return [];
    const q = norm(query.trim());
    return players
      .filter((p) => matchFilter(p, filter))
      .filter((p) => !q || norm(p.name).includes(q) || (p.phone || '').includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [players, query, filter]);

  const stats = useMemo(() => {
    if (!players) return null;
    return {
      total: players.length,
      active: players.filter((p) => p.has_account && !p.invitation_pending).length,
      pending: players.filter((p) => p.has_account && p.invitation_pending).length,
    };
  }, [players]);

  if (error && !players) return (
    <div className="text-center py-16 text-gray-400">
      No se pudieron cargar los jugadores.
      <button onClick={load} className="block mx-auto mt-3 text-sm text-emerald-400 font-bold hover:underline">Reintentar</button>
    </div>
  );
  if (!players) return (
    <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" /></div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-white">Jugadores</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {stats.total} fichas · <span className="text-emerald-400 font-bold">{stats.active} con app</span>
            {stats.pending > 0 && <> · <span className="text-amber-400 font-bold">{stats.pending} pendiente{stats.pending !== 1 ? 's' : ''}</span></>}
          </p>
        </div>
      </div>

      {/* Buscador + filtros */}
      <div className="flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre o teléfono…"
            className="w-full bg-gray-800 text-white border border-gray-600 rounded-xl py-2.5 pl-9 pr-3 text-sm focus:border-emerald-500 outline-none"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`shrink-0 text-[11px] font-bold uppercase px-3 py-2 rounded-xl border transition-all ${
                filter === f.key ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 && (
        <p className="text-center text-sm text-gray-500 py-10">
          {players.length === 0 ? 'Aún no hay jugadores — las fichas se crean desde la mesa activa.' : 'Ningún jugador coincide con la búsqueda.'}
        </p>
      )}

      <div className="space-y-2">
        {filtered.slice(0, shown).map((p) => (
          <div key={p.id} className="bg-gray-800/60 border border-gray-700/60 rounded-xl px-4 py-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="min-w-0">
                <p className="text-white font-bold truncate">{p.name}</p>
                <p className="text-xs text-gray-500 font-mono">{p.phone || 'sin teléfono'}</p>
              </div>
              {!p.history_unlocked && p.has_account && (
                <span className="shrink-0 text-[9px] font-bold uppercase px-2 py-1 rounded bg-violet-500/10 text-violet-300" title="Histórico en el archivo — se desbloquea cobrando en caja">🗄️ Archivo</span>
              )}
            </div>
            <PlayerAppAccount playerId={p.id} account={p} canManage={canManageApp} onChanged={load} />
          </div>
        ))}
      </div>

      {filtered.length > shown && (
        <button onClick={() => setShown((n) => n + PAGE)}
          className="w-full py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-bold uppercase tracking-wide">
          Mostrar más ({filtered.length - shown} restantes)
        </button>
      )}
    </div>
  );
}
