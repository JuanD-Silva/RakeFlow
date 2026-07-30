import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { publicService } from '../api/services';

// ---------------------------------------------------------------------------
// Página pública del club (/c/{token}) — la INVITACIÓN que el club comparte
// por WhatsApp. Dirección de diseño: "la mesa te espera" — fieltro de casino
// y oro, el nombre del CLUB como marquesina (RakeFlow va al pie), sillas como
// fichas de poker y un estado vacío que vende la noche en vez de disculparse.
// La fuente Cinzel se carga SOLO acá (React 19 hoistea y dedupea el <link>).
// ---------------------------------------------------------------------------

function elapsed(startIso) {
  if (!startIso) return '';
  const mins = Math.max(0, Math.floor((Date.now() - new Date(startIso).getTime()) / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Sillas de la mesa como fichas: ocupada = ficha dorada sólida, libre = fantasma.
const SeatChips = ({ taken, total }) => (
  <div className="flex flex-wrap gap-1.5 mt-3" aria-label={`${taken} de ${total} sillas ocupadas`}>
    {Array.from({ length: total }).map((_, s) => (
      <span key={s} className={s < taken ? 'pc-chip pc-chip-taken' : 'pc-chip pc-chip-free'} />
    ))}
  </div>
);

const SectionTitle = ({ children }) => (
  <div className="flex items-center gap-3">
    <span className="h-px flex-1 bg-gradient-to-r from-transparent via-[#d9b45b66] to-[#d9b45b66]" />
    <p className="pc-display text-[11px] font-bold text-[#d9b45b] uppercase tracking-[0.3em] whitespace-nowrap">{children}</p>
    <span className="h-px flex-1 bg-gradient-to-l from-transparent via-[#d9b45b66] to-[#d9b45b66]" />
  </div>
);

const Pill = ({ children, tone = 'gold' }) => (
  <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full whitespace-nowrap ring-1 ${
    tone === 'gold' ? 'bg-[#d9b45b1f] text-[#e8cd85] ring-[#d9b45b55]'
    : tone === 'full' ? 'bg-[#d0655a26] text-[#e8a29a] ring-[#d0655a55]'
    : 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40'
  }`}>{children}</span>
);

// Sorteo de sillas del torneo: el jugador llega, busca su nombre y ve su mesa y
// silla sin preguntar en caja. Se refresca solo mientras está abierto (el staff
// sigue sentando gente durante el registro).
function TournamentSeating({ token, tournamentId }) {
  const [seating, setSeating] = useState(null);
  const [error, setError] = useState(false);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try {
      setSeating(await publicService.getTournamentSeating(token, tournamentId));
      setError(false);
    } catch { setError(true); }
  }, [token, tournamentId]);

  useEffect(() => {
    // El primer load va por setTimeout(0): mismo efecto, pero sin setState
    // síncrono dentro del cuerpo del efecto (regla react-hooks).
    const t0 = setTimeout(load, 0);
    const id = setInterval(load, 30000);
    return () => { clearTimeout(t0); clearInterval(id); };
  }, [load]);

  if (error) return <p className="text-[#e8a29a] text-xs mt-3">No se pudo cargar el sorteo. Reintentando…</p>;
  if (!seating) return <p className="text-[#9fb3a4] text-xs mt-3">Cargando sorteo…</p>;

  // Búsqueda insensible a tildes: "jose" encuentra a "José" (el jugador se
  // busca a sí mismo — no puede fallar por un acento).
  const norm = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const query = norm(q.trim());
  const matches = (name) => query && norm(name).includes(query);
  const total = seating.tables.reduce((n, t) => n + t.seats.length, 0) + seating.waiting.length;
  // Al buscar, solo las mesas con match (sin encabezados vacíos apilados).
  const visibleTables = query
    ? seating.tables.filter((t) => t.seats.some((s) => matches(s.name)))
    : seating.tables;
  const anyMatch = !query || visibleTables.length > 0 || seating.waiting.some(matches);

  if (total === 0) return <p className="text-[#9fb3a4] text-xs mt-3">Todavía no hay jugadores sentados.</p>;

  return (
    <div className="mt-3 space-y-3">
      <input
        type="search" value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Busca tu nombre…" aria-label="Buscar mi nombre en el sorteo"
        className="w-full rounded-lg bg-black/30 border border-[#d9b45b40] px-3 py-2 text-sm text-[#f4efe4] placeholder-[#9fb3a4] focus:outline-none focus:border-[#d9b45b]"
      />
      {!anyMatch && (
        <p className="text-[#e8cd85] text-xs">No apareces todavía — pregunta en caja para inscribirte.</p>
      )}
      {visibleTables.map((t) => (
        <div key={t.table_number}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#e8cd85] mb-1.5">Mesa {t.table_number}</p>
          <div className="space-y-1">
            {t.seats.filter((s) => !query || matches(s.name)).map((s) => (
              <div key={s.seat}
                className={`flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-sm ${matches(s.name) ? 'bg-[#d9b45b26] ring-1 ring-[#d9b45b80] text-white font-bold' : 'bg-black/20 text-[#f4efe4]'}`}>
                <span className="truncate">{s.name}</span>
                <span className="shrink-0 text-[#e8cd85] font-bold whitespace-nowrap">Silla {s.seat}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {seating.waiting.length > 0 && (!query || seating.waiting.some(matches)) && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#9fb3a4] mb-1.5">En espera de silla</p>
          <div className="space-y-1">
            {seating.waiting.filter((n) => !query || matches(n)).map((n, i) => (
              <div key={i}
                className={`rounded-lg px-3 py-1.5 text-sm ${matches(n) ? 'bg-[#d9b45b26] ring-1 ring-[#d9b45b80] text-white font-bold' : 'bg-black/20 text-[#9fb3a4]'}`}>
                {n}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PublicClub() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  // Torneo con el sorteo de sillas desplegado (id) — solo se consulta al abrir.
  const [openSeatingId, setOpenSeatingId] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await publicService.getClubActivity(token);
      setData(res); setError(false);
    } catch {
      setError(true);
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => {
    load();
    const id = setInterval(load, 20000); // auto-refresh
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => { if (data?.club_name) document.title = `${data.club_name} · Poker en vivo`; }, [data]);

  const cash = data?.cash || [];
  const tournaments = data?.tournaments || [];
  const scheduled = data?.scheduled || [];
  const liveCount = cash.length + tournaments.length;
  const empty = liveCount === 0 && scheduled.length === 0;

  return (
    <div className="pc-root min-h-screen text-[#f4efe4] font-sans px-4 py-10 relative overflow-hidden">
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

      {/* Palos flotando al fondo (decoración) */}
      <span aria-hidden className="pc-suit" style={{ top: '6%', left: '-14px' }}>♠</span>
      <span aria-hidden className="pc-suit pc-suit-red" style={{ top: '30%', right: '-20px', animationDelay: '-4s' }}>♦</span>
      <span aria-hidden className="pc-suit" style={{ bottom: '26%', left: '-8px', animationDelay: '-8s' }}>♣</span>
      <span aria-hidden className="pc-suit pc-suit-red" style={{ bottom: '4%', right: '-10px', animationDelay: '-11s' }}>♥</span>

      <div className="max-w-md mx-auto space-y-7 relative">
        {loading && (
          <div className="min-h-[70vh] flex items-center justify-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#d9b45b]" />
          </div>
        )}

        {!loading && (error || !data) && (
          <div className="min-h-[70vh] flex flex-col items-center justify-center text-center">
            <p className="pc-display text-5xl text-[#d9b45b] mb-4">♠</p>
            <p className="pc-display font-bold text-white text-lg tracking-wide">Club no encontrado</p>
            <p className="text-sm mt-1 text-[#9fb3a4]">El link no es válido o expiró.</p>
          </div>
        )}

        {!loading && !error && data && (
          <>
            {/* Marquesina del club */}
            <header className="text-center pc-in">
              <div className="flex items-center justify-center gap-2 text-[#d9b45b]">
                <span className="h-px w-10 bg-gradient-to-r from-transparent to-[#d9b45b88]" />
                <p className="text-[10px] font-bold tracking-[0.42em] uppercase">♦ Club de Poker ♦</p>
                <span className="h-px w-10 bg-gradient-to-l from-transparent to-[#d9b45b88]" />
              </div>
              <h1 className="pc-display pc-title text-5xl font-black mt-3 leading-tight uppercase tracking-wide break-words">
                {data.club_name}
              </h1>
              {liveCount > 0 && (
                <p className="inline-flex items-center gap-2 mt-4 text-emerald-200 text-xs font-bold uppercase tracking-widest bg-emerald-500/10 ring-1 ring-emerald-500/40 rounded-full px-3.5 py-1.5">
                  <span className="pc-pulse relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                  En vivo · la sala está activa
                </p>
              )}
            </header>

            {/* CTA: entra a tu panel (auto-registro por QR). El gancho es el
                ego del jugador — su ranking/logros/estatus — no "gestión". */}
            <Link to={`/c/${token}/entrar`}
              className="pc-in block text-center bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-black uppercase tracking-wide rounded-2xl px-5 py-4 shadow-lg shadow-emerald-900/40 ring-1 ring-emerald-300/30"
              style={{ animationDelay: '60ms' }}>
              <span className="text-lg">📲 Entra a tu panel</span>
              <span className="block text-[11px] font-semibold text-emerald-100/90 tracking-normal normal-case mt-0.5">
                Mira tu ranking, tus logros y tu estatus en el club
              </span>
            </Link>

            {/* Anuncio del club — el gancho de la noche */}
            {data.announcement && (
              <div className="pc-card px-5 py-4 text-center pc-in" style={{ animationDelay: '90ms', borderColor: '#d9b45b77' }}>
                <p className="pc-display text-[10px] text-[#d9b45b] font-bold uppercase tracking-[0.35em] mb-1.5">✦ Esta noche ✦</p>
                <p className="text-[#f7e9bd] font-bold text-lg leading-snug">{data.announcement}</p>
              </div>
            )}

            {/* JACKPOT — el gancho del club. Se muestra SIEMPRE (haya mesa o no):
                es lo que los jugadores más piden ver. null = el club lo apagó. */}
            {data.jackpot != null && (
              <div className="pc-card px-5 py-5 text-center pc-in" style={{ animationDelay: '110ms', borderColor: '#d9b45b77' }}>
                <p className="pc-display text-[10px] text-[#d9b45b] font-bold uppercase tracking-[0.35em] mb-2">✦ Jackpot acumulado ✦</p>
                <p className="pc-display text-4xl font-black text-[#f7e9bd] leading-none tracking-wide break-words">
                  ${Number(data.jackpot).toLocaleString('es-CO')}
                </p>
              </div>
            )}

            {/* Estado vacío que VENDE (es lo que más se ve: el club abre de noche) */}
            {empty && (
              <div className="py-12 text-center pc-in" style={{ animationDelay: '120ms' }}>
                <p className="text-4xl tracking-[0.35em] select-none" aria-hidden>
                  <span className="pc-fan text-[#e8cd85]">♠</span>
                  <span className="pc-fan text-[#c96a5e]" style={{ animationDelay: '-2s' }}>♥</span>
                  <span className="pc-fan text-[#c96a5e]" style={{ animationDelay: '-5s' }}>♦</span>
                  <span className="pc-fan text-[#e8cd85]" style={{ animationDelay: '-7s' }}>♣</span>
                </p>
                <p className="pc-display text-[#f7e9bd] font-bold text-xl mt-5 tracking-wide">Las cartas ya están barajadas</p>
                <p className="text-sm mt-2 text-[#9fb3a4] max-w-[30ch] mx-auto leading-relaxed">
                  La sala abre por la noche. Guardá este link: cuando haya mesa, acá la ves primero.
                </p>
              </div>
            )}

            {/* Mesas cash */}
            {cash.length > 0 && (
              <section className="space-y-3 pc-in" style={{ animationDelay: '140ms' }}>
                <SectionTitle>Mesas en juego</SectionTitle>
                {cash.map((c, i) => {
                  const seats = c.seats_available;
                  return (
                    <div key={i} className="pc-card px-5 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-white font-bold text-lg truncate">
                            <span className="text-[#d9b45b] mr-1.5">♠</span>{c.name}
                          </p>
                          <p className="text-[#9fb3a4] text-xs mt-1">
                            {c.players_count} jugando
                            {c.max_players ? ` · mesa de ${c.max_players}` : ''} · {elapsed(c.start_time)} en juego
                          </p>
                        </div>
                        {seats != null
                          ? (seats > 0
                              ? <Pill tone="live">{seats} silla{seats !== 1 ? 's' : ''} libre{seats !== 1 ? 's' : ''}</Pill>
                              : <Pill tone="full">Mesa llena</Pill>)
                          : <Pill>{c.status}</Pill>}
                      </div>
                      {c.max_players && <SeatChips taken={c.players_count} total={c.max_players} />}
                    </div>
                  );
                })}
              </section>
            )}

            {/* Torneos */}
            {tournaments.length > 0 && (
              <section className="space-y-3 pc-in" style={{ animationDelay: '200ms' }}>
                <SectionTitle>Torneos</SectionTitle>
                {tournaments.map((t, i) => (
                  <div key={t.id ?? i} className="pc-card px-5 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-white font-bold text-lg truncate">
                          <span className="text-[#d9b45b] mr-1.5">🏆</span>{t.name}
                        </p>
                        <p className="text-[#9fb3a4] text-xs mt-1">
                          {t.active > 0 ? `${t.active} jugando` : `${t.registered} inscrito${t.registered !== 1 ? 's' : ''}`}
                          {t.tables != null && ` · ${t.tables} mesa${t.tables !== 1 ? 's' : ''}`}
                          {t.seats_available != null && ` · ${t.seats_available} cupo${t.seats_available !== 1 ? 's' : ''}`}
                        </p>
                      </div>
                      <Pill tone={t.status === 'En juego' ? 'live' : 'gold'}>{t.status}</Pill>
                    </div>
                    {t.id != null && (
                      <div className="mt-2">
                        <button type="button"
                          onClick={() => setOpenSeatingId(openSeatingId === t.id ? null : t.id)}
                          className="text-sm font-bold text-[#e8cd85] py-1">
                          🪑 ¿Dónde me siento? {openSeatingId === t.id ? 'Ocultar el sorteo' : 'Ver el sorteo de sillas'}
                        </button>
                        {openSeatingId === t.id && <TournamentSeating token={token} tournamentId={t.id} />}
                      </div>
                    )}
                  </div>
                ))}
              </section>
            )}

            {/* Próximos torneos: la razón para volver */}
            {scheduled.length > 0 && (
              <section className="space-y-3 pc-in" style={{ animationDelay: '260ms' }}>
                <SectionTitle>Próximamente</SectionTitle>
                {scheduled.map((s, i) => (
                  <div key={i} className="pc-card px-5 py-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-white font-bold truncate">{s.name}</p>
                      {s.scheduled_start && (
                        <p className="text-[#e8cd85] text-xs mt-1 capitalize font-bold tracking-wide">
                          {new Date(s.scheduled_start).toLocaleString('es-CO', { weekday: 'long', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 pc-display text-[#f7e9bd] font-bold text-sm whitespace-nowrap">
                      {s.buyin > 0 ? `$${Number(s.buyin).toLocaleString('es-CO')}` : 'FREE'}
                    </span>
                  </div>
                ))}
              </section>
            )}

            <footer className="text-center pt-6 pc-in" style={{ animationDelay: '320ms' }}>
              <div className="flex items-center justify-center gap-2 text-[#d9b45b55]">
                <span className="h-px w-16 bg-gradient-to-r from-transparent to-[#d9b45b44]" />
                <span className="text-xs">♠</span>
                <span className="h-px w-16 bg-gradient-to-l from-transparent to-[#d9b45b44]" />
              </div>
              <p className="text-[10px] text-[#9fb3a466] mt-3 tracking-wide">Se actualiza solo · impulsado por RakeFlow</p>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
