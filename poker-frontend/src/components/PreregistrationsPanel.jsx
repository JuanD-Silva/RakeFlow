import { useCallback, useEffect, useState } from 'react';
import { tournamentService } from '../api/services';
import { formatMoney, fmtTime } from '../utils/formatters';
import ConfirmModal from './ConfirmModal';

// ---------------------------------------------------------------------------
// Pre-inscritos del link público (/c/{token}/torneo/{id}) — lado staff.
// Arriba: link para mandar por WhatsApp + cupo. Abajo: quién reservó, en
// orden de llegada (en cupo primero, después la lista de espera).
// "Confirmar" = el jugador llegó: lo inscribe de verdad (cobra buy-in/tip con
// la misma lógica que Inscribir) y crea la ficha si no existía.
// Con el torneo PROGRAMADO solo se puede ver/cancelar: se confirma al abrirlo.
// ---------------------------------------------------------------------------

export default function PreregistrationsPanel({ tournament, canConfirm = false, onConfirmed, showToast, compact = false }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [opts, setOpts] = useState({ payBuyin: true, payTip: false });
  const [cupoDraft, setCupoDraft] = useState(null); // null = no editando
  const [savingCupo, setSavingCupo] = useState(false);
  const [toCancel, setToCancel] = useState(null);
  const [copied, setCopied] = useState(false);

  const notify = useCallback((msg, type = 'success') => {
    if (showToast) showToast(msg, type); else if (type === 'error') window.alert(msg);
  }, [showToast]);

  const load = useCallback(async () => {
    try {
      setData(await tournamentService.getPreregistrations(tournament.id));
      setLoadError(false);
    } catch (e) {
      console.error(e);
      setLoadError(true); // conserva la última lista buena
    }
  }, [tournament.id]);

  useEffect(() => {
    const t0 = setTimeout(load, 0);
    const iv = setInterval(load, 20000); // llegan reservas mientras el staff trabaja
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearTimeout(t0); clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  const token = data?.public_token_club;
  const link = token ? `${window.location.origin}/c/${token}/torneo/${tournament.id}` : null;
  const occ = data?.occupancy;
  const rows = data?.preregistrations || [];
  const buyin = Number(tournament.buyin_amount) || 0;
  const tip = Number(tournament.dealer_tip_amount) || 0;

  const whenText = tournament.scheduled_start
    ? new Date(tournament.scheduled_start).toLocaleString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
    : null;
  const shareText = link
    ? `🃏 ${tournament.name}${whenText ? ` · ${whenText}` : ''}${buyin > 0 ? ` · Entrada ${formatMoney(buyin)}` : ''}\nMira blinds, precios y cupos, y reserva tu lugar aquí: ${link}`
    : '';

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true); setTimeout(() => setCopied(false), 1800);
    } catch { window.prompt('Copia el link:', link); }
  };

  const confirm = async (p) => {
    setBusyId(p.id);
    try {
      await tournamentService.confirmPreregistration(tournament.id, p.id, { pay_buyin: opts.payBuyin, pay_tip: opts.payTip });
      notify(`${p.name} inscrito`);
      await load();
      onConfirmed?.();
    } catch (e) {
      notify(e.response?.data?.detail || 'No se pudo confirmar', 'error');
      await load();
    } finally { setBusyId(null); }
  };

  const cancel = async () => {
    const p = toCancel;
    if (!p) return;
    setBusyId(p.id);
    try {
      await tournamentService.cancelPreregistration(tournament.id, p.id);
      notify('Reserva cancelada');
      setToCancel(null);
      await load();
    } catch (e) {
      notify(e.response?.data?.detail || 'No se pudo cancelar', 'error');
    } finally { setBusyId(null); }
  };

  const saveCupo = async () => {
    const raw = String(cupoDraft ?? '').trim();
    const value = raw === '' ? null : Number(raw);
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > 1000)) {
      notify('El cupo debe ser un número entre 1 y 1000 (o vacío para sin límite)', 'error');
      return;
    }
    setSavingCupo(true);
    try {
      await tournamentService.setMaxEntries(tournament.id, value);
      setCupoDraft(null);
      await load();
      onConfirmed?.();
    } catch (e) {
      notify(e.response?.data?.detail || 'No se pudo guardar el cupo', 'error');
    } finally { setSavingCupo(false); }
  };

  if (!data) {
    return (
      <div className="bg-gray-800/40 border border-gray-700 rounded-xl p-4 text-sm text-gray-500">
        {loadError ? 'No se pudieron cargar las reservas del link.' : 'Cargando reservas…'}
      </div>
    );
  }

  const inCupo = rows.filter((r) => r.spot === 'CUPO');
  const waiting = rows.filter((r) => r.spot === 'WAITLIST');

  return (
    <div className={`bg-gray-800/40 border border-violet-500/25 rounded-xl ${compact ? 'p-3' : 'p-4'} space-y-4`}>
      {/* Encabezado: contador + cupo */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-white font-bold text-sm">🎟️ Reservas por link</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {occ.max_entries != null
              ? <>{occ.taken} / {occ.max_entries} cupos{occ.waitlist > 0 && <span className="text-amber-300"> · {occ.waitlist} en espera</span>}</>
              : <>{occ.entered} inscritos · {occ.preregistered} por confirmar · sin cupo máximo</>}
          </p>
        </div>
        {cupoDraft === null ? (
          <button type="button" onClick={() => setCupoDraft(occ.max_entries ?? '')}
            className="text-xs font-bold px-3 py-1.5 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-700/50">
            {occ.max_entries != null ? `Cupo: ${occ.max_entries}` : 'Poner cupo'}
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <label htmlFor={`cupo-${tournament.id}`} className="sr-only">Cupo máximo</label>
            <input id={`cupo-${tournament.id}`} type="number" inputMode="numeric" min="1" max="1000" autoFocus
              value={cupoDraft} onChange={(e) => setCupoDraft(e.target.value)} placeholder="Sin límite"
              onKeyDown={(e) => { if (e.key === 'Enter') saveCupo(); if (e.key === 'Escape') setCupoDraft(null); }}
              className="w-24 bg-gray-900 border border-gray-600 rounded-lg px-2 py-1.5 text-base text-white focus:border-violet-500 outline-none" />
            <button type="button" onClick={saveCupo} disabled={savingCupo}
              className="text-xs font-bold px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50">Guardar</button>
            <button type="button" onClick={() => setCupoDraft(null)}
              className="text-xs font-bold px-2 py-2 rounded-lg text-gray-400 hover:text-white">Cancelar</button>
          </div>
        )}
      </div>

      {/* Link para compartir */}
      {link ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer"
              className="flex-1 text-center text-sm font-bold px-3 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white">
              Compartir por WhatsApp
            </a>
            <button type="button" onClick={copyLink}
              className="text-sm font-bold px-3 py-2.5 rounded-lg border border-gray-600 text-gray-200 hover:bg-gray-700/50 min-w-[96px]">
              {copied ? '¡Copiado!' : 'Copiar link'}
            </button>
          </div>
          {!data.registration_open && (
            <p className="text-[11px] text-amber-300/90">El torneo ya arrancó: el link muestra la ficha pero ya no recibe reservas.</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-amber-300/90">El club todavía no tiene link público. Créalo en Configuración → Link público.</p>
      )}

      {/* Lista */}
      {rows.length === 0 ? (
        <p className="text-xs text-gray-500">Nadie ha reservado por el link todavía.</p>
      ) : (
        <div className="space-y-3">
          {canConfirm ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-300">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={opts.payBuyin} onChange={(e) => setOpts({ ...opts, payBuyin: e.target.checked })} className="w-4 h-4 accent-violet-500" />
                Cobrar buy-in {buyin > 0 && `(${formatMoney(buyin)})`}
              </label>
              {tip > 0 && (
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={opts.payTip} onChange={(e) => setOpts({ ...opts, payTip: e.target.checked })} className="w-4 h-4 accent-pink-500" />
                  Cobrar tip ({formatMoney(tip)})
                </label>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-gray-500">Se confirman y cobran cuando abras el torneo y el jugador llegue.</p>
          )}

          {[['En cupo', inCupo], ['Lista de espera', waiting]].map(([title, list]) => list.length > 0 && (
            <div key={title}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1.5">{title} · {list.length}</p>
              <ul className="space-y-1.5">
                {list.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 bg-gray-900/60 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm text-white font-bold truncate">
                        {p.waitlist_position != null && <span className="text-amber-300 mr-1.5">#{p.waitlist_position}</span>}
                        {p.name}
                      </p>
                      <p className="text-[11px] text-gray-500 truncate">
                        <a href={`https://wa.me/${p.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="hover:text-emerald-400">{p.phone}</a>
                        {p.created_at && <> · {fmtTime(p.created_at)}</>}
                        {p.match_player
                          ? <span className="text-violet-300"> · ficha: {p.match_player.name}</span>
                          : <span className="text-gray-600"> · nuevo</span>}
                      </p>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      {canConfirm && (
                        <button type="button" onClick={() => confirm(p)} disabled={busyId != null}
                          className="text-xs font-bold px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50">
                          {busyId === p.id ? '…' : 'Llegó'}
                        </button>
                      )}
                      <button type="button" onClick={() => setToCancel(p)} disabled={busyId != null} aria-label={`Cancelar reserva de ${p.name}`}
                        className="text-xs font-bold px-2.5 py-2 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-50">
                        ✕
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {loadError && <p className="text-[11px] text-amber-300/80">Sin conexión · mostrando la última lista.</p>}

      <ConfirmModal
        isOpen={!!toCancel}
        onClose={() => setToCancel(null)}
        onConfirm={cancel}
        title="Cancelar reserva"
        message={toCancel ? `¿Cancelar la reserva de ${toCancel.name}? Si hay lista de espera, el siguiente sube al cupo.` : ''}
        confirmText="Sí, cancelar"
        loadingText="Cancelando..."
        isDeleting={busyId != null && busyId === toCancel?.id}
      />
    </div>
  );
}
