import { useEffect, useState, useMemo } from 'react';
import api from '../api/axios';
import { TrophyIcon, StarIcon, ClockIcon, ArrowPathIcon } from '@heroicons/react/24/solid';
import PlayerProfileModal from './PlayerProfileModal';
import { waPhone } from '../utils/crm';
import { formatMoney } from '../utils/formatters';

const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

// Genera lista de los ultimos N meses (mes actual incluido)
function getRecentMonths(n = 6) {
  const result = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`,
      isCurrent: i === 0,
    });
  }
  return result;
}

const fmtDia = (iso) => {
  if (!iso) return '';
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', timeZone: 'America/Bogota' });
};

// Las tres preguntas del dueño, con la medida literal debajo del título.
// Los apodos (Tiburones / Consumo VIP / Los Fieles) se quedan como identidad
// del club; la etiqueta dice qué mide cada uno.
const RANKINGS = [
  {
    key: 'winners',
    title: 'Tiburones',
    measure: 'Utilidad neta · cash + torneos',
    Icon: TrophyIcon,
    tone: { icon: 'text-emerald-400', ring: 'border-emerald-500/30', top: 'bg-emerald-500/10 border-emerald-500/40', val: 'text-emerald-300' },
    format: (v) => `+${formatMoney(v)}`,
  },
  {
    key: 'spenders',
    title: 'Consumo VIP',
    measure: 'Consumo en barra + propinas',
    Icon: StarIcon,
    tone: { icon: 'text-violet-400', ring: 'border-violet-500/30', top: 'bg-violet-500/10 border-violet-500/40', val: 'text-violet-300' },
    format: (v) => formatMoney(v),
  },
  {
    key: 'active',
    title: 'Los Fieles',
    measure: 'Horas en mesa · torneo ponderado por puesto',
    Icon: ClockIcon,
    tone: { icon: 'text-amber-400', ring: 'border-amber-500/30', top: 'bg-amber-500/10 border-amber-500/40', val: 'text-amber-300' },
    format: (v) => `${Number(v).toFixed(1)} h`,
  },
];

const MEDAL = ['bg-yellow-500/20 text-yellow-300 border-yellow-500/50', 'bg-gray-400/15 text-gray-200 border-gray-400/50', 'bg-orange-700/20 text-orange-300 border-orange-600/50'];

// Fila = un jugador sobre el que se puede ACTUAR: tocar el nombre abre la ficha
// 360 (mismo patrón que Jugadores), WhatsApp a un toque, y se ve si ya tiene
// el panel. Targets de 44px: es la pantalla del dueño en el celular de noche.
function RankingRow({ pos, player, format, tone, onOpen }) {
  const wa = waPhone(player.phone);
  return (
    <li className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${pos === 0 ? tone.top : 'border-transparent'}`}>
      <span className={`shrink-0 w-8 h-8 rounded-full border flex items-center justify-center font-black text-sm ${MEDAL[pos] || MEDAL[2]}`}>{pos + 1}</span>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onOpen(player)}
          aria-label={`Ver ficha de ${player.name}`}
          className="block w-full text-left min-h-11 group"
        >
          <p className={`font-bold truncate group-hover:text-white transition-colors ${pos === 0 ? 'text-white text-base' : 'text-gray-200 text-sm'}`}>
            {player.name} <span className="text-gray-600 text-xs font-normal">›</span>
          </p>
          <p className="text-xs text-gray-500 truncate">
            <span className={`font-mono font-black tabular-nums ${pos === 0 ? `text-sm ${tone.val}` : 'text-gray-200'}`}>{format(player.value)}</span>
            <span className="mx-1.5 text-gray-700">·</span>
            <span className="font-mono">{player.phone || 'sin teléfono'}</span>
            {player.has_panel && <span className="ml-1.5 text-[11px] text-cyan-300/90">· panel</span>}
          </p>
        </button>
      </div>
      {wa ? (
        <a
          href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer"
          aria-label={`Escribirle a ${player.name} por WhatsApp`}
          className="shrink-0 min-h-11 min-w-11 rounded-xl border border-emerald-500/40 bg-emerald-600/15 text-emerald-300 hover:bg-emerald-600/25 flex items-center justify-center text-xs font-bold"
        >
          WA
        </a>
      ) : (
        <span className="shrink-0 min-w-11" aria-hidden="true" />
      )}
    </li>
  );
}

function RankingCard({ def, data, onOpen }) {
  const { title, measure, Icon, tone, format } = def;
  return (
    <section aria-labelledby={`rk-${def.key}`} className={`bg-gray-800/60 border ${tone.ring} rounded-2xl p-4 flex flex-col`}>
      <div className="flex items-center gap-3 mb-3">
        <Icon className={`w-6 h-6 shrink-0 ${tone.icon}`} />
        <div className="min-w-0">
          <h3 id={`rk-${def.key}`} className="font-black text-white text-base leading-tight">{title}</h3>
          <p className="text-xs text-gray-400">{measure}</p>
        </div>
      </div>
      {data.length === 0 ? (
        <p className="text-center text-gray-400 text-sm py-8">Nadie todavía en este periodo.<br /><span className="text-gray-500 text-xs">Cuenta al cerrar cada mesa o torneo.</span></p>
      ) : (
        <ul className="space-y-1">
          {data.map((p, i) => (
            <RankingRow key={p.player_id ?? `${def.key}-${i}`} pos={i} player={p} format={format} tone={tone} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  );
}

export default function PlayerLeaderboard() {
  const [rankings, setRankings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [profileOf, setProfileOf] = useState(null);

  const monthOptions = useMemo(() => getRecentMonths(12), []);
  const [selected, setSelected] = useState(monthOptions[0]); // mes actual por default

  const fetchRankings = async (period) => {
    setLoading(true);
    setError(null);
    try {
      const params = period?.isCurrent
        ? {}
        : { params: { year: period.year, month: period.month } };
      const res = await api.get('/stats/rankings', params);
      setRankings(res.data);
    } catch (err) {
      console.error("Error cargando rankings", err);
      // "No pude cargar" ≠ "nadie jugó": el error se dice y se reintenta.
      setError("No se pudieron cargar los rankings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRankings(selected); }, [selected]);

  const period = rankings?.period;
  const resetDesde = period?.reset_at ? fmtDia(period.reset_at) : null;

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            Ranking <span className="text-emerald-400 capitalize">· {selected.label}</span>
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            {resetDesde ? `Desde el ${resetDesde} (ranking reiniciado)` : 'Quién más gana, consume y juega'} · cuenta mesas y torneos cerrados
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={`${selected.year}-${selected.month}`}
            onChange={(e) => {
              const [y, m] = e.target.value.split('-').map(Number);
              const found = monthOptions.find(o => o.year === y && o.month === m);
              if (found) setSelected(found);
            }}
            aria-label="Mes del ranking"
            className="min-h-11 bg-gray-800 border border-gray-700 rounded-xl px-3 text-white text-sm font-bold focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 focus:outline-none capitalize"
          >
            {monthOptions.map(o => (
              <option key={`${o.year}-${o.month}`} value={`${o.year}-${o.month}`}>
                {o.label}{o.isCurrent ? ' (actual)' : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => fetchRankings(selected)}
            className="min-h-11 min-w-11 rounded-xl border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800 flex items-center justify-center"
            aria-label="Refrescar"
            title="Refrescar"
          >
            <ArrowPathIcon className={`w-5 h-5 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="text-center py-8 bg-red-900/10 rounded-2xl border border-red-500/20">
          <p className="text-red-300 font-bold mb-1">{error}</p>
          <p className="text-gray-400 text-sm mb-4">Esto no significa que nadie haya jugado — es un fallo de conexión.</p>
          <button type="button" onClick={() => fetchRankings(selected)} className="min-h-11 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm uppercase tracking-wider">Reintentar</button>
        </div>
      )}

      {loading && !error && (
        <div className="flex flex-col items-center justify-center py-10 space-y-3">
          <ArrowPathIcon className="w-8 h-8 text-emerald-500 animate-spin" />
          <p className="text-gray-400 text-sm">Consultando…</p>
        </div>
      )}

      {!loading && !error && rankings && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {RANKINGS.map((def) => (
            <RankingCard key={def.key} def={def} data={rankings[def.key] || []} onOpen={setProfileOf} />
          ))}
        </div>
      )}

      <p className="text-xs text-gray-500 text-center border-t border-gray-800 pt-4">
        Los rankings se actualizan al cerrar cada mesa o torneo. Es lo mismo que ve cada jugador en su panel.
      </p>

      {profileOf && (
        <PlayerProfileModal key={profileOf.player_id} player={{ id: profileOf.player_id, name: profileOf.name, phone: profileOf.phone }} onClose={() => setProfileOf(null)} />
      )}
    </div>
  );
}
