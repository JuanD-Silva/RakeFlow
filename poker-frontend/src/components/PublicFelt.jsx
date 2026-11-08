// ---------------------------------------------------------------------------
// Tema "la mesa te espera" de la capa pública (/c/{token} y la ficha del
// torneo): fieltro de casino y oro. Extraído de PublicClub para que la ficha
// de inscripción se vea igual. La fuente Cinzel se carga SOLO acá (React 19
// hoistea y dedupea el <link>).
// ---------------------------------------------------------------------------

export const SectionTitle = ({ children }) => (
  <div className="flex items-center gap-3">
    <span className="h-px flex-1 bg-gradient-to-r from-transparent via-[#d9b45b66] to-[#d9b45b66]" />
    <p className="pc-display text-[11px] font-bold text-[#d9b45b] uppercase tracking-[0.3em] whitespace-nowrap">{children}</p>
    <span className="h-px flex-1 bg-gradient-to-l from-transparent via-[#d9b45b66] to-[#d9b45b66]" />
  </div>
);

export const Pill = ({ children, tone = 'gold' }) => (
  <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full whitespace-nowrap ring-1 ${
    tone === 'gold' ? 'bg-[#d9b45b1f] text-[#e8cd85] ring-[#d9b45b55]'
    : tone === 'full' ? 'bg-[#d0655a26] text-[#e8a29a] ring-[#d0655a55]'
    : 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40'
  }`}>{children}</span>
);

// Palos flotando al fondo (decoración).
export const FeltSuits = () => (
  <>
    <span aria-hidden className="pc-suit" style={{ top: '6%', left: '-14px' }}>♠</span>
    <span aria-hidden className="pc-suit pc-suit-red" style={{ top: '30%', right: '-20px', animationDelay: '-4s' }}>♦</span>
    <span aria-hidden className="pc-suit" style={{ bottom: '26%', left: '-8px', animationDelay: '-8s' }}>♣</span>
    <span aria-hidden className="pc-suit pc-suit-red" style={{ bottom: '4%', right: '-10px', animationDelay: '-11s' }}>♥</span>
  </>
);

export const FeltStyles = () => (
  <>
    <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
    <link rel="stylesheet" precedence="default"
      href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&display=swap" />
    <style>{`
      .pc-root{
        background:
          radial-gradient(130% 90% at 50% -12%, #175a41 0%, #0d3a29 38%, #07271b 66%, #03130d 100%);
      }
      /* Grano sutil de fieltro */
      .pc-root::before{
        content:""; position:absolute; inset:0; pointer-events:none; opacity:.05;
        background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.6'/%3E%3C/svg%3E");
      }
      /* Viñeta: foco al centro, como lámpara sobre la mesa */
      .pc-root::after{
        content:""; position:absolute; inset:0; pointer-events:none;
        background: radial-gradient(90% 70% at 50% 20%, transparent 55%, rgba(0,0,0,.45) 100%);
      }
      .pc-display{ font-family:'Cinzel', Georgia, serif; }
      .pc-title{
        background: linear-gradient(100deg, #a8842e 0%, #e8cd85 28%, #f7e9bd 46%, #d9b45b 60%, #a8842e 100%);
        background-size: 220% auto;
        -webkit-background-clip: text; background-clip: text; color: transparent;
        animation: pc-shine 6s ease-in-out infinite;
      }
      @keyframes pc-shine{ 0%,100%{ background-position: 0% center } 50%{ background-position: 100% center } }
      /* Palos flotando muy tenues al fondo */
      .pc-suit{ position:absolute; pointer-events:none; font-size:88px; line-height:1;
        color:#000; opacity:.14; text-shadow: 0 1px 0 #ffffff10;
        animation: pc-float 14s ease-in-out infinite; }
      .pc-suit-red{ color:#3d0f0f; opacity:.18; }
      @keyframes pc-float{ 0%,100%{ transform:translateY(0) rotate(-8deg) } 50%{ transform:translateY(-14px) rotate(6deg) } }
      /* Paneles de mesa: fieltro con filo dorado */
      .pc-card{
        background: linear-gradient(160deg, rgba(13,58,41,.85), rgba(6,32,22,.92));
        border:1px solid #d9b45b3d; border-radius:1rem;
        box-shadow: 0 10px 30px rgba(0,0,0,.35), inset 0 1px 0 #ffffff12;
      }
      .pc-chip{ width:18px; height:18px; border-radius:9999px; display:inline-block; }
      .pc-chip-taken{
        background: radial-gradient(circle at 35% 30%, #f0d99a, #d9b45b 55%, #8a6a24 100%);
        border:2px dashed #00000055; box-shadow: 0 2px 4px rgba(0,0,0,.5);
      }
      .pc-chip-free{ border:2px dashed #d9b45b55; background:transparent; }
      .pc-in{ opacity:0; animation: pc-up .6s cubic-bezier(.2,.7,.3,1) forwards; }
      @keyframes pc-up{ from{ opacity:0; transform:translateY(14px) } to{ opacity:1; transform:none } }
      .pc-pulse{ animation: pc-pulse 2.2s ease-in-out infinite; }
      @keyframes pc-pulse{ 0%,100%{ box-shadow:0 0 0 0 #34d39955 } 50%{ box-shadow:0 0 0 7px transparent } }
      .pc-fan{ display:inline-block; animation: pc-float 10s ease-in-out infinite; }
      @media (prefers-reduced-motion: reduce){
        .pc-title,.pc-suit,.pc-pulse,.pc-fan{ animation:none } .pc-in{ animation:none; opacity:1 }
      }
    `}</style>
  </>
);
