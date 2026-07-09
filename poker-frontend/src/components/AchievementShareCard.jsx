import { useRef, useState } from 'react';
import { shareCardImage } from '../utils/shareImage';

// Tarjeta-trofeo compartible del panel: estatus VIP, reto del mes logrado y
// logros desbloqueados. A diferencia del viejo "compartir" del VIP (un link de
// texto promocionando la app), acá el LOGRO es el protagonista: se genera una
// imagen premium —emoji héroe con destello, nombre del jugador, club— y viaja
// como PNG por Web Share, con rakeflow.site como crédito discreto al pie.
//
// Coherente con el resto del panel: reconocimiento, nunca plata (estos logros
// son no-monetarios, así el que pierde también tiene algo que presumir).

const ACCENTS = {
  vip: {
    grad: 'linear-gradient(160deg, #0a1a30 0%, #0a1020 55%, #0a2b3c 100%)',
    ring: 'border-cyan-400/40', kick: 'text-cyan-300',
    glow: 'rgba(34,211,238,0.30)', btn: 'bg-cyan-600 hover:bg-cyan-500',
  },
  challenge: {
    grad: 'linear-gradient(160deg, #170a32 0%, #0a0f1a 55%, #052e22 100%)',
    ring: 'border-violet-400/40', kick: 'text-violet-300',
    glow: 'rgba(167,139,250,0.32)', btn: 'bg-violet-600 hover:bg-violet-500',
  },
  badge: {
    grad: 'linear-gradient(160deg, #0b1220 0%, #0a0f1a 55%, #052e22 100%)',
    ring: 'border-emerald-500/40', kick: 'text-emerald-300',
    glow: 'rgba(16,185,129,0.30)', btn: 'bg-emerald-600 hover:bg-emerald-500',
  },
};

export default function AchievementShareCard({
  onClose, accent = 'badge', tag = 'Logro',
  emoji, kicker, title, subtitle, clubName, playerName,
  shareText, fileSlug = 'logro',
}) {
  const a = ACCENTS[accent] || ACCENTS.badge;
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState(null); // 'shared' | 'downloaded' | 'downloaded_failed'
  const cardRef = useRef(null);

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

  const waLink = `https://wa.me/?text=${encodeURIComponent(shareText)}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm overflow-y-auto" onClick={onClose}>
      <button onClick={onClose} aria-label="Cerrar"
        className="rf-tap fixed top-3 right-3 z-10 w-9 h-9 flex items-center justify-center rounded-full bg-gray-800/80 text-gray-300 hover:text-white text-lg leading-none">✕</button>

      <div className="min-h-full flex flex-col items-center justify-center px-4 pt-16 pb-8" onClick={(e) => e.stopPropagation()}>
        {/* La card que se convierte en imagen (fondo explícito para el PNG). */}
        <div ref={cardRef} className={`w-[320px] rounded-2xl p-6 border ${a.ring}`} style={{ background: a.grad }}>
          <div className="flex items-center justify-between">
            <p className={`text-[10px] font-black tracking-[0.25em] uppercase ${a.kick} truncate`}>{clubName || 'Mi club'}</p>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide shrink-0 ml-2">{tag}</span>
          </div>

          {/* Emoji héroe con destello radial. */}
          <div className="relative flex items-center justify-center my-6" style={{ height: '128px' }}>
            <div className="absolute rounded-full" style={{ width: '168px', height: '168px', background: `radial-gradient(circle, ${a.glow} 0%, transparent 70%)` }} />
            <p className="relative leading-none" style={{ fontSize: '5rem' }}>{emoji}</p>
          </div>

          <p className={`text-center text-[11px] font-black uppercase tracking-[0.2em] ${a.kick}`}>{kicker}</p>
          <p className="text-center text-white text-2xl font-black mt-1.5 leading-tight" style={{ textWrap: 'balance' }}>{title}</p>
          {subtitle && <p className="text-center text-gray-400 text-sm mt-2 leading-snug">{subtitle}</p>}

          <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between gap-2">
            <p className="text-white font-bold text-sm truncate">{playerName}</p>
            <p className="text-[9px] text-gray-500 font-bold tracking-[0.2em] shrink-0">rakeflow.site</p>
          </div>
        </div>

        <button onClick={share} disabled={busy}
          className={`w-[320px] mt-4 py-3 rounded-xl ${a.btn} disabled:opacity-50 text-white font-black uppercase tracking-wide`}>
          {busy ? 'Generando imagen…' : '📤 Compartir'}
        </button>

        {shared === 'downloaded' && (
          <>
            <p className="text-[11px] text-gray-400 mt-2">Imagen descargada — adjuntala en tu chat</p>
            <a href={waLink} target="_blank" rel="noreferrer"
              className="w-[320px] mt-2 py-3 rounded-xl bg-[#25D366]/90 hover:bg-[#25D366] text-white font-black uppercase tracking-wide text-center">
              Compartir texto por WhatsApp
            </a>
          </>
        )}
        {shared === 'downloaded_failed' && (
          <a href={waLink} target="_blank" rel="noreferrer"
            className="w-[320px] mt-3 py-3 rounded-xl bg-[#25D366]/90 hover:bg-[#25D366] text-white font-black uppercase tracking-wide text-center">
            No salió la imagen — compartir texto por WhatsApp
          </a>
        )}

        <button onClick={onClose} className="mt-5 text-sm text-gray-400 hover:text-white font-bold">Cerrar</button>
      </div>
    </div>
  );
}
