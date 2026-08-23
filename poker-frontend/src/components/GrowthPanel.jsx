import { useEffect, useState } from 'react';
import {
  ArrowTrendingUpIcon, ArrowTrendingDownIcon, ArrowPathIcon, UserGroupIcon, DevicePhoneMobileIcon,
} from '@heroicons/react/24/outline';
import { reportsService } from '../api/services';
import { formatMoney } from '../utils/formatters';

// ---------------------------------------------------------
// Crecimiento = la ventana de BI del club: cómo va el MES de toda la
// operación (no solo la app). Cuatro preguntas del dueño, en orden:
//   1. ¿Cómo va el mes vs el anterior?   (pulso)
//   2. ¿Qué noches son oro y cuáles flojas?   (últimas 8 semanas)
//   3. ¿Llega gente nueva y vuelve?   (6 meses)
//   4. ¿La app del jugador está ayudando?   (compacto, honesto)
// Una sola llamada (/reports/bi), todo en fecha Colombia.
// ---------------------------------------------------------

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const mesCorto = (ym) => MESES[parseInt(ym.slice(5), 10) - 1] || ym;
const mesLargo = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
};

// Delta vs el mes anterior: chip con flecha; neutro si no hay base.
function Delta({ pct, invert = false }) {
  if (pct == null) return <span className="text-xs text-gray-500">sin base</span>;
  const bueno = invert ? pct <= 0 : pct >= 0;
  const Icon = pct >= 0 ? ArrowTrendingUpIcon : ArrowTrendingDownIcon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold tabular-nums ${pct === 0 ? 'text-gray-400' : bueno ? 'text-emerald-300' : 'text-red-300'}`}>
      <Icon className="w-3.5 h-3.5" /> {pct > 0 ? '+' : ''}{pct}%
    </span>
  );
}

function Pulso({ label, actual, previo, delta, fmt = (v) => v, invert = false, hero = false }) {
  return (
    <div className={`rounded-2xl border border-gray-700/60 bg-gray-800/60 p-4 ${hero ? 'col-span-2 sm:col-span-1' : ''}`}>
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`font-mono font-black tabular-nums text-white mt-1 leading-none ${hero ? 'text-3xl sm:text-4xl' : 'text-2xl'}`}>{fmt(actual)}</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
        <Delta pct={delta} invert={invert} />
        <span className="text-xs text-gray-500 tabular-nums whitespace-nowrap">antes {fmt(previo)}</span>
      </div>
    </div>
  );
}

// Barras horizontales de una sola serie: la forma correcta para "magnitud por
// categoría" (día de la semana). Marca fina, extremo redondeado, etiqueta al
// lado; el valor en texto, no en color (dataviz: el texto lleva tinta de texto).
function Barras({ items, labelOf, valueOf, fmt, subOf, max }) {
  const top = max || Math.max(1, ...items.map(valueOf));
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => {
        const v = valueOf(it);
        const esMax = v > 0 && v === top;
        return (
          <li key={i} className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-2" title={subOf ? subOf(it) : undefined}>
            <span className={`text-xs font-bold ${esMax ? 'text-white' : 'text-gray-400'}`}>{labelOf(it)}</span>
            <div className="h-2.5 rounded-full bg-gray-700/50 overflow-hidden">
              <div className={`h-full rounded-full ${esMax ? 'bg-emerald-400' : 'bg-emerald-600/70'}`} style={{ width: `${Math.max(v > 0 ? 3 : 0, (v / top) * 100)}%` }} />
            </div>
            <span className={`text-xs font-mono tabular-nums text-right ${esMax ? 'text-white font-bold' : 'text-gray-300'}`}>{fmt(v)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export default function GrowthPanel({ goToPlayers }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [fetched, setFetched] = useState(-1); // último reload resuelto
  const loading = fetched !== reload;

  useEffect(() => {
    let alive = true;
    reportsService.getBI()
      .then((d) => { if (alive) { setData(d); setError(false); } })
      .catch(() => { if (alive) setError(true); })
      .finally(() => { if (alive) setFetched(reload); });
    return () => { alive = false; };
  }, [reload]);

  if (loading && !data) return (
    <div className="flex flex-col items-center justify-center py-16 gap-3" role="status">
      <ArrowPathIcon className="w-8 h-8 text-emerald-500 animate-spin" />
      <p className="text-sm text-gray-400">Armando el mes…</p>
    </div>
  );
  if (error) return (
    <div className="text-center py-10 bg-red-900/10 rounded-2xl border border-red-500/20" role="alert">
      <p className="text-red-300 font-bold mb-1">No se pudo cargar el resumen del club.</p>
      <p className="text-gray-400 text-sm mb-4">Es un fallo de conexión, no que el mes esté en cero.</p>
      <button type="button" onClick={() => setReload((k) => k + 1)} className="min-h-11 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm uppercase tracking-wider">Reintentar</button>
    </div>
  );

  const { pulso, dias_semana, meses, app, comparacion } = data;
  const nochesOperadas = dias_semana.filter((d) => d.noches > 0);
  const mejor = nochesOperadas.length ? nochesOperadas.reduce((a, b) => (b.rake_prom > a.rake_prom ? b : a)) : null;
  const peor = nochesOperadas.length > 1 ? nochesOperadas.reduce((a, b) => (b.rake_prom < a.rake_prom ? b : a)) : null;
  const maxMes = Math.max(1, ...meses.map((m) => m.nuevos + m.recurrentes));
  const ultimo = meses[meses.length - 1];
  const ret = app.retencion;
  const faltan = Math.max(0, app.activos_30d - app.activos_30d_con_panel);
  const irAJugadores = (filtro) => goToPlayers?.(filtro);

  return (
    <div className="space-y-8 animate-fade-in">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Cómo va {mesLargo(data.mes)}</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Comparado con los mismos {comparacion.dias} días de {mesLargo(comparacion.mes_previo)} · mesas y torneos cerrados
          </p>
        </div>
        <button type="button" onClick={() => setReload((k) => k + 1)} aria-label="Actualizar" title="Actualizar"
          className="min-h-11 min-w-11 rounded-xl border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800 flex items-center justify-center">
          <ArrowPathIcon className={`w-5 h-5 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
        </button>
      </header>

      {/* 1. PULSO */}
      <section aria-labelledby="bi-pulso" className="space-y-3">
        <h3 id="bi-pulso" className="text-sm font-bold text-white">Pulso del mes</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <Pulso hero label="Rake neto" {...pulso.rake_neto} fmt={formatMoney} />
          <Pulso label="Noches operadas" {...pulso.noches} />
          <Pulso label="Jugadores distintos" {...pulso.jugadores} />
          <Pulso label="Rake neto por noche" {...pulso.rake_por_noche} fmt={formatMoney} />
          <Pulso label="Entrada promedio" {...pulso.ticket} fmt={formatMoney} />
        </div>
        {pulso.noches.actual === 0 && (
          <p className="text-sm text-gray-400">Todavía no hay mesas ni torneos cerrados este mes.</p>
        )}
      </section>

      {/* 2. NOCHES DE ORO */}
      <section aria-labelledby="bi-noches" className="space-y-3">
        <div>
          <h3 id="bi-noches" className="text-sm font-bold text-white">Qué noches son oro</h3>
          <p className="text-xs text-gray-400">Rake neto promedio por noche operada · últimas 8 semanas</p>
        </div>
        {nochesOperadas.length === 0 ? (
          <p className="text-sm text-gray-400">Sin noches cerradas en las últimas 8 semanas.</p>
        ) : (
          <div className="rounded-2xl border border-gray-700/60 bg-gray-800/60 p-4 space-y-3">
            <Barras
              items={dias_semana}
              labelOf={(d) => DIAS[d.weekday]}
              valueOf={(d) => d.rake_prom}
              fmt={(v) => (v > 0 ? formatMoney(v) : '—')}
              subOf={(d) => d.noches > 0 ? `${d.noches} noche${d.noches !== 1 ? 's' : ''} · ${d.jugadores_prom} jugadores en promedio` : 'Sin noches'}
            />
            {mejor && (
              <p className="text-xs text-gray-400 border-t border-gray-700/60 pt-3">
                <b className="text-white">{DIAS[mejor.weekday]}</b> es la noche fuerte ({mejor.jugadores_prom} jugadores en promedio)
                {peor && peor.weekday !== mejor.weekday && <>; <b className="text-white">{DIAS[peor.weekday]}</b> la floja ({peor.jugadores_prom}). Ahí es donde un reto o una invitación rinde más.</>}
              </p>
            )}
          </div>
        )}
      </section>

      {/* 3. JUGADORES: NUEVOS VS VUELVEN */}
      <section aria-labelledby="bi-jugadores" className="space-y-3">
        <div>
          <h3 id="bi-jugadores" className="text-sm font-bold text-white inline-flex items-center gap-1.5"><UserGroupIcon className="w-4 h-4 text-emerald-300" /> Llega gente nueva, ¿y vuelve?</h3>
          <p className="text-xs text-gray-400">Jugadores por mes: nuevos (primera vez en el club) y los que ya venían · últimos 6 meses</p>
        </div>
        <div className="rounded-2xl border border-gray-700/60 bg-gray-800/60 p-4">
          <div className="flex items-end gap-2 h-32" role="img" aria-label="Jugadores por mes, nuevos y recurrentes">
            {meses.map((m) => {
              const total = m.nuevos + m.recurrentes;
              const hN = (m.nuevos / maxMes) * 100, hR = (m.recurrentes / maxMes) * 100;
              return (
                <div key={m.month} className="flex-1 flex flex-col items-center justify-end h-full gap-1" title={`${mesLargo(m.month)}: ${m.recurrentes} que ya venían + ${m.nuevos} nuevos`}>
                  <span className="text-[11px] text-gray-300 font-mono tabular-nums leading-none">{total || ''}</span>
                  <div className="w-full flex flex-col justify-end gap-[2px]" style={{ height: '84px' }}>
                    <div className="w-full rounded-t bg-sky-400/80" style={{ height: `${hN * 0.84}px` }} />
                    <div className="w-full rounded-b bg-emerald-500/80" style={{ height: `${hR * 0.84}px` }} />
                  </div>
                  <span className="text-[11px] text-gray-400">{mesCorto(m.month)}</span>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-gray-400">
            <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-sky-400/80" /> Nuevos</span>
            <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-emerald-500/80" /> Ya venían</span>
          </div>
          {/* Tabla honesta: de los nuevos, cuántos volvieron en 30 días. n chico se dice como "2 de 5". */}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-gray-500 text-left">
                  <th className="font-bold py-1 pr-2">Mes</th>
                  <th className="font-bold py-1 pr-2 text-right">Nuevos</th>
                  <th className="font-bold py-1 pr-2 text-right">Ya venían</th>
                  <th className="font-bold py-1 text-right">Nuevos que volvieron en 30 días</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {meses.map((m) => (
                  <tr key={m.month} className="text-gray-300">
                    <td className="py-1.5 pr-2 capitalize">{mesCorto(m.month)}</td>
                    <td className="py-1.5 pr-2 text-right">{m.nuevos}</td>
                    <td className="py-1.5 pr-2 text-right">{m.recurrentes}</td>
                    <td className="py-1.5 text-right">
                      {m.nuevos === 0 ? '—'
                        : !m.maduro ? <span className="text-gray-500" title="Todavía no pasaron 30 días desde el fin del mes">{m.volvieron_30d} de {m.nuevos} · en curso</span>
                        : m.nuevos < 5 ? `${m.volvieron_30d} de ${m.nuevos}`
                        : <><b className="text-white">{m.volvieron_pct}%</b> <span className="text-gray-500">({m.volvieron_30d} de {m.nuevos})</span></>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ultimo && ultimo.nuevos + ultimo.recurrentes > 0 && (
            <p className="text-xs text-gray-400 mt-3 border-t border-gray-700/60 pt-3">
              Este mes, <b className="text-white">{Math.round(ultimo.recurrentes / (ultimo.nuevos + ultimo.recurrentes) * 100)}%</b> de los que jugaron ya venían antes.
            </p>
          )}
        </div>
      </section>

      {/* 4. APP DEL JUGADOR (compacto, honesto, accionable) */}
      <section aria-labelledby="bi-app" className="space-y-3">
        <div>
          <h3 id="bi-app" className="text-sm font-bold text-white inline-flex items-center gap-1.5"><DevicePhoneMobileIcon className="w-4 h-4 text-cyan-300" /> La app del jugador</h3>
          <p className="text-xs text-gray-400">¿Vuelven más los que la tienen? Y cuántos faltan por invitar.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-2xl border border-gray-700/60 bg-gray-800/60 p-4">
            <p className="text-xs text-gray-400 mb-2">De los que jugaron en {mesLargo(comparacion.mes_previo)}, volvieron este mes:</p>
            <div className="grid grid-cols-2 gap-3">
              {[['Con la app', ret.con_panel, 'text-cyan-300'], ['Sin la app', ret.sin_panel, 'text-gray-200']].map(([lbl, r, cls]) => (
                <div key={lbl} className="rounded-xl bg-gray-900/50 p-3">
                  <p className="text-xs text-gray-500">{lbl}</p>
                  <p className={`font-mono font-black text-2xl tabular-nums mt-1 ${cls}`}>
                    {r.cohorte === 0 ? '—' : r.cohorte < 5 ? `${r.volvieron} de ${r.cohorte}` : `${r.pct}%`}
                  </p>
                  {r.cohorte >= 5 && <p className="text-[11px] text-gray-500">{r.volvieron} de {r.cohorte}</p>}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-gray-700/60 bg-gray-800/60 p-4 flex flex-col">
            <ul className="space-y-1.5 text-sm flex-1">
              <li className="flex justify-between gap-2"><span className="text-gray-400">Jugaron en los últimos 30 días</span><b className="text-white tabular-nums">{app.activos_30d}</b></li>
              <li className="flex justify-between gap-2"><span className="text-gray-400">… y tienen la app activada</span><b className="text-cyan-300 tabular-nums">{app.activos_30d_con_panel}</b></li>
              <li className="flex justify-between gap-2"><span className="text-gray-400">La abrieron en los últimos 30 días</span><b className="text-white tabular-nums">{app.usan_30d}</b></li>
              <li className="flex justify-between gap-2"><span className="text-gray-400">Invitados sin activar</span><b className={`tabular-nums ${app.pendientes > 0 ? 'text-amber-300' : 'text-gray-300'}`}>{app.pendientes}</b></li>
            </ul>
            <div className="flex flex-wrap gap-2 mt-3">
              {faltan > 0 && (
                <button type="button" onClick={() => irAJugadores('none')} className="min-h-11 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold">
                  Invitar a los {faltan} que faltan →
                </button>
              )}
              {app.pendientes > 0 && (
                <button type="button" onClick={() => irAJugadores('pending')} className="min-h-11 px-3 rounded-xl border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 text-xs font-bold">
                  Ver los {app.pendientes} pendientes →
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <p className="text-xs text-gray-500 text-center border-t border-gray-800 pt-4">
        Fechas en hora Colombia. Cuenta solo mesas y torneos cerrados; una noche abierta entra al cerrarla.
      </p>
    </div>
  );
}
