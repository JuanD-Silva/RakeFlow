import { useEffect, useState, useMemo } from 'react';
import api from '../api/axios';
import { TrophyIcon, StarIcon, ClockIcon, ArrowPathIcon, ShareIcon } from '@heroicons/react/24/solid';
import PlayerProfileModal from './PlayerProfileModal';
import RankingShareCard from './RankingShareCard';
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
    emoji: '🦈',
    measure: 'Utilidad neta · cash + torneos',
    Icon: TrophyIcon,
    tone: { icon: 'text-emerald-400', ring: 'border-emerald-500/30', top: 'bg-emerald-500/10 border-emerald-500/40', val: 'text-emerald-300', btn: 'bg-emerald-600 hover:bg-emerald-500' },
    grad: 'linear-gradient(160deg, #052e22 0%, #0a0f1a 55%, #0b1220 100%)',
    format: (v) => `+${formatMoney(v)}`,
  },
  {
    key: 'spenders',
    title: 'Consumo VIP',
    emoji: '⭐',
    measure: 'Consumo en barra + propinas',
    Icon: StarIcon,
    tone: { icon: 'text-violet-400', ring: 'border-violet-500/30', top: 'bg-violet-500/10 border-violet-500/40', val: 'text-violet-300', btn: 'bg-violet-600 hover:bg-violet-500' },
    grad: 'linear-gradient(160deg, #170a32 0%, #0a0f1a 55%, #0b1220 100%)',
    format: (v) => formatMoney(v),
  },
  {
    key: 'active',
    title: 'Los Fieles',
    emoji: '🔥',
    measure: 'Horas en mesa · torneo ponderado por puesto',
    Icon: ClockIcon,
    tone: { icon: 'text-amber-400', ring: 'border-amber-500/30', top: 'bg-amber-500/10 border-amber-500/40', val: 'text-amber-300', btn: 'bg-amber-600 hover:bg-amber-500' },
    grad: 'linear-gradient(160deg, #2a1a05 0%, #0a0f1a 55%, #0b1220 100%)',
    format: (v) => `${Number(v).toFixed(1)} h`,
  },
];

// Flecha vs el mes anterior: ▲ subió N, ▼ bajó N, = igual, ✦ nuevo en el ranking.
function Delta({ pos, prevPos }) {
  if (prevPos == null) return <span className="text-[10px] font-bold text-cyan-300" title="No estaba el mes pasado">✦ nuevo</span>;
  const d = prevPos - (pos + 1);
  if (d > 0) return <span className="text-[10px] font-bold text-emerald-400" title={`Subió ${d} ${d === 1 ? 'puesto' : 'puestos'} vs el mes pasado`}>▲ {d}</span>;
  if (d < 0) return <span className="text-[10px] font-bold text-red-400" title={`Bajó ${-d} ${-d === 1 ? 'puesto' : 'puestos'} vs el mes pasado`}>▼ {-d}</span>;
  return <span className="text-[10px] font-bold text-gray-500" title="Mismo puesto que el mes pasado">= igual</span>;
}

// Un puesto del podio. Tocarlo abre la ficha 360 del jugador (teléfono y
// WhatsApp viven ahí, como en Jugadores).
function Step({ pos, player, format, onOpen, styles }) {
  if (!player) return null;
  return (
    <button
      type="button"
      onClick={() => onOpen(player)}
      aria-label={`${pos + 1}° ${player.name}: ver ficha`}
      className={`flex flex-col items-center flex-1 min-w-0 group ${styles.wrap}`}
    >
      {pos === 0 && <TrophyIcon className="w-8 h-8 text-yellow-500 mb-1" />}
      <div className={`${styles.circle} rounded-full border-2 flex items-center justify-center mb-2 shadow-lg`}>
        <span className={`font-black ${styles.num}`}>{pos + 1}</span>
      </div>
      <p className={`${styles.name} w-full text-center truncate group-hover:text-white transition-colors`} title={player.name}>{player.name}</p>
      <Delta pos={pos} prevPos={player.prev_pos} />
      <div className={`${styles.bar} w-full mt-2 flex items-center justify-center`}>
        <span className={`font-mono font-bold ${styles.val}`}>{format(player.value)}</span>
      </div>
    </button>
  );
}

const STEP = [
  { wrap: 'scale-110 -translate-y-2', circle: 'w-14 h-14 bg-yellow-500/20 border-yellow-500 shadow-yellow-500/20 shadow-xl', num: 'text-yellow-500 text-xl', name: 'text-sm font-black text-white', bar: 'h-20 bg-yellow-600/20 rounded-t-xl border-x border-t border-yellow-500/30', val: 'text-xs text-yellow-400' },
  { wrap: '', circle: 'w-12 h-12 bg-gray-400/20 border-gray-400', num: 'text-gray-300', name: 'text-xs font-bold text-gray-300', bar: 'h-12 bg-gray-700/50 rounded-t-lg', val: 'text-[11px] text-gray-300' },
  { wrap: '', circle: 'w-10 h-10 bg-orange-700/20 border-orange-700', num: 'text-orange-500 text-sm', name: 'text-xs font-bold text-gray-400', bar: 'h-8 bg-gray-700/50 rounded-t-lg', val: 'text-[11px] text-gray-400' },
];

function RankingCard({ def, data, onOpen, onShare }) {
  const { title, measure, Icon, tone, format } = def;
  return (
    <section aria-labelledby={`rk-${def.key}`} className={`bg-gray-800/40 border ${tone.ring} rounded-3xl overflow-hidden flex flex-col shadow-2xl`}>
      <div className={`p-5 border-b border-gray-700/30 flex items-start justify-between gap-3`}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-gray-900/50 rounded-xl shadow-inner shrink-0"><Icon className={`w-6 h-6 ${tone.icon}`} /></div>
          <div className="min-w-0">
            <h3 id={`rk-${def.key}`} className="font-black text-white uppercase tracking-tighter text-lg leading-tight">{title}</h3>
            <p className="text-xs text-gray-400">{measure}</p>
          </div>
        </div>
        {data.length > 0 && (
          <button
            type="button"
            onClick={() => onShare(def, data)}
            aria-label={`Compartir ${title} por WhatsApp`}
            title="Compartir por WhatsApp"
            className="shrink-0 min-h-11 min-w-11 rounded-xl border border-emerald-500/40 bg-emerald-600/15 text-emerald-300 hover:bg-emerald-600/25 flex items-center justify-center"
          >
            <ShareIcon className="w-5 h-5" />
          </button>
        )}
      </div>
      <div className="p-4 flex-1">
        {data.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-10">Nadie todavía en este periodo.<br /><span className="text-gray-500 text-xs">Cuenta al cerrar cada mesa o torneo.</span></p>
        ) : (
          <div className="flex items-end justify-center gap-2 pt-4 pb-2 px-1">
            <Step pos={1} player={data[1]} format={format} onOpen={onOpen} styles={STEP[1]} />
            <Step pos={0} player={data[0]} format={format} onOpen={onOpen} styles={STEP[0]} />
            <Step pos={2} player={data[2]} format={format} onOpen={onOpen} styles={STEP[2]} />
          </div>
        )}
      </div>
    </section>
  );
}

export default function PlayerLeaderboard({ clubName = '' } = {}) {
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

  // Compartir = el MISMO podio como imagen (tarjeta-podio), no un texto.
  const [shareOf, setShareOf] = useState(null); // { def, data }
  const shareRanking = (def, data) => setShareOf({ def, data });

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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {RANKINGS.map((def) => (
            <RankingCard key={def.key} def={def} data={rankings[def.key] || []} onOpen={setProfileOf} onShare={shareRanking} />
          ))}
        </div>
      )}

      <p className="text-xs text-gray-500 text-center border-t border-gray-800 pt-4">
        Los rankings se actualizan al cerrar cada mesa o torneo. Es lo mismo que ve cada jugador en su panel.
      </p>

      {shareOf && (
        <RankingShareCard def={shareOf.def} data={shareOf.data} clubName={clubName} periodLabel={selected.label} onClose={() => setShareOf(null)} />
      )}

      {profileOf && (
        <PlayerProfileModal key={profileOf.player_id} player={{ id: profileOf.player_id, name: profileOf.name, phone: profileOf.phone }} onClose={() => setProfileOf(null)} />
      )}
    </div>
  );
}
