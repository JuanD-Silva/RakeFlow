import { useState } from 'react';
import { playerService } from '../api/services';

// ---------------------------------------------------------
// Cuenta del panel del jugador (staff): invitar por WhatsApp con código OTP y
// desbloquear el histórico (la venta se cobra EN CAJA; esto solo destraba).
// Vive en dos lugares: la fila expandida de la mesa activa (PlayerTable) y el
// directorio de jugadores (PlayersDirectory) — por eso recibe playerId plano.
// ---------------------------------------------------------
export default function PlayerAppAccount({ playerId, account, canManage, onChanged }) {
  const [inviting, setInviting] = useState(false);
  const [resetMode, setResetMode] = useState(false); // reset de clave (cuenta ya activa)
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [confirmUnlock, setConfirmUnlock] = useState(false);

  if (!canManage || !account) return null;

  const doInvite = async () => {
    setErr(null);
    if (phone.replace(/\D/g, '').length < 7) { setErr('Teléfono inválido.'); return; }
    setBusy(true);
    try {
      const res = resetMode
        ? await playerService.resetAccess(playerId, phone.trim())
        : await playerService.invite(playerId, phone.trim());
      if (res.wa_url) window.open(res.wa_url, '_blank'); // abre WhatsApp con el código listo
      setInviting(false);
      onChanged();
    } catch (e) {
      setErr(e.response?.data?.detail || 'Error generando la invitación.');
    } finally {
      setBusy(false);
    }
  };

  const doUnlock = async () => {
    if (!confirmUnlock) { setConfirmUnlock(true); setTimeout(() => setConfirmUnlock(false), 4000); return; }
    setConfirmUnlock(false);
    setBusy(true);
    setErr(null);
    try {
      await playerService.unlockHistory(playerId);
      onChanged();
    } catch (e) {
      setErr(e.response?.data?.detail || 'Error con el histórico.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-gray-700/60">
      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">App del jugador:</span>
      {!account.has_account && !inviting && (
        <button onClick={() => { setInviting(true); setResetMode(false); setPhone(account.phone || ''); setErr(null); }}
          className="text-[10px] font-bold uppercase px-2 py-1 rounded border bg-emerald-500/10 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20 transition-all active:scale-95">
          📲 Invitar a la app
        </button>
      )}
      {account.has_account && account.invitation_pending && !inviting && (
        <>
          <span className="text-[10px] font-bold uppercase px-2 py-1 rounded bg-amber-500/10 text-amber-300">⏳ Invitación pendiente</span>
          <button onClick={() => { setInviting(true); setResetMode(false); setPhone(account.phone || ''); setErr(null); }}
            className="text-[10px] font-bold uppercase px-2 py-1 rounded border border-gray-600 text-gray-300 hover:bg-gray-700 transition-all active:scale-95">
            Re-invitar
          </button>
        </>
      )}
      {account.has_account && !account.invitation_pending && (
        <>
          <span className="text-[10px] font-bold uppercase px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ App activa</span>
          {!inviting && (
            <button onClick={() => { setInviting(true); setResetMode(true); setPhone(account.phone || ''); setErr(null); }}
              title="Olvidó su clave: genera un código nuevo por WhatsApp"
              className="text-[10px] font-bold uppercase px-2 py-1 rounded border border-gray-600 text-gray-400 hover:bg-gray-700 transition-all active:scale-95">
              🔑 Resetear clave
            </button>
          )}
        </>
      )}
      {account.has_account && (
        <button onClick={doUnlock} disabled={busy}
          title={account.history_unlocked ? 'Volver a bloquear el histórico (revertir un cobro errado)' : '¿Ya cobraste en caja? Esto le abre TODA su historia'}
          className={`text-[10px] font-bold uppercase px-2 py-1 rounded border transition-all active:scale-95 disabled:opacity-40 ${
            confirmUnlock ? 'bg-violet-500 border-violet-400 text-white'
            : account.history_unlocked ? 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'
            : 'bg-violet-500/10 border-violet-500/40 text-violet-300 hover:bg-violet-500/20'
          }`}>
          {confirmUnlock ? '¿Cobraste en caja?' : account.history_unlocked ? '🔓 Histórico abierto' : '🔒 Desbloquear histórico'}
        </button>
      )}
      {inviting && (
        <span className="flex items-center gap-1.5">
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Celular"
            className="w-32 bg-gray-800 text-white border border-gray-600 rounded px-2 py-1 text-xs focus:border-emerald-500 outline-none" />
          <button onClick={doInvite} disabled={busy}
            className="text-[10px] font-bold uppercase px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40">
            {busy ? '…' : 'WhatsApp →'}
          </button>
          <button onClick={() => setInviting(false)} className="text-[10px] text-gray-500 hover:text-gray-300 font-bold uppercase">✕</button>
        </span>
      )}
      {err && <span className="text-[10px] text-red-400 font-bold">{err}</span>}
    </div>
  );
}
