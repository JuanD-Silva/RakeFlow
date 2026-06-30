import { useState, useEffect } from 'react';
import { dealerService } from '../api/services';
import { useAuth } from '../context/AuthContext';
import { PlusIcon, PencilSquareIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { formatMoney } from '../utils/formatters';

/**
 * Gestión de dealers y sus tarifas (ConfigPanel).
 * Editar/desactivar requiere OWNER o MANAGER (el backend lo exige igual).
 * Las tarifas se snapshotean por turno: editar acá NO cambia turnos pasados.
 */
export default function DealerManager() {
  const { role } = useAuth();
  const canManage = ['owner', 'manager'].includes((role || '').toLowerCase());

  const [dealers, setDealers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({});
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [invitingId, setInvitingId] = useState(null);
  const [invitePhone, setInvitePhone] = useState("");
  const [inviteError, setInviteError] = useState(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteResult, setInviteResult] = useState(null); // {wa_url, message} para reenviar
  const [resetMode, setResetMode] = useState(false);       // true = resetear acceso (cuenta ya activada)

  const load = async () => {
    setLoading(true);
    try {
      setDealers(await dealerService.list(true));
    } catch (err) {
      console.error("Error cargando dealers", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const startEdit = (dealer) => {
    setEditingId(dealer.id);
    setDraft({
      name: dealer.name,
      hourly_rate_cop: dealer.hourly_rate_cop,
      rake_pct: dealer.rake_pct,
      tournament_hourly_rate_cop: dealer.tournament_hourly_rate_cop,
      is_active: dealer.is_active,
    });
    setError(null);
  };

  const startCreate = () => {
    setCreating(true);
    setEditingId(null);
    setDraft({ name: "", hourly_rate_cop: "", rake_pct: "", tournament_hourly_rate_cop: "", is_active: true });
    setError(null);
  };

  const cancel = () => {
    setEditingId(null);
    setCreating(false);
    setDraft({});
    setError(null);
  };

  const save = async () => {
    setError(null);
    if (!draft.name?.trim()) { setError("El nombre es obligatorio."); return; }
    const payload = {
      name: draft.name.trim(),
      hourly_rate_cop: parseFloat(draft.hourly_rate_cop) || 0,
      rake_pct: parseFloat(draft.rake_pct) || 0,
      tournament_hourly_rate_cop: parseFloat(draft.tournament_hourly_rate_cop) || 0,
    };
    try {
      if (creating) {
        await dealerService.create(payload);
      } else {
        await dealerService.update(editingId, { ...payload, is_active: draft.is_active });
      }
      cancel();
      load();
    } catch (err) {
      setError(err.response?.data?.detail || "Error guardando el dealer.");
    }
  };

  const startInvite = (dealer, reset = false) => {
    setInvitingId(dealer.id);
    setInvitePhone(dealer.phone || "");
    setInviteError(null);
    setInviteResult(null);
    setResetMode(reset);
  };

  const doInvite = async (dealer) => {
    setInviteError(null);
    const phone = invitePhone.trim();
    if (phone.replace(/\D/g, '').length < 7) { setInviteError("Teléfono inválido."); return; }
    setInviteBusy(true);
    try {
      const res = resetMode
        ? await dealerService.resetAccess(dealer.id, phone)
        : await dealerService.invite(dealer.id, phone);
      setInviteResult(res);            // guardamos wa_url para abrir/reenviar
      if (res.wa_url) window.open(res.wa_url, '_blank'); // abre WhatsApp con el código listo
      load();
    } catch (err) {
      setInviteError(err.response?.data?.detail || (resetMode ? "Error reseteando el acceso." : "Error generando la invitación."));
    } finally {
      setInviteBusy(false);
    }
  };

  const toggleActive = async (dealer) => {
    try {
      if (dealer.is_active) {
        await dealerService.deactivate(dealer.id);
      } else {
        await dealerService.update(dealer.id, { is_active: true });
      }
      load();
    } catch (err) {
      setError(err.response?.data?.detail || "Error actualizando el dealer.");
    }
  };

  const removeDealer = async (dealer) => {
    setError(null);
    if (!window.confirm(`¿Eliminar definitivamente a "${dealer.name}"? Esto borra su cuenta y no se puede deshacer. (Si tiene historial de turnos/pagos no se podrá eliminar; quedará archivado.)`)) return;
    try {
      await dealerService.remove(dealer.id);
      load();
    } catch (err) {
      setError(err.response?.data?.detail || "No se pudo eliminar el dealer.");
    }
  };

  const editForm = (
    <div className="bg-gray-900/60 border border-amber-500/30 rounded-xl p-4 space-y-3">
      <input
        type="text"
        value={draft.name || ""}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        className="w-full bg-gray-800 text-white border border-gray-600 rounded-lg py-2.5 px-3 focus:border-amber-500 outline-none text-sm"
        placeholder="Nombre del dealer"
      />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-gray-500 text-[10px] font-bold uppercase px-1">$ / hora</label>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            value={draft.hourly_rate_cop}
            onChange={(e) => setDraft({ ...draft, hourly_rate_cop: e.target.value })}
            className="w-full bg-gray-800 text-white border border-gray-600 rounded-lg py-2 px-3 focus:border-amber-500 outline-none font-mono text-sm"
            placeholder="20000"
          />
        </div>
        <div>
          <label className="text-gray-500 text-[10px] font-bold uppercase px-1">% del rake</label>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            max="100"
            value={draft.rake_pct}
            onChange={(e) => setDraft({ ...draft, rake_pct: e.target.value })}
            className="w-full bg-gray-800 text-white border border-gray-600 rounded-lg py-2 px-3 focus:border-amber-500 outline-none font-mono text-sm"
            placeholder="10"
          />
        </div>
      </div>
      <div>
        <label className="text-gray-500 text-[10px] font-bold uppercase px-1">🏆 $ / hora en torneo <span className="text-gray-600 normal-case font-normal">(sin rake)</span></label>
        <input
          type="number"
          inputMode="numeric"
          min="0"
          value={draft.tournament_hourly_rate_cop ?? ''}
          onChange={(e) => setDraft({ ...draft, tournament_hourly_rate_cop: e.target.value })}
          className="w-full bg-gray-800 text-white border border-gray-600 rounded-lg py-2 px-3 focus:border-violet-500 outline-none font-mono text-sm"
          placeholder="25000"
        />
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <div className="flex gap-2">
        <button onClick={save} className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-bold py-2 rounded-lg text-xs uppercase flex items-center justify-center gap-1">
          <CheckIcon className="w-4 h-4" /> Guardar
        </button>
        <button onClick={cancel} className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold py-2 rounded-lg text-xs uppercase flex items-center justify-center gap-1">
          <XMarkIcon className="w-4 h-4" /> Cancelar
        </button>
      </div>
    </div>
  );

  return (
    <div className="bg-gray-800/40 rounded-2xl border border-gray-700/50 p-5 backdrop-blur-sm space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-white font-bold text-base">🃏 Dealers y Tarifas</h3>
          <p className="text-gray-500 text-xs mt-0.5">
            Pago por hora + % del rake del turno. Editar tarifas no cambia turnos pasados.
          </p>
        </div>
        {canManage && !creating && (
          <button
            onClick={startCreate}
            className="bg-amber-600/20 hover:bg-amber-600 text-amber-400 hover:text-white border border-amber-500/30 rounded-lg p-2 transition-all"
            title="Agregar dealer"
          >
            <PlusIcon className="w-5 h-5" />
          </button>
        )}
      </div>

      {creating && editForm}

      {loading ? (
        <p className="text-gray-500 text-sm py-4 text-center">Cargando...</p>
      ) : dealers.length === 0 && !creating ? (
        <p className="text-gray-600 text-xs py-3 text-center italic">
          Sin dealers registrados. También se pueden crear desde la mesa al asignar turno.
        </p>
      ) : (
        <div className="space-y-2">
          {dealers.map((d) => (
            editingId === d.id ? (
              <div key={d.id}>{editForm}</div>
            ) : (
              <div
                key={d.id}
                className={`bg-gray-900/40 border border-gray-700/50 rounded-xl p-3 ${!d.is_active ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-white font-bold text-sm truncate flex items-center gap-2">
                      {d.name}
                      {!d.is_active && (
                        <span className="text-[9px] bg-gray-700 text-gray-400 px-2 py-0.5 rounded-full uppercase font-bold">Inactivo</span>
                      )}
                      {d.invitation_pending ? (
                        <span className="text-[9px] bg-amber-700/40 text-amber-300 px-2 py-0.5 rounded-full uppercase font-bold">Invitación pendiente</span>
                      ) : d.has_account ? (
                        <span className="text-[9px] bg-emerald-700/40 text-emerald-300 px-2 py-0.5 rounded-full uppercase font-bold">Con cuenta</span>
                      ) : null}
                    </p>
                    <p className="text-gray-500 text-xs font-mono mt-0.5">
                      {formatMoney(d.hourly_rate_cop)}/h · {d.rake_pct}% rake
                      {d.tournament_hourly_rate_cop ? ` · 🏆 ${formatMoney(d.tournament_hourly_rate_cop)}/h` : ''}
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex gap-1.5 shrink-0">
                      {d.is_active && !d.has_account && (
                        <button
                          onClick={() => startInvite(d)}
                          className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg border text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 transition-all"
                          title="Crear cuenta para que el dealer use la app"
                        >
                          Invitar a la app
                        </button>
                      )}
                      {d.is_active && d.has_account && !d.invitation_pending && (
                        <button
                          onClick={() => startInvite(d, true)}
                          className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg border text-amber-400 border-amber-500/30 hover:bg-amber-500/10 transition-all"
                          title="Resetear acceso: el dealer vuelve a verificar su número y crea una nueva contraseña. No borra su historial."
                        >
                          Resetear acceso
                        </button>
                      )}
                      <button
                        onClick={() => startEdit(d)}
                        className="text-gray-400 hover:text-amber-400 hover:bg-amber-500/10 rounded-lg p-2 transition-all"
                        title="Editar"
                      >
                        <PencilSquareIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => toggleActive(d)}
                        className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg border transition-all ${
                          d.is_active
                            ? 'text-red-400 border-red-500/30 hover:bg-red-500/10'
                            : 'text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10'
                        }`}
                      >
                        {d.is_active ? 'Desactivar' : 'Activar'}
                      </button>
                      {!d.is_active && (
                        <button
                          onClick={() => removeDealer(d)}
                          className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg border text-red-400 border-red-500/40 hover:bg-red-500/15 transition-all"
                          title="Eliminar definitivamente (solo si no tiene historial)"
                        >
                          Eliminar
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {invitingId === d.id && (
                  <div className="mt-3 pt-3 border-t border-gray-700/50 space-y-2">
                    <p className="text-[11px] text-gray-400">
                      {resetMode
                        ? "Resetea el acceso: el dealer vuelve a verificar su número y crea una nueva contraseña. No borra su historial. Se abrirá WhatsApp con el nuevo código."
                        : "Se abrirá WhatsApp con el código de verificación para enviar al número del dealer."}
                    </p>
                    <input
                      type="tel"
                      inputMode="tel"
                      value={invitePhone}
                      onChange={(e) => setInvitePhone(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') doInvite(d); }}
                      className="w-full bg-gray-800 text-white border border-gray-600 rounded-lg py-2 px-3 focus:border-emerald-500 outline-none text-sm"
                      placeholder="Teléfono (ej. 300 123 4567)"
                      autoFocus
                    />
                    {inviteError && <p className="text-red-400 text-xs">{inviteError}</p>}
                    {inviteResult ? (
                      <div className="space-y-2">
                        <p className="text-emerald-400 text-xs font-bold">✓ {resetMode ? "Acceso reseteado. " : ""}Código generado. Si WhatsApp no abrió, tocá el botón:</p>
                        <div className="flex gap-2">
                          <a href={inviteResult.wa_url} target="_blank" rel="noreferrer" className="flex-1 text-center bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 rounded-lg text-xs uppercase">Abrir WhatsApp</a>
                          <button onClick={() => { setInvitingId(null); setInviteResult(null); }} className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold py-2 rounded-lg text-xs uppercase">Listo</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button onClick={() => doInvite(d)} disabled={inviteBusy} className={`flex-1 disabled:opacity-50 text-white font-bold py-2 rounded-lg text-xs uppercase ${resetMode ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}>
                          {inviteBusy ? (resetMode ? 'Reseteando…' : 'Generando…') : (resetMode ? 'Resetear y enviar' : 'Invitar por WhatsApp')}
                        </button>
                        <button onClick={() => setInvitingId(null)} className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold py-2 rounded-lg text-xs uppercase">Cancelar</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}
