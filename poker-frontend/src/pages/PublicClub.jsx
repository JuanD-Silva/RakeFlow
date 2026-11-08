import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { publicService } from '../api/services';
import { FeltStyles, FeltSuits, SectionTitle, Pill } from '../components/PublicFelt';

// ---------------------------------------------------------------------------
// Página pública del club (/c/{token}) — la INVITACIÓN que el club comparte
// por WhatsApp. Dirección de diseño: "la mesa te espera" — fieltro de casino
// y oro, el nombre del CLUB como marquesina (RakeFlow va al pie), sillas como
// fichas de poker y un estado vacío que vende la noche en vez de disculparse.
// El tema (fieltro/oro/Cinzel) vive en components/PublicFelt.jsx, compartido
// con la ficha del torneo (/c/{token}/torneo/{id}).
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
      <FeltStyles />
      <FeltSuits />

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
                  La sala abre por la noche. Guarda este link: cuando haya mesa, aquí la ves primero.
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
                        <Link to={`/c/${token}/torneo/${t.id}`} className="block text-sm font-bold text-[#e8cd85] py-1">
                          📋 Ver blinds, precios y cupos
                        </Link>
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
                {scheduled.map((s, i) => {
                  const inner = (
                    <>
                      <div className="flex items-center justify-between gap-3">
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
                      {s.id != null && (
                        <p className="mt-3 text-sm font-bold text-[#e8cd85]">✍️ Ver el torneo e inscribirme →</p>
                      )}
                    </>
                  );
                  return s.id != null ? (
                    <Link key={s.id} to={`/c/${token}/torneo/${s.id}`}
                      className="pc-card px-5 py-4 block hover:border-[#d9b45b88] transition-colors">
                      {inner}
                    </Link>
                  ) : (
                    <div key={i} className="pc-card px-5 py-4">{inner}</div>
                  );
                })}
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
