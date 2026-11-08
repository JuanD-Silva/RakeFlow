import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { publicService } from '../api/services';
import { FeltStyles, FeltSuits, SectionTitle, Pill } from '../components/PublicFelt';

// ---------------------------------------------------------------------------
// Ficha pública del torneo + pre-inscripción (/c/{token}/torneo/{id}).
// El link que el club manda por WhatsApp para llenar el torneo: arriba lo que
// el jugador necesita para decidir (cuándo, cuánto, cuántas fichas, cuántos
// cupos quedan), abajo el formulario de dos campos, y al final la estructura
// completa de blinds para el que quiere ver todo.
// La inscripción por link RESERVA el lugar; se confirma y se paga en caja.
// Nunca muestra rake, premiación ni nombres de otros inscritos.
// ---------------------------------------------------------------------------

const storageKey = (token, id) => `rf_prereg_${token}_${id}`;

function readSaved(token, id) {
  try {
    const raw = window.localStorage.getItem(storageKey(token, id));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveResult(token, id, value) {
  try { window.localStorage.setItem(storageKey(token, id), JSON.stringify(value)); } catch { /* modo privado */ }
}

// Fila de dato clave: etiqueta a la izquierda, valor grande a la derecha.
const Fact = ({ label, value, note }) => (
  <div className="flex items-baseline justify-between gap-3 py-2.5 border-b border-[#d9b45b1f] last:border-0">
    <div className="min-w-0">
      <p className="text-[#f4efe4] text-sm font-bold">{label}</p>
      {note && <p className="text-[#9fb3a4] text-xs mt-0.5">{note}</p>}
    </div>
    <p className="pc-display shrink-0 text-[#f7e9bd] font-bold text-base text-right tabular-nums">{value}</p>
  </div>
);

function useFormatters(locale = 'es-CO', currency = 'COP') {
  return useMemo(() => {
    let money;
    try {
      const nf = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 });
      money = (n) => nf.format(Number(n) || 0);
    } catch {
      money = (n) => `$${Number(n || 0).toLocaleString('es-CO')}`;
    }
    const chips = (n) => Number(n || 0).toLocaleString(locale);
    // scheduled_start es hora de pared del club SIN offset: new Date() la toma
    // como local y se muestra tal cual (misma convención que /c/{token}).
    const when = (iso) => {
      if (!iso) return null;
      const s = new Date(iso).toLocaleString(locale, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
      return s.charAt(0).toUpperCase() + s.slice(1); // solo la primera letra ("Viernes, 13 de noviembre")
    };
    return { money, chips, when };
  }, [locale, currency]);
}

function blindsSummary(levels) {
  const play = levels.filter((l) => !l.is_break);
  if (play.length === 0) return null;
  const mins = [...new Set(play.map((l) => l.duration_min))];
  const breaks = levels.length - play.length;
  return `${play.length} niveles${mins.length === 1 ? ` de ${mins[0]} min` : ''}${breaks ? ` · ${breaks} descanso${breaks !== 1 ? 's' : ''}` : ''}`;
}

function BlindTable({ levels, chips }) {
  // Mismo número que muestran el reloj y la TV (posición en la estructura, los
  // descansos cuentan): así "recompra hasta el nivel N" coincide con la tabla.
  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-[#d9b45b33]">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-black/30 text-[10px] uppercase tracking-widest text-[#e8cd85]">
            <th scope="col" className="text-left font-bold px-3 py-2">Nivel</th>
            <th scope="col" className="text-right font-bold px-3 py-2">Ciegas</th>
            <th scope="col" className="text-right font-bold px-3 py-2">Ante</th>
            <th scope="col" className="text-right font-bold px-3 py-2">Min</th>
          </tr>
        </thead>
        <tbody>
          {levels.map((l, i) => {
            if (l.is_break) {
              return (
                <tr key={i} className="bg-[#d9b45b14]">
                  <td colSpan={3} className="px-3 py-1.5 text-[#e8cd85] font-bold text-xs uppercase tracking-widest">☕ Descanso</td>
                  <td className="px-3 py-1.5 text-right text-[#e8cd85] tabular-nums">{l.duration_min}</td>
                </tr>
              );
            }
            return (
              <tr key={i} className="odd:bg-black/10 text-[#f4efe4]">
                <td className="px-3 py-1.5 text-[#9fb3a4] tabular-nums">{l.level ?? i + 1}</td>
                <td className="px-3 py-1.5 text-right font-bold tabular-nums">{chips(l.small_blind)} / {chips(l.big_blind)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-[#9fb3a4]">{l.ante ? chips(l.ante) : '—'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-[#9fb3a4]">{l.duration_min}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ResultCard({ result, money, buyin, onReset }) {
  if (result.spot === 'ENTERED') {
    return (
      <div className="pc-card px-5 py-5 text-center" role="status" style={{ borderColor: '#34d39966' }}>
        <p className="text-3xl" aria-hidden>✅</p>
        <p className="pc-display text-[#f7e9bd] font-bold text-lg mt-2">Ya estás inscrito</p>
        <p className="text-sm text-[#9fb3a4] mt-1">El club ya te tiene en el torneo. ¡Nos vemos en la mesa!</p>
      </div>
    );
  }
  const waiting = result.spot === 'WAITLIST';
  return (
    <div className="pc-card px-5 py-5 text-center" role="status" style={{ borderColor: waiting ? '#d9b45b77' : '#34d39966' }}>
      <p className="text-3xl" aria-hidden>{waiting ? '⏳' : '🎟️'}</p>
      <p className="pc-display text-[#f7e9bd] font-bold text-lg mt-2">
        {waiting ? `Estás en lista de espera · #${result.waitlist_position}` : 'Tu lugar está reservado'}
      </p>
      <p className="text-sm text-[#f4efe4] mt-2">{result.name ? `${result.name}, ` : ''}{waiting
        ? 'el cupo está lleno. Si alguien se baja, subes en la lista. Llega temprano por si se libera un lugar.'
        : `confirma tu entrada en caja al llegar${buyin > 0 ? ` y paga ${money(buyin)}` : ''}.`}
      </p>
      <button type="button" onClick={onReset} className="mt-4 text-xs font-bold text-[#9fb3a4] underline underline-offset-4">
        Inscribir a otra persona
      </button>
    </div>
  );
}

export default function PublicTournament() {
  const { token, id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showBlinds, setShowBlinds] = useState(false);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState('');
  const [result, setResult] = useState(() => readSaved(token, id));

  const load = useCallback(async () => {
    try {
      setData(await publicService.getPublicTournament(token, id));
      setError(false);
    } catch {
      // Si ya teníamos la ficha, un fallo de red NO la borra (resiliencia de polling).
      setError(true);
    } finally { setLoading(false); }
  }, [token, id]);

  useEffect(() => {
    const t0 = setTimeout(load, 0);
    const iv = setInterval(load, 30000); // el contador de cupos se mueve
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearTimeout(t0); clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  const t = data?.tournament;
  const occ = data?.occupancy;
  const { money, chips, when } = useFormatters(data?.locale, data?.currency);

  useEffect(() => {
    if (t?.name && data?.club_name) document.title = `${t.name} · ${data.club_name}`;
  }, [t?.name, data?.club_name]);

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (name.trim().length < 2) { setFormError('Escribe tu nombre.'); return; }
    if (phone.replace(/\D/g, '').length < 10) { setFormError('Escribe tu celular completo (10 dígitos).'); return; }
    setSending(true);
    try {
      const res = await publicService.preregister(token, id, { name: name.trim(), phone });
      const saved = { name: res.name || name.trim(), spot: res.spot, waitlist_position: res.waitlist_position ?? null };
      setResult(saved);
      saveResult(token, id, saved);
      if (res.occupancy) setData((prev) => (prev ? { ...prev, occupancy: res.occupancy } : prev));
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data?.detail;
      setFormError(
        status === 429 ? 'Demasiados intentos. Espera un rato e inténtalo de nuevo.'
        : typeof detail === 'string' ? detail
        : 'No se pudo enviar. Revisa tu conexión e inténtalo de nuevo.'
      );
    } finally { setSending(false); }
  };

  const resetForm = () => {
    setResult(null); setName(''); setPhone('');
    try { window.localStorage.removeItem(storageKey(token, id)); } catch { /* nada */ }
  };

  const levels = t?.blind_structure || [];
  const playLevels = levels.filter((l) => !l.is_break);
  const firstLevel = playLevels[0];
  const seatsLeft = occ?.max_entries != null ? Math.max(occ.max_entries - occ.taken, 0) : null;

  return (
    <div className="pc-root min-h-screen text-[#f4efe4] font-sans px-4 py-10 relative overflow-hidden">
      <FeltStyles />
      <FeltSuits />

      <div className="max-w-md mx-auto space-y-6 relative">
        {loading && (
          <div className="min-h-[70vh] flex items-center justify-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#d9b45b]" />
          </div>
        )}

        {!loading && !data && (
          <div className="min-h-[70vh] flex flex-col items-center justify-center text-center">
            <p className="pc-display text-5xl text-[#d9b45b] mb-4">♠</p>
            <p className="pc-display font-bold text-white text-lg tracking-wide">Torneo no disponible</p>
            <p className="text-sm mt-1 text-[#9fb3a4]">Ya terminó o el link no es válido.</p>
            <Link to={`/c/${token}`} className="mt-5 text-sm font-bold text-[#e8cd85] underline underline-offset-4">Ver el club</Link>
          </div>
        )}

        {!loading && data && t && (
          <>
            {/* Marquesina */}
            <header className="text-center pc-in">
              <Link to={`/c/${token}`} className="inline-flex items-center gap-2 text-[#d9b45b] hover:text-[#e8cd85]">
                <span className="h-px w-8 bg-gradient-to-r from-transparent to-[#d9b45b88]" />
                <span className="text-[10px] font-bold tracking-[0.35em] uppercase">♦ {data.club_name} ♦</span>
                <span className="h-px w-8 bg-gradient-to-l from-transparent to-[#d9b45b88]" />
              </Link>
              <h1 className="pc-display pc-title text-4xl font-black mt-3 leading-tight uppercase tracking-wide break-words">
                {t.name}
              </h1>
              {t.scheduled_start && (
                <p className="mt-3 text-[#e8cd85] font-bold tracking-wide">{when(t.scheduled_start)}</p>
              )}
              {t.status !== 'SCHEDULED' && (
                <p className="inline-flex items-center gap-2 mt-3 text-emerald-200 text-xs font-bold uppercase tracking-widest bg-emerald-500/10 ring-1 ring-emerald-500/40 rounded-full px-3.5 py-1.5">
                  <span className="pc-pulse relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                  {t.status === 'RUNNING' ? 'En juego' : 'Inscripciones abiertas en el club'}
                </p>
              )}
            </header>

            {/* Entrada + cupos: lo que decide si vas */}
            <section className="pc-card px-5 py-5 pc-in" style={{ animationDelay: '60ms', borderColor: '#d9b45b77' }}>
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="pc-display text-[10px] text-[#d9b45b] font-bold uppercase tracking-[0.3em]">Entrada</p>
                  <p className="pc-display text-4xl font-black text-[#f7e9bd] leading-none mt-2 tabular-nums">
                    {t.buyin > 0 ? money(t.buyin) : 'FREE'}
                  </p>
                  {t.starting_stack > 0 && (
                    <p className="text-sm text-[#9fb3a4] mt-2">{chips(t.starting_stack)} fichas iniciales</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  {occ?.max_entries != null ? (
                    <>
                      <p className="pc-display text-2xl font-black text-[#f7e9bd] leading-none tabular-nums">
                        {occ.taken}<span className="text-[#9fb3a4] text-base">/{occ.max_entries}</span>
                      </p>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#9fb3a4] mt-1.5">cupos</p>
                    </>
                  ) : (
                    occ?.taken > 0 && (
                      <>
                        <p className="pc-display text-2xl font-black text-[#f7e9bd] leading-none tabular-nums">{occ.taken}</p>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[#9fb3a4] mt-1.5">inscritos</p>
                      </>
                    )
                  )}
                </div>
              </div>
              {occ?.max_entries != null && (
                <div className="mt-4">
                  <div className="h-2 rounded-full bg-black/40 overflow-hidden" aria-hidden>
                    <div className="h-full rounded-full bg-gradient-to-r from-[#a8842e] to-[#e8cd85]"
                      style={{ width: `${Math.min(100, (occ.taken / occ.max_entries) * 100)}%` }} />
                  </div>
                  <p className="text-xs mt-2 font-bold text-right">
                    {occ.full
                      ? <span className="text-[#e8a29a]">Cupo lleno{occ.waitlist > 0 ? ` · ${occ.waitlist} en espera` : ''}</span>
                      : <span className="text-emerald-300">{seatsLeft === 1 ? 'Queda 1 cupo' : `Quedan ${seatsLeft} cupos`}</span>}
                  </p>
                </div>
              )}
            </section>

            {/* Formulario / resultado */}
            <section className="pc-in" style={{ animationDelay: '120ms' }} aria-live="polite">
              {result ? (
                <ResultCard result={result} money={money} buyin={t.buyin} onReset={resetForm} />
              ) : t.registration_open ? (
                <form onSubmit={submit} className="pc-card px-5 py-5 space-y-3" noValidate>
                  <div className="flex items-center justify-between gap-2">
                    <p className="pc-display text-[#f7e9bd] font-bold text-lg">Inscríbete</p>
                    {occ?.full && <Pill tone="full">Lista de espera</Pill>}
                  </div>
                  <div>
                    <label htmlFor="pt-name" className="block text-xs font-bold text-[#e8cd85] mb-1">Nombre</label>
                    <input id="pt-name" type="text" value={name} onChange={(e) => setName(e.target.value)}
                      autoComplete="name" maxLength={80} required
                      className="w-full rounded-lg bg-black/30 border border-[#d9b45b40] px-3 py-3 text-base text-[#f4efe4] placeholder-[#9fb3a499] focus:outline-none focus:border-[#d9b45b]"
                      placeholder="Como te conocen en la mesa" />
                  </div>
                  <div>
                    <label htmlFor="pt-phone" className="block text-xs font-bold text-[#e8cd85] mb-1">Celular</label>
                    <input id="pt-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                      autoComplete="tel" maxLength={20} required
                      className="w-full rounded-lg bg-black/30 border border-[#d9b45b40] px-3 py-3 text-base text-[#f4efe4] placeholder-[#9fb3a499] focus:outline-none focus:border-[#d9b45b]"
                      placeholder="300 123 4567" />
                  </div>
                  {formError && <p className="text-sm text-[#e8a29a] font-bold" role="alert">{formError}</p>}
                  <button type="submit" disabled={sending}
                    className="w-full bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 disabled:opacity-60 text-white font-black uppercase tracking-wide rounded-xl px-5 py-3.5 shadow-lg shadow-emerald-900/40 ring-1 ring-emerald-300/30">
                    {sending ? 'Enviando…' : occ?.full ? 'Anotarme en la lista de espera' : 'Reservar mi lugar'}
                  </button>
                  <p className="text-xs text-[#9fb3a4] text-center leading-relaxed">
                    No pagas nada ahora: confirmas y pagas en caja al llegar.
                  </p>
                </form>
              ) : (
                <div className="pc-card px-5 py-4 text-center">
                  <p className="text-[#f7e9bd] font-bold">La inscripción por link ya cerró</p>
                  <p className="text-sm text-[#9fb3a4] mt-1">Acércate a la caja del club para inscribirte.</p>
                </div>
              )}
            </section>

            {/* Especificaciones */}
            <section className="space-y-3 pc-in" style={{ animationDelay: '180ms' }}>
              <SectionTitle>El torneo</SectionTitle>
              <div className="pc-card px-5 py-2">
                {t.starting_stack > 0 && <Fact label="Stack inicial" value={chips(t.starting_stack)} note="fichas" />}
                {firstLevel && (
                  <Fact label="Ciegas iniciales" value={`${chips(firstLevel.small_blind)} / ${chips(firstLevel.big_blind)}`}
                    note={blindsSummary(levels)} />
                )}
                {t.rebuy_price > 0 && (
                  <Fact label="Recompra" value={money(t.rebuy_price)}
                    note={[t.rebuy_chips > 0 && `+${chips(t.rebuy_chips)} fichas`,
                      t.rebuy_until_level ? `hasta el nivel ${t.rebuy_until_level}` : 'sin límite de nivel'].filter(Boolean).join(' · ')} />
                )}
                {t.double_rebuy_price > 0 && (
                  <Fact label="Recompra doble" value={money(t.double_rebuy_price)}
                    note={t.double_rebuy_chips > 0 ? `+${chips(t.double_rebuy_chips)} fichas` : null} />
                )}
                {t.addon_price > 0 && (
                  <Fact label="Add-on" value={money(t.addon_price)}
                    note={[t.addon_chips > 0 && `+${chips(t.addon_chips)} fichas`,
                      t.addon_until_level ? `hasta el nivel ${t.addon_until_level}` : null].filter(Boolean).join(' · ') || null} />
                )}
                {t.double_addon_price > 0 && (
                  <Fact label="Add-on doble" value={money(t.double_addon_price)}
                    note={t.double_addon_chips > 0 ? `+${chips(t.double_addon_chips)} fichas` : null} />
                )}
                {t.dealer_tip > 0 && (
                  <Fact label="Propina para dealers" value={money(t.dealer_tip)}
                    note={t.tip_chips > 0 ? `opcional · te da +${chips(t.tip_chips)} fichas` : 'opcional'} />
                )}
                {t.bounty > 0 && <Fact label="Bounty" value={money(t.bounty)} note="por cada jugador que elimines" />}
                {t.rebuy_price <= 0 && t.addon_price <= 0 && (
                  <Fact label="Recompras" value="No" note="freezeout: una sola entrada" />
                )}
              </div>
            </section>

            {/* Estructura de blinds completa */}
            {playLevels.length > 0 && (
              <section className="space-y-3 pc-in" style={{ animationDelay: '220ms' }}>
                <SectionTitle>Estructura de blinds</SectionTitle>
                {showBlinds && <BlindTable levels={levels} chips={chips} />}
                <button type="button" onClick={() => setShowBlinds((v) => !v)} aria-expanded={showBlinds}
                  className="w-full text-sm font-bold text-[#e8cd85] py-2">
                  {showBlinds ? 'Ocultar la estructura' : `Ver los ${playLevels.length} niveles`}
                </button>
              </section>
            )}

            {error && <p className="text-xs text-center text-[#e8a29a]">Sin conexión · mostrando la última información.</p>}

            <footer className="text-center pt-4">
              <Link to={`/c/${token}`} className="text-sm font-bold text-[#e8cd85] underline underline-offset-4">
                Ver mesas y torneos del club
              </Link>
              <p className="text-[10px] text-[#9fb3a466] mt-4 tracking-wide">impulsado por RakeFlow</p>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
