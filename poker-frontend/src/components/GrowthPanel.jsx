import { useEffect, useState } from 'react';
import { ArrowTrendingUpIcon } from '@heroicons/react/24/solid';
import { reportsService } from '../api/services';

// ---------------------------------------------------------------------------
// Panel de Crecimiento (staff OWNER/MANAGER). Dos preguntas de negocio:
//   1) ADOPCIÓN (protagonista): ¿cuántos de mis jugadores que SÍ juegan usan el
//      panel? El número que importa es "activos con panel / activos" — ahí está
//      la fuga. Se lee HOY, sin esperar semanas.
//   2) RETENCIÓN D7/D30 (secundaria): ¿los que activaron vuelven? Sale del
//      endpoint /reports/retention (cohortes por semana). Mientras el panel sea
//      joven casi todo estará inmaduro (pct null) — es correcto, se llena solo.
// ---------------------------------------------------------------------------

const pct = (num, den) => (den > 0 ? Math.round((num / den) * 100) : 0);
const asPct = (p) => (p == null ? '—' : `${Math.round(p * 100)}%`);

// Barra proporcional del embudo (ancho relativo al universo del CRM).
function FunnelBar({ label, value, of, tone = 'emerald', hint }) {
  const width = of > 0 ? Math.max((value / of) * 100, value > 0 ? 4 : 0) : 0;
  const tones = {
    slate: 'bg-slate-600',
    sky: 'bg-sky-500',
    emerald: 'bg-emerald-500',
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-gray-200">{label}</span>
        <span className="text-sm font-black text-white tabular-nums">{value.toLocaleString('es-CO')}</span>
      </div>
      <div className="h-3 rounded-full bg-gray-800 overflow-hidden">
        <div className={`h-full rounded-full ${tones[tone]} transition-all`} style={{ width: `${width}%` }} />
      </div>
      {hint && <span className="text-[11px] text-gray-500 leading-tight">{hint}</span>}
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl px-4 py-3">
      <p className="text-2xl font-black text-white tabular-nums leading-none">{value}</p>
      <p className="text-xs font-semibold text-gray-300 mt-1">{label}</p>
      {sub && <p className="text-[11px] text-gray-500 mt-0.5 leading-tight">{sub}</p>}
    </div>
  );
}

export default function GrowthPanel() {
  const [data, setData] = useState(null);      // adopción
  const [ret, setRet] = useState(null);        // retención
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        // La retención puede fallar/estar vacía sin tumbar la adopción.
        const [adoption, retention] = await Promise.all([
          reportsService.getAdoption(),
          reportsService.getRetention().catch(() => null),
        ]);
        if (!alive) return;
        setData(adoption);
        setRet(retention);
      } catch {
        if (alive) setError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-6 text-center">
        <p className="text-red-300 text-sm font-medium">No pudimos cargar el panel de crecimiento. Recarga en un momento.</p>
      </div>
    );
  }

  // Métrica estrella: de los que juegan, cuántos usan el panel.
  const adoptionRate = pct(data.activos_30d_con_panel, data.activos_30d);
  const sinPanel = Math.max(data.activos_30d - data.activos_30d_con_panel, 0);
  const ov = ret?.overall;
  const cohorts = ret?.cohorts || [];
  const buckets = ret?.buckets || [];

  return (
    <div className="space-y-8">

      {/* Encabezado */}
      <div className="flex items-center gap-3">
        <div className="bg-emerald-900/40 border border-emerald-500/30 p-2 rounded-xl">
          <ArrowTrendingUpIcon className="w-6 h-6 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-2xl font-black text-white tracking-tight leading-none">Crecimiento</h2>
          <p className="text-xs text-gray-400 mt-1">Cuántos de tus jugadores usan el panel — y si vuelven.</p>
        </div>
      </div>

      {/* HERO: tasa de adopción */}
      <div className="bg-gradient-to-br from-emerald-950/60 to-gray-900 border border-emerald-500/20 rounded-2xl p-6">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-400/80">Adopción del panel</p>
        {data.activos_30d === 0 ? (
          // Sin base activa este mes: mostrar % adopción sería engañoso (0/0).
          <>
            <div className="flex flex-wrap items-end gap-x-4 gap-y-1 mt-2">
              <span className="text-4xl font-black text-white leading-none">Sin actividad este mes</span>
            </div>
            <p className="text-[13px] text-gray-400 mt-3 leading-snug">
              Ningún jugador jugó en los últimos 30 días, así que aún no hay adopción que medir.
              {data.crm_total > 0
                ? <> Tienes <b className="text-emerald-300">{data.crm_total}</b> jugadores en tu CRM: reactívalos desde <b>Jugadores</b>.</>
                : <> Registra jugadores en la mesa para empezar.</>}
            </p>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-x-4 gap-y-1 mt-2">
              <span className="text-6xl font-black text-white tabular-nums leading-none">{adoptionRate}%</span>
              <span className="text-sm text-gray-300 mb-1">
                de tus <b className="text-white">{data.activos_30d}</b> jugadores activos (últimos 30 días) usan el panel
              </span>
            </div>
            <p className="text-[13px] text-gray-400 mt-3 leading-snug">
              {sinPanel > 0
                ? <>Te faltan <b className="text-emerald-300">{sinPanel}</b> jugadores que ya vienen al club pero aún no están en el panel. Ese es tu terreno más fácil: invítalos desde la mesa o desde <b>Jugadores</b>.</>
                : <>Todos tus jugadores activos ya están en el panel. Ahora el foco es que vuelvan (mira la retención abajo).</>}
            </p>
          </>
        )}
      </div>

      {/* EMBUDO */}
      <div className="bg-gray-900/40 border border-gray-800 rounded-2xl p-5 space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300">El embudo, del club al panel</h3>
        <div className="space-y-4">
          <FunnelBar label="En tu CRM (todos)" value={data.crm_total} of={data.crm_total} tone="slate"
            hint="Todos los jugadores que has registrado alguna vez." />
          <FunnelBar label="Activos (jugaron últimos 30 días)" value={data.activos_30d} of={data.crm_total} tone="sky"
            hint="Tu base real: los que de verdad vienen." />
          <FunnelBar label="Activos que usan el panel" value={data.activos_30d_con_panel} of={data.crm_total} tone="emerald"
            hint={`${adoptionRate}% de los activos. Esta es la conversión que quieres subir.`} />
        </div>
      </div>

      {/* Uso del panel */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300">Uso del panel</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Con cuenta" value={data.con_panel} sub="Jugadores con panel activado" />
          <Stat label="Lo han abierto" value={data.panel_abrieron} sub="Entraron al menos una vez" />
          <Stat label="Activos 7 días" value={data.panel_activos_7d} sub="Abrieron esta semana" />
          <Stat label="Activos 30 días" value={data.panel_activos_30d} sub="Abrieron este mes" />
        </div>
      </div>

      {/* RETENCIÓN D7/D30 (secundaria) */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300">Retención — ¿vuelven?</h3>
        {!ov || ov.activated === 0 ? (
          <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl px-4 py-6 text-center">
            <p className="text-sm text-gray-400">Aún no hay suficiente historia para medir retención.</p>
            <p className="text-xs text-gray-500 mt-1">Se va llenando sola conforme más jugadores usen el panel a lo largo de las semanas.</p>
          </div>
        ) : (
          <>
            {/* Resumen general por ventana */}
            <div className="grid grid-cols-3 gap-3">
              {buckets.map((b) => {
                const r = ov.retention[b.key] || {};
                return (
                  <div key={b.key} className="bg-gray-800/40 border border-gray-700/50 rounded-xl px-4 py-3">
                    <p className="text-2xl font-black text-white tabular-nums leading-none">{asPct(r.pct)}</p>
                    <p className="text-xs font-semibold text-gray-300 mt-1">{b.label}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {r.mature ? `${r.retained}/${r.mature} volvieron` : 'aún inmaduro'}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Cohortes por semana de activación */}
            {cohorts.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[420px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-800">
                      <th className="py-2 pr-3 font-semibold">Semana</th>
                      <th className="py-2 px-3 font-semibold text-right">Activaron</th>
                      {buckets.map((b) => (
                        <th key={b.key} className="py-2 px-3 font-semibold text-right">{b.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cohorts.map((c) => (
                      <tr key={c.week_start} className="border-b border-gray-800/50">
                        <td className="py-2 pr-3 text-gray-300 tabular-nums">{c.week_start}</td>
                        <td className="py-2 px-3 text-right text-white font-semibold tabular-nums">{c.activated}</td>
                        {buckets.map((b) => (
                          <td key={b.key} className="py-2 px-3 text-right text-gray-300 tabular-nums">
                            {asPct(c.retention?.[b.key]?.pct)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      <p className="text-[11px] text-gray-600 text-center pt-2">
        Datos de este club. Se actualizan en cada carga.
      </p>
    </div>
  );
}
