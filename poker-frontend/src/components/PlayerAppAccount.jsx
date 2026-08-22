import { useState } from 'react';
import { playerService } from '../api/services';
import {
  DevicePhoneMobileIcon, KeyIcon, LockClosedIcon, LockOpenIcon, ClockIcon,
  CheckCircleIcon, ClipboardDocumentIcon, XMarkIcon, ChevronDownIcon,
} from '@heroicons/react/24/outline';

// ---------------------------------------------------------
// Cuenta del panel del jugador (staff): invitar con código OTP y desbloquear
// el histórico (la venta se cobra EN CAJA; esto solo destraba).
// Vive en dos lugares: la fila expandida de la mesa activa (PlayerTable) y el
// directorio de jugadores (PlayersDirectory) — por eso recibe playerId plano.
//
// Invitar (Plan B sin Twilio, el que usa Mambo hoy): el backend devuelve
// wa_url + message. NO se abre con window.open después del await — Safari
// iOS bloquea popups fuera del gesto y el dueño creía que había invitado.
// Se muestra un link real "Abrir WhatsApp" + "Copiar mensaje" hasta que lo
// toque.
// ---------------------------------------------------------
const BTN = 'inline-flex items-center gap-1.5 min-h-11 px-3 rounded-xl border text-xs font-bold transition-colors active:scale-[0.98] disabled:opacity-40';

export default function PlayerAppAccount({ playerId, account, canManage, onChanged, collapsible = false }) {
  const [open, setOpen] = useState(!collapsible);
  const [inviting, setInviting] = useState(false);
  const [resetMode, setResetMode] = useState(false); // reset de clave (cuenta ya activa)
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [sentMsg, setSentMsg] = useState(null);   // confirmación del camino verificado
  const [pendingWa, setPendingWa] = useState(null); // { wa_url, message } del Plan B
  const [copied, setCopied] = useState(false);
  const [confirmUnlock, setConfirmUnlock] = useState(false);

  if (!canManage || !account) return null;

  const startInvite = (reset) => {
    setOpen(true); setInviting(true); setResetMode(reset); setPhone(account.phone || ''); setErr(null); setSentMsg(null); setPendingWa(null);
  };

  const doInvite = async () => {
    setErr(null); setSentMsg(null);
    if (phone.replace(/\D/g, '').length < 7) { setErr('Teléfono inválido.'); return; }
    setBusy(true);
    try {
      const res = resetMode
        ? await playerService.resetAccess(playerId, phone.trim())
        : await playerService.invite(playerId, phone.trim());
      if (res.verified) {
        setSentMsg(`Código enviado por ${res.sent_channel === 'sms' ? 'SMS' : 'WhatsApp'} al jugador.`);
      } else if (res.wa_url) {
        setPendingWa({ wa_url: res.wa_url, message: res.message || '' });
      }
      setInviting(false);
      onChanged();
    } catch (e) {
      setErr(e.response?.data?.detail || 'No se pudo generar la invitación.');
    } finally {
      setBusy(false);
    }
  };

  const copyMsg = async () => {
    try {
      await navigator.clipboard.writeText(pendingWa?.message || pendingWa?.wa_url || '');
      setCopied(true); setTimeout(() => setCopied(false), 2500);
    } catch { setErr('No se pudo copiar. Usa el botón de WhatsApp.'); }
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

  const estado = !account.has_account
    ? { txt: 'Sin cuenta', cls: 'text-gray-400', Icon: DevicePhoneMobileIcon }
    : account.invitation_pending
      ? { txt: 'Invitación pendiente', cls: 'text-amber-300', Icon: ClockIcon }
      : { txt: 'App activa', cls: 'text-emerald-300', Icon: CheckCircleIcon };

  // Colapsado (directorio): una línea con el estado y un chevron — el 90% de
  // las fichas no tiene cuenta y no necesita tres botones a la vista.
  if (collapsible && !open) {
    return (
      <button type="button" onClick={() => setOpen(true)} aria-expanded="false"
        className="w-full min-h-11 flex items-center justify-between gap-2 text-xs text-gray-400 hover:text-gray-200">
        <span className={`inline-flex items-center gap-1.5 font-bold ${estado.cls}`}><estado.Icon className="w-4 h-4" /> {estado.txt}</span>
        <span className="inline-flex items-center gap-1">{!account.has_account ? 'Invitar' : 'Cuenta'} <ChevronDownIcon className="w-4 h-4" /></span>
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${estado.cls}`}><estado.Icon className="w-4 h-4" /> {estado.txt}</span>
        {collapsible && (
          <button type="button" onClick={() => { setOpen(false); setInviting(false); }} aria-label="Ocultar cuenta" className="ml-auto min-h-11 min-w-11 flex items-center justify-center text-gray-500 hover:text-gray-300">
            <ChevronDownIcon className="w-4 h-4 rotate-180" />
          </button>
        )}
      </div>

      {!inviting && !pendingWa && (
        <div className="flex flex-wrap gap-2">
          {!account.has_account && (
            <button type="button" onClick={() => startInvite(false)} className={`${BTN} bg-emerald-500/10 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20`}>
              <DevicePhoneMobileIcon className="w-4 h-4" /> Invitar a la app
            </button>
          )}
          {account.has_account && account.invitation_pending && (
            <button type="button" onClick={() => startInvite(false)} className={`${BTN} border-gray-600 text-gray-300 hover:bg-gray-700`}>
              <DevicePhoneMobileIcon className="w-4 h-4" /> Re-invitar
            </button>
          )}
          {account.has_account && !account.invitation_pending && (
            <button type="button" onClick={() => startInvite(true)} title="Olvidó su clave: genera un código nuevo" className={`${BTN} border-gray-600 text-gray-400 hover:bg-gray-700`}>
              <KeyIcon className="w-4 h-4" /> Resetear clave
            </button>
          )}
          {account.has_account && (
            <button type="button" onClick={doUnlock} disabled={busy}
              title={account.history_unlocked ? 'Tocar vuelve a bloquear el histórico (revertir un cobro errado)' : '¿Ya cobraste en caja? Esto le abre TODA su historia'}
              className={`${BTN} ${
                confirmUnlock ? 'bg-violet-500 border-violet-400 text-white'
                : account.history_unlocked ? 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'
                : 'bg-violet-500/10 border-violet-500/40 text-violet-300 hover:bg-violet-500/20'
              }`}>
              {confirmUnlock
                ? (account.history_unlocked ? '¿Volver a bloquear?' : '¿Cobraste en caja?')
                : account.history_unlocked
                  ? <><LockOpenIcon className="w-4 h-4" /> Histórico abierto · bloquear</>
                  : <><LockClosedIcon className="w-4 h-4" /> Desbloquear histórico</>}
            </button>
          )}
        </div>
      )}

      {inviting && (
        <div className="flex flex-wrap items-center gap-2">
          <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Celular"
            aria-label="Celular del jugador"
            className="w-40 min-h-11 bg-gray-800 text-white border border-gray-600 rounded-xl px-3 text-sm focus:border-emerald-500 outline-none" />
          <button type="button" onClick={doInvite} disabled={busy} className={`${BTN} bg-emerald-600 hover:bg-emerald-500 border-emerald-600 text-white`}>
            {busy ? 'Generando…' : (resetMode ? 'Generar código' : 'Generar invitación')}
          </button>
          <button type="button" onClick={() => setInviting(false)} aria-label="Cancelar" className="min-h-11 min-w-11 flex items-center justify-center text-gray-500 hover:text-gray-300">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
      )}

      {pendingWa && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
          <p className="text-xs text-gray-300">Invitación lista. Mándasela al jugador:</p>
          <div className="flex flex-wrap gap-2">
            <a href={pendingWa.wa_url} target="_blank" rel="noreferrer" onClick={() => setTimeout(() => setPendingWa(null), 0)}
              className={`${BTN} bg-[#25D366]/90 hover:bg-[#25D366] border-[#25D366] text-white`}>
              Abrir WhatsApp
            </a>
            <button type="button" onClick={copyMsg} className={`${BTN} border-gray-600 text-gray-300 hover:bg-gray-700`}>
              <ClipboardDocumentIcon className="w-4 h-4" /> {copied ? 'Copiado' : 'Copiar mensaje'}
            </button>
            <button type="button" onClick={() => setTimeout(() => setPendingWa(null), 0)} aria-label="Cerrar" className="min-h-11 min-w-11 flex items-center justify-center text-gray-500 hover:text-gray-300">
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {err && <p className="text-xs text-red-300 font-bold">{err}</p>}
      {sentMsg && <p className="text-xs text-emerald-300 font-bold">✓ {sentMsg}</p>}
    </div>
  );
}
