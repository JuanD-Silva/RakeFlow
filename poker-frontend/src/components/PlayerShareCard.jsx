import { useEffect, useRef, useState } from 'react';
import { playerSelfService } from '../api/services';
import { signCop, monthName } from '../utils/formatters';
import { shareCardImage } from '../utils/shareImage';

// Card mensual compartible del jugador: /player/monthly-summary → imagen PNG
// (html-to-image) → Web Share API. Fallbacks: descarga del PNG + texto por
// wa.me. Es la pieza de marketing boca-a-boca del panel: el jugador presume
// su mes y el club (y RakeFlow) viajan en la imagen.

const TIER_EMOJI = { Bronce: '🥉', Plata: '🥈', Oro: '🥇', Diamante: '💎' };

export default function PlayerShareCard({ onClose }) {
  const [period, setPeriod] = useState(null); // null = mes en curso
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState(null); // 'shared' | 'downloaded'
  const cardRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(false);
    setShared(null);
    playerSelfService.getMonthlySummary(period?.year, period?.month)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [period]);

  const now = new Date();
  const isCurrent = !data || (data.period.year === now.getFullYear() && data.period.month === now.getMonth() + 1);

  const move = (delta) => {
    if (!data) return;
    let { year, month } = data.period;
    month += delta;
    if (month === 0) { month = 12; year -= 1; }
    if (month === 13) { month = 1; year += 1; }
    if (year === now.getFullYear() && month === now.getMonth() + 1) setPeriod(null);
    else setPeriod({ year, month });
  };

  const shareText = () => {
    const mes = monthName(data.period.year, data.period.month);
    // Encuadre adaptativo (igual que el panel): si el mes va en negativo, la plata
    // NO viaja en el texto — se comparte lo no-monetario (visitas/horas/racha).
    const vis = `${data.visits} visita${data.visits !== 1 ? 's' : ''}`;
    let txt = data.profit >= 0
      ? `🃏 Mi ${mes} en ${data.club_name}: ${signCop(data.profit)} en ${vis}`
      : `🃏 Mi ${mes} en ${data.club_name}: ${vis}`;
    if (data.hours > 0) txt += ` (${data.hours} h en mesa)`;
    if (data.streak_weeks > 1) txt += ` · ${data.streak_weeks} semanas seguidas 🔥`;
    return txt;
  };

  const share = async () => {
    if (!cardRef.current || busy) return;
    setBusy(true);
    try {
      const mes = monthName(data.period.year, data.period.month);
      const outcome = await shareCardImage(cardRef.current, { shareText: shareText(), fileName: `mi-mes-${mes}.png` });
      setShared(outcome);
    } catch (e) {
      if (e?.name !== 'AbortError') setShared('downloaded_failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm overflow-y-auto" onClick={onClose}>
      <button onClick={onClose} aria-label="Cerrar"
        className="rf-tap fixed top-3 right-3 z-10 w-9 h-9 flex items-center justify-center rounded-full bg-gray-800/80 text-gray-300 hover:text-white text-lg leading-none">✕</button>
      {/* pt mayor que el ✕ (top-3): al scrollear un modal alto, la nav de meses no
          queda debajo del botón de cerrar. */}
      <div className="min-h-full flex flex-col items-center justify-center px-4 pt-16 pb-8" onClick={(e) => e.stopPropagation()}>

        {/* Navegación de mes */}
        <div className="w-[320px] flex items-center justify-between mb-3 text-gray-300">
          <button onClick={() => move(-1)} aria-label="Mes anterior"
            className="rf-tap px-4 py-2 text-lg leading-none rounded-lg bg-gray-800 hover:bg-gray-700 font-bold">‹</button>
          <p className="text-sm font-black uppercase tracking-widest">
            {data ? `${monthName(data.period.year, data.period.month)} ${data.period.year}` : '…'}
          </p>
          <button onClick={() => move(1)} disabled={isCurrent} aria-label="Mes siguiente"
            className="rf-tap px-4 py-2 text-lg leading-none rounded-lg bg-gray-800 hover:bg-gray-700 font-bold disabled:opacity-30">›</button>
        </div>

        {error && <p className="text-sm text-red-300 py-10">No se pudo cargar el resumen. Probá de nuevo.</p>}
        {!data && !error && (
          <div className="w-[320px] rounded-2xl p-5 border border-gray-700/60 space-y-3">
            <div className="rf-skel h-4 w-1/2" />
            <div className="rf-skel h-10 w-2/3" />
            <div className="grid grid-cols-3 gap-2">
              <div className="rf-skel h-14" /><div className="rf-skel h-14" /><div className="rf-skel h-14" />
            </div>
            <div className="rf-skel h-12 w-full" />
          </div>
        )}

        {data && data.locked && (
          <div className="w-[320px] bg-gray-900 border border-violet-500/40 rounded-2xl p-6 text-center">
            <p className="text-4xl mb-2">🔒</p>
            <p className="text-white font-black">Este mes está en el archivo</p>
            <p className="text-sm text-violet-200 mt-1">Preguntá en caja para desbloquear tu historia completa.</p>
          </div>
        )}

        {data && !data.locked && (
          <>
            {/* La card que se convierte en imagen (fondo explícito para el PNG) */}
            <div ref={cardRef} className="w-[320px] rounded-2xl p-5 border border-emerald-500/30"
              style={{ background: 'linear-gradient(160deg, #0b1220 0%, #0a0f1a 55%, #052e22 100%)' }}>
              <div className="flex items-center justify-between">
                <p className="text-emerald-400 text-[10px] font-black tracking-[0.25em] uppercase">{data.club_name}</p>
                <span className="text-[10px] font-bold text-gray-400">{TIER_EMOJI[data.level] || '🥉'} {data.level}</span>
              </div>
              <p className="text-white text-xl font-black mt-3">{data.player_name}</p>
              <p className="text-gray-400 text-xs font-bold uppercase tracking-widest">
                Mi {monthName(data.period.year, data.period.month)} {data.period.year}
              </p>

              {/* Encuadre adaptativo: el ganador luce su profit; el que va en
                  negativo comparte su actividad (visitas), nunca la pérdida. */}
              {data.profit >= 0 ? (
                <>
                  <p className="mt-4 text-4xl font-black text-emerald-300">{signCop(data.profit)}</p>
                  <p className="text-[11px] text-gray-500 font-bold uppercase tracking-wide">Resultado del mes</p>
                </>
              ) : (
                <>
                  <p className="mt-4 text-4xl font-black text-white">
                    {data.visits} <span className="text-lg text-gray-400 font-bold">visita{data.visits !== 1 ? 's' : ''}</span>
                  </p>
                  <p className="text-[11px] text-gray-500 font-bold uppercase tracking-wide">Este mes en la mesa</p>
                </>
              )}

              <div className="grid grid-cols-3 gap-2 mt-4 text-center">
                <div className="bg-white/5 rounded-xl py-2">
                  <p className="text-white font-black">{data.visits}</p>
                  <p className="text-[9px] text-gray-400 font-bold uppercase">Visitas</p>
                </div>
                <div className="bg-white/5 rounded-xl py-2">
                  <p className="text-white font-black">{data.hours}</p>
                  <p className="text-[9px] text-gray-400 font-bold uppercase">Horas</p>
                </div>
                <div className="bg-white/5 rounded-xl py-2">
                  <p className="text-white font-black">{data.streak_weeks}🔥</p>
                  <p className="text-[9px] text-gray-400 font-bold uppercase">Semanas</p>
                </div>
              </div>

              {/* Mejor noche solo si de verdad fue ganadora — no compartimos una
                  "mejor noche" en rojo (coherente con esconder la pérdida). */}
              {data.best_session && data.best_session.profit > 0 && (
                <div className="mt-3 bg-white/5 rounded-xl px-3 py-2">
                  <p className="text-[9px] text-gray-400 font-bold uppercase">Mejor noche</p>
                  <p className="text-sm text-white font-bold truncate">
                    {data.best_session.name} · <span className="text-emerald-300">{signCop(data.best_session.profit)}</span>
                  </p>
                </div>
              )}

              {data.partial && (
                <p className="text-[9px] text-gray-500 mt-2">* Desde la activación de tu cuenta</p>
              )}
              <p className="text-center text-[9px] text-gray-600 font-bold mt-4 tracking-widest">rakeflow.site</p>
            </div>

            <button onClick={share} disabled={busy}
              className="w-[320px] mt-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-black uppercase tracking-wide">
              {busy ? 'Generando imagen…' : '📤 Compartir'}
            </button>
            {shared === 'downloaded' && (
              <>
                <p className="text-[11px] text-gray-400 mt-2">Imagen descargada — adjuntala en tu chat</p>
                <a href={`https://wa.me/?text=${encodeURIComponent(shareText())}`} target="_blank" rel="noreferrer"
                  className="w-[320px] mt-2 py-3 rounded-xl bg-[#25D366]/90 hover:bg-[#25D366] text-white font-black uppercase tracking-wide text-center">
                  Compartir texto por WhatsApp
                </a>
              </>
            )}
            {shared === 'downloaded_failed' && (
              <a href={`https://wa.me/?text=${encodeURIComponent(shareText())}`} target="_blank" rel="noreferrer"
                className="w-[320px] mt-3 py-3 rounded-xl bg-[#25D366]/90 hover:bg-[#25D366] text-white font-black uppercase tracking-wide text-center">
                No salió la imagen — compartir texto por WhatsApp
              </a>
            )}
          </>
        )}

        <button onClick={onClose} className="mt-5 text-sm text-gray-400 hover:text-white font-bold">Cerrar</button>
      </div>
    </div>
  );
}
