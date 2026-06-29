import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { publicService } from '../api/services';

function elapsed(startIso) {
  if (!startIso) return '';
  const mins = Math.max(0, Math.floor((Date.now() - new Date(startIso).getTime()) / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const Badge = ({ children, tone = 'emerald' }) => (
  <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap ring-1 ${
    tone === 'emerald' ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' : 'bg-amber-500/15 text-amber-300 ring-amber-500/30'
  }`}>{children}</span>
);

export default function PublicClub() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => { if (data?.club_name) document.title = `${data.club_name} · Actividad en vivo`; }, [data]);

  if (loading) return (
    <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-500" />
    </div>
  );
  if (error || !data) return (
    <div className="min-h-screen bg-[#0a0f1a] text-gray-400 flex flex-col items-center justify-center px-6 text-center">
      <p className="text-5xl mb-4">🔍</p>
      <p className="font-bold text-white">Club no encontrado</p>
      <p className="text-sm mt-1">El link no es válido o expiró.</p>
    </div>
  );

  const cash = data.cash || [];
  const tournaments = data.tournaments || [];
  const scheduled = data.scheduled || [];
  const empty = cash.length === 0 && tournaments.length === 0 && scheduled.length === 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0b1220] via-[#0a0f1a] to-black text-gray-100 font-sans px-4 py-8">
      <div className="max-w-md mx-auto space-y-6">
        {/* Header */}
        <div className="text-center">
          <p className="text-emerald-500 text-xs font-black tracking-[0.3em] uppercase">RakeFlow</p>
          <h1 className="text-3xl font-black text-white mt-1 leading-tight">{data.club_name}</h1>
          <p className="inline-flex items-center gap-1.5 text-gray-400 text-sm mt-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            Actividad en vivo
          </p>
        </div>

        {/* Anuncio */}
        {data.announcement && (
          <div className="bg-amber-900/20 border border-amber-600/40 rounded-xl px-4 py-3 flex items-center gap-2">
            <span className="text-lg">📢</span>
            <p className="text-amber-200 text-sm font-bold">{data.announcement}</p>
          </div>
        )}

        {empty && (
          <div className="py-16 text-center text-gray-500">
            <p className="text-4xl mb-3">🌙</p>
            <p className="font-bold uppercase tracking-widest text-xs">No hay actividad ahora</p>
            <p className="text-[11px] mt-1 text-gray-600">Volvé más tarde para ver mesas y torneos.</p>
          </div>
        )}

        {/* Mesas cash */}
        {cash.length > 0 && (
          <section className="space-y-2">
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Mesas de Cash</p>
            {cash.map((c, i) => {
              const seats = c.seats_available;
              return (
                <div key={i} className="bg-gray-800/60 border border-gray-700/60 rounded-xl px-4 py-3 hover:border-gray-600 transition-colors">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-white font-bold truncate flex items-center gap-2">♠️ {c.name}</p>
                      <p className="text-gray-400 text-xs mt-0.5">
                        {c.players_count} jugando
                        {c.max_players ? ` · mesa de ${c.max_players}` : ''} · {elapsed(c.start_time)} en juego
                      </p>
                    </div>
                    {seats != null
                      ? <Badge tone={seats > 0 ? 'emerald' : 'amber'}>{seats > 0 ? `${seats} cupo${seats !== 1 ? 's' : ''}` : 'Llena'}</Badge>
                      : <Badge>{c.status}</Badge>}
                  </div>
                  {c.max_players && (
                    <div className="mt-2 h-1.5 rounded-full bg-gray-700/70 overflow-hidden flex gap-0.5">
                      {Array.from({ length: c.max_players }).map((_, s) => (
                        <div key={s} className={`flex-1 rounded-full ${s < c.players_count ? 'bg-emerald-500' : 'bg-gray-600/40'}`} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {/* Torneos */}
        {tournaments.length > 0 && (
          <section className="space-y-2">
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Torneos</p>
            {tournaments.map((t, i) => (
              <div key={i} className="bg-gray-800/60 border border-gray-700/60 rounded-xl px-4 py-3 flex items-center justify-between gap-3 hover:border-gray-600 transition-colors">
                <div className="min-w-0">
                  <p className="text-white font-bold truncate flex items-center gap-2">🏆 {t.name}</p>
                  <p className="text-gray-400 text-xs mt-0.5">
                    {t.active > 0 ? `${t.active} jugando` : `${t.registered} inscrito${t.registered !== 1 ? 's' : ''}`}
                  </p>
                </div>
                <Badge tone={t.status === 'En juego' ? 'emerald' : 'amber'}>{t.status}</Badge>
              </div>
            ))}
          </section>
        )}

        {/* Programados (placeholder hasta T4) */}
        {scheduled.length > 0 && (
          <section className="space-y-2">
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Programados</p>
            {scheduled.map((s, i) => (
              <div key={i} className="bg-gray-800/40 border border-gray-700/50 rounded-xl px-4 py-3">
                <p className="text-white font-bold">📅 {s.name}</p>
              </div>
            ))}
          </section>
        )}

        <p className="text-center text-[10px] text-gray-600 pt-4">Actualizado automáticamente · RakeFlow</p>
      </div>
    </div>
  );
}
