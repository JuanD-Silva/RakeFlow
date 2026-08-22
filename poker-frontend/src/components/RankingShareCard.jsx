import { useRef, useState } from 'react';
import { shareCardImage } from '../utils/shareImage';

// Tarjeta-podio compartible del ranking del staff: el MISMO podio que se ve
// en la pestaña Ranking, convertido a imagen (PNG por Web Share → WhatsApp;
// fallback descarga). Mismo mecanismo que las tarjetas-trofeo del panel.
// Lleva los valores tal cual se ven en el podio — lo comparte el dueño a
// propósito, desde su pantalla.

const STEP = [
  { wrap: { transform: 'scale(1.1) translateY(-8px)' }, circle: 'w-14 h-14 bg-yellow-500/20 border-yellow-500', num: 'text-yellow-400 text-xl', name: 'text-[13px] font-black text-white', bar: 'h-20 bg-yellow-600/20 rounded-t-xl border-x border-t border-yellow-500/30', val: 'text-[11px] text-yellow-300' },
  { wrap: {}, circle: 'w-12 h-12 bg-gray-400/20 border-gray-400', num: 'text-gray-200', name: 'text-[11px] font-bold text-gray-200', bar: 'h-12 bg-gray-700/50 rounded-t-lg', val: 'text-[10px] text-gray-200' },
  { wrap: {}, circle: 'w-10 h-10 bg-orange-700/20 border-orange-600', num: 'text-orange-400 text-sm', name: 'text-[11px] font-bold text-gray-300', bar: 'h-8 bg-gray-700/50 rounded-t-lg', val: 'text-[10px] text-gray-300' },
];

function Step({ pos, player, format }) {
  if (!player) return <div className="flex-1" />;
  const st = STEP[pos];
  return (
    <div className="flex flex-col items-center flex-1 min-w-0" style={st.wrap}>
      {pos === 0 && <p className="text-2xl leading-none mb-1">🏆</p>}
      <div className={`${st.circle} rounded-full border-2 flex items-center justify-center mb-2`}>
        <span className={`font-black ${st.num}`}>{pos + 1}</span>
      </div>
      <p className={`${st.name} w-full text-center leading-tight line-clamp-2 break-words`} style={{ minHeight: '2.4em' }}>{player.name}</p>
      <div className={`${st.bar} w-full mt-2 flex items-center justify-center`}>
        <span className={`font-mono font-bold whitespace-nowrap tabular-nums ${st.val}`}>{format(player.value)}</span>
      </div>
    </div>
  );
}

export default function RankingShareCard({ def, data, clubName, periodLabel, onClose }) {
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState(null);
  const cardRef = useRef(null);

  const shareText = `${def.emoji} ${def.title} · ${periodLabel}${clubName ? ` · ${clubName}` : ''}`;
  const fileSlug = `ranking-${def.key}-${periodLabel.replace(/\s+/g, '-')}`;

  const share = async () => {
    if (!cardRef.current || busy) return;
    setBusy(true);
    try {
      const outcome = await shareCardImage(cardRef.current, { shareText, fileName: `${fileSlug}.png` });
      setShared(outcome);
    } catch (e) {
      if (e?.name !== 'AbortError') setShared('downloaded_failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm overflow-y-auto" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Compartir ${def.title}`}>
      <button onClick={onClose} aria-label="Cerrar"
        className="fixed top-3 right-3 z-10 w-11 h-11 flex items-center justify-center rounded-full bg-gray-800/80 text-gray-300 hover:text-white text-lg leading-none">✕</button>

      <div className="min-h-full flex flex-col items-center justify-center px-4 pt-16 pb-8" onClick={(e) => e.stopPropagation()}>
        {/* La card que se convierte en imagen (fondo explícito para el PNG). */}
        <div ref={cardRef} className={`w-[320px] rounded-2xl p-5 border ${def.tone.ring}`} style={{ background: def.grad }}>
          <div className="flex items-center justify-between gap-2">
            <p className={`text-[10px] font-black tracking-[0.25em] uppercase ${def.tone.icon} truncate`}>{clubName || 'Mi club'}</p>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide shrink-0 capitalize">{periodLabel}</span>
          </div>
          <p className="text-center text-white text-2xl font-black mt-4 leading-tight">{def.emoji} {def.title}</p>
          <p className="text-center text-gray-400 text-xs mt-1">{def.measure}</p>

          <div className="flex items-end justify-center gap-1.5 pt-6 pb-1">
            <Step pos={1} player={data[1]} format={def.format} />
            <Step pos={0} player={data[0]} format={def.format} />
            <Step pos={2} player={data[2]} format={def.format} />
          </div>

          <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between gap-2">
            <p className="text-gray-300 text-xs">¿Estás en el podio?</p>
            <p className="text-[9px] text-gray-500 font-bold tracking-[0.2em] shrink-0">rakeflow.site</p>
          </div>
        </div>

        <button onClick={share} disabled={busy}
          className={`w-[320px] mt-4 min-h-12 rounded-xl ${def.tone.btn} disabled:opacity-50 text-white font-black uppercase tracking-wide`}>
          {busy ? 'Generando imagen…' : '📤 Compartir por WhatsApp'}
        </button>

        {shared === 'downloaded' && (
          <p className="text-xs text-gray-400 mt-3 text-center w-[320px]">Imagen descargada — adjúntala en tu chat de WhatsApp.</p>
        )}
        {shared === 'downloaded_failed' && (
          <p className="text-xs text-red-300 mt-3 text-center w-[320px]">No se pudo generar la imagen. Prueba de nuevo.</p>
        )}

        <button onClick={onClose} className="mt-5 min-h-11 text-sm text-gray-400 hover:text-white font-bold">Cerrar</button>
      </div>
    </div>
  );
}
