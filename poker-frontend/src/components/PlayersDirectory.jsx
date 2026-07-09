import { useEffect, useMemo, useState } from 'react';
import { MagnifyingGlassIcon } from '@heroicons/react/24/solid';
import { playerService } from '../api/services';
import { useAuth } from '../context/AuthContext';
import PlayerAppAccount from './PlayerAppAccount';
import PlayerProfileModal from './PlayerProfileModal';
import { mcop, segmentOf, waPhone } from '../utils/crm';

// ---------------------------------------------------------
// Directorio de jugadores = CRM del club. Además de invitar a la app (sin
// depender de una mesa abierta), el staff OWNER/MANAGER ve POR JUGADOR:
// hace cuánto no viene (recencia con semáforo), visitas, rake estimado que
// aporta y si deja o retira plata — con filtros y orden para detectar a
// quién reactivar (el que se enfría) y a quién cuidar (el que sostiene).
// El cajero ve el directorio simple (el backend gatea /players/insights
// a OWNER/MANAGER: es información financiera de clientes).
// ---------------------------------------------------------

const PAGE = 40;

// Búsqueda insensible a tildes: "sebastian" encuentra "Sebastián"
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const ACCOUNT_FILTERS = [
  { key: 'all', label: 'Todos' },
  { key: 'none', label: '📵 Sin cuenta' },
  { key: 'pending', label: '⏳ Pendiente' },
  { key: 'active', label: '✓ Con app' },
];

// Filtros de recencia/contacto — solo aparecen cuando hay insights (OWNER/MANAGER)
const CRM_FILTERS = [
  { key: 'hot', label: '🔥 ≤14d' },
  { key: 'warm', label: '🌗 15–30d' },
  { key: 'asleep', label: '😴 +30d' },
  { key: 'nophone', label: '📞 Sin teléfono' },
];

const SORTS = [
  { key: 'name', label: 'Nombre' },
  { key: 'recent', label: 'Última visita' },
  { key: 'rake', label: 'Rake aportado' },
  { key: 'visits', label: 'Visitas' },
];

const matchFilter = (p, f, ins) => {
  if (f === 'none') return !p.has_account;
  if (f === 'pending') return p.has_account && p.invitation_pending;
  if (f === 'active') return p.has_account && !p.invitation_pending;
  if (f === 'nophone') return !p.phone;
  if (f === 'hot' || f === 'warm' || f === 'asleep') {
    const d = ins?.days_inactive;
    if (d == null) return false;
    if (f === 'hot') return d <= 14;
    if (f === 'warm') return d >= 15 && d <= 30;
    return d > 30;
  }
  return true;
};

export default function PlayersDirectory() {
  const { isOwner, isManager } = useAuth();
  const canManageApp = isOwner || isManager;
  const [players, setPlayers] = useState(null); // null = cargando
  const [insights, setInsights] = useState(null); // null = sin capa CRM (cajero o cargando)
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('name');
  const [shown, setShown] = useState(PAGE);
  const [profileOf, setProfileOf] = useState(null); // jugador con la ficha 360 abierta

  const [reloadKey, setReloadKey] = useState(0);
  const load = () => setReloadKey((k) => k + 1); // para onChanged/reintentar

  useEffect(() => {
    let cancelled = false;
    playerService.getAll()
      .then((all) => { if (!cancelled) { setPlayers(all); setError(false); } })
      .catch(() => { if (!cancelled) setError(true); });
    // La capa CRM es best-effort: si falla, el directorio sigue funcionando.
    if (canManageApp) {
      playerService.insights()
        .then((d) => { if (!cancelled) setInsights(d); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [reloadKey, canManageApp]);

  // Cambió la búsqueda, el filtro o el orden → la paginación vuelve al inicio
  // (ajuste de estado durante render, patrón de la doc de React)
  const [prevKey, setPrevKey] = useState('');
  const listKey = `${filter}|${query}|${sort}`;
  if (listKey !== prevKey) {
    setPrevKey(listKey);
    setShown(PAGE);
  }

  const filtered = useMemo(() => {
    if (!players) return [];
    const q = norm(query.trim());
    const ins = (p) => insights?.players?.[p.id];
    const list = players
      .filter((p) => matchFilter(p, filter, ins(p)))
      .filter((p) => !q || norm(p.name).includes(q) || (p.phone || '').includes(q));
    // Sin insights solo hay orden alfabético; con insights, los sin-datos van al final.
    const by = {
      name: (a, b) => a.name.localeCompare(b.name, 'es'),
      recent: (a, b) => (ins(a)?.days_inactive ?? Infinity) - (ins(b)?.days_inactive ?? Infinity),
      rake: (a, b) => (ins(b)?.rake_est ?? -1) - (ins(a)?.rake_est ?? -1),
      visits: (a, b) => (ins(b)?.visits ?? -1) - (ins(a)?.visits ?? -1),
    };
    return list.sort(by[insights ? sort : 'name'] || by.name);
  }, [players, insights, query, filter, sort]);

  const stats = useMemo(() => {
    if (!players) return null;
    const base = {
      total: players.length,
      active: players.filter((p) => p.has_account && !p.invitation_pending).length,
      pending: players.filter((p) => p.has_account && p.invitation_pending).length,
      vip: players.filter((p) => p.is_vip).length,
      asleep: 0,
      nophone: 0,
    };
    if (insights?.players) {
      base.asleep = players.filter((p) => (insights.players[p.id]?.days_inactive ?? null) > 30).length;
      base.nophone = players.filter((p) => !p.phone).length;
    }
    return base;
  }, [players, insights]);

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
            {stats.vip > 0 && <> · <span className="text-cyan-300 font-bold">💎 {stats.vip} VIP</span></>}
            {stats.asleep > 0 && <> · <span className="text-red-300/90 font-bold">😴 {stats.asleep} dormidos +30d</span></>}
            {stats.nophone > 0 && <> · <span className="text-gray-400 font-bold">📞 {stats.nophone} sin teléfono</span></>}
          </p>
        </div>
        {insights && (
          <select value={sort} onChange={(e) => setSort(e.target.value)}
            aria-label="Ordenar jugadores"
            className="bg-gray-800 text-gray-300 border border-gray-700 rounded-xl py-2 px-2.5 text-xs font-bold focus:border-emerald-500 outline-none">
            {SORTS.map((s) => <option key={s.key} value={s.key}>↕ {s.label}</option>)}
          </select>
        )}
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
          {[...ACCOUNT_FILTERS, ...(insights ? CRM_FILTERS : [])].map((f) => (
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
        {filtered.slice(0, shown).map((p) => {
          // Con insights cargados, el jugador sin actividad también muestra su
          // chip ("sin visitas") — {} truthy dispara la línea CRM con solo el chip.
          const ins = insights ? (insights.players?.[p.id] || {}) : null;
          const seg = ins ? segmentOf(ins.days_inactive) : null;
          const wa = waPhone(p.phone);
          return (
            <div key={p.id} className="bg-gray-800/60 border border-gray-700/60 rounded-xl px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {canManageApp ? (
                    <button onClick={() => setProfileOf(p)} className="block w-full text-left group"
                      aria-label={`Ver ficha de ${p.name}`}>
                      <p className="text-white font-bold truncate group-hover:text-emerald-300 transition-colors">{p.name} <span className="text-gray-600 text-xs font-normal">›</span></p>
                    </button>
                  ) : (
                    <p className="text-white font-bold truncate">{p.name}</p>
                  )}
                  <p className="text-xs text-gray-500 font-mono">
                    {p.phone || 'sin teléfono'}
                    {wa && (
                      <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer"
                        aria-label={`Escribirle a ${p.name} por WhatsApp`}
                        className="ml-2 text-emerald-400/90 hover:text-emerald-300 font-sans font-bold no-underline">💬 WhatsApp</a>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {p.is_vip && (
                    <span className="text-[9px] font-bold uppercase px-2 py-1 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/25" title="Pilar del club — de los que más mueven (top por volumen). Atenderlo bien.">💎 VIP</span>
                  )}
                  {!p.history_unlocked && p.has_account && (
                    <span className="text-[9px] font-bold uppercase px-2 py-1 rounded bg-violet-500/10 text-violet-300" title="Histórico en el archivo — se desbloquea cobrando en caja">🗄️ Archivo</span>
                  )}
                </div>
              </div>

              {/* Capa CRM (solo OWNER/MANAGER): recencia + valor del jugador */}
              {ins && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2 text-[11px]">
                  {seg ? (
                    <span className={`font-bold px-2 py-0.5 rounded-full border ${seg.cls}`}>
                      {seg.emoji} hace {ins.days_inactive}d
                    </span>
                  ) : (
                    <span className="font-bold px-2 py-0.5 rounded-full border bg-gray-700/40 text-gray-500 border-gray-600/40">sin visitas</span>
                  )}
                  {ins.visits > 0 && (
                    <span className="text-gray-400"><b className="text-gray-200">{ins.visits}</b> visita{ins.visits !== 1 ? 's' : ''}</span>
                  )}
                  {ins.rake_est > 0 && (
                    <span className="text-gray-400" title={`Estimado: volumen movido × yield del club (${insights.yield_pct}%). El rake real se declara por mesa, no por jugador.`}>
                      rake <b className="text-emerald-300">{mcop(ins.rake_est)}</b>
                    </span>
                  )}
                  {ins.net != null && ins.net !== 0 && (
                    <span className="text-gray-400" title="Resultado del jugador en cash (mesas cerradas): si deja, esa plata quedó en el club.">
                      {ins.net < 0
                        ? <>deja <b className="text-emerald-300">{mcop(ins.net)}</b></>
                        : <>retira <b className="text-amber-300">{mcop(ins.net)}</b></>}
                    </span>
                  )}
                </div>
              )}

              <div className="mt-2">
                <PlayerAppAccount playerId={p.id} account={p} canManage={canManageApp} onChanged={load} />
              </div>
            </div>
          );
        })}
      </div>

      {profileOf && <PlayerProfileModal key={profileOf.id} player={profileOf} onClose={() => setProfileOf(null)} />}

      {filtered.length > shown && (
        <button onClick={() => setShown((n) => n + PAGE)}
          className="w-full py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-bold uppercase tracking-wide">
          Mostrar más ({filtered.length - shown} restantes)
        </button>
      )}
    </div>
  );
}
