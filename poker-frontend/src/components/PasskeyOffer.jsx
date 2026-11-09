import { useEffect, useState } from 'react';
import { FingerPrintIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { passkeyService } from '../api/services';
import {
  createPasskey, isCancel, localPasskey, passkeyAvailable, passkeyError,
} from '../utils/passkey';

// "Entra con tu huella o tu cara": ofrecimiento en el panel del jugador.
//
// Pasos: oferta → confirmar la clave (una vez: la huella abrirá lo mismo que
// esa clave) → tocar "Usar huella" → listo. El paso de la huella es un toque
// APARTE a propósito: iOS solo deja pedir la huella dentro de un toque, y si
// antes hay que esperar al servidor el permiso se pierde. Por eso las opciones
// se piden al confirmar la clave y la huella se pide en el toque siguiente.
//
// No aparece si: el dispositivo no tiene huella/cara, ya está activa en este
// celular, o la persona dijo "Ahora no" hace menos de 30 días.
export default function PasskeyOffer() {
  const [step, setStep] = useState('hidden'); // hidden | offer | password | ready | done
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(null); // {challenge_id, options}
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (localPasskey.get() || localPasskey.dismissedRecently()) return undefined;
    let cancelled = false;
    passkeyAvailable().then((ok) => { if (ok && !cancelled) setStep('offer'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (step !== 'done') return undefined;
    const t = setTimeout(() => setStep('hidden'), 5000);
    return () => clearTimeout(t);
  }, [step]);

  if (step === 'hidden') return null;

  const dismiss = () => { localPasskey.dismiss(); setStep('hidden'); };

  const confirmPassword = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setPending(await passkeyService.registerOptions(password));
      setPassword('');
      setStep('ready');
    } catch (err) {
      setError(passkeyError(err, 'No pudimos confirmar tu clave. Intenta de nuevo.').message);
    } finally {
      setBusy(false);
    }
  };

  const scanBiometric = async () => {
    setBusy(true);
    setError('');
    try {
      const credential = await createPasskey(pending.options);
      const res = await passkeyService.registerVerify(pending.challenge_id, credential);
      localPasskey.set({ id: res.credential_id });
      setStep('done');
    } catch (err) {
      if (err?.name === 'InvalidStateError') {
        // Este celular ya tenía la huella de esta cuenta: queda activa igual.
        localPasskey.set({ id: null });
        setStep('done');
      } else if (isCancel(err)) {
        setError('Se canceló. Toca el botón otra vez cuando estés listo.');
      } else {
        const { code, message } = passkeyError(err, 'No pudimos activar la huella. Intenta de nuevo.');
        setError(message);
        // El intento se gastó o venció: hay que pedir uno nuevo con la clave.
        if (code === 'challenge_expired' || code === 'verify_failed') { setPending(null); setStep('password'); }
      }
    } finally {
      setBusy(false);
    }
  };

  if (step === 'done') {
    return (
      <div role="status" className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 mb-4">
        <FingerPrintIcon className="w-7 h-7 text-emerald-400 shrink-0" aria-hidden="true" />
        <p className="flex-1 text-sm text-white leading-snug">
          <b>Listo.</b> La próxima vez entra con tu huella o tu cara, sin escribir la clave.
        </p>
      </div>
    );
  }

  return (
    <section aria-label="Entrar con huella o cara" className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 mb-4">
      <div className="flex items-start gap-3">
        <FingerPrintIcon className="w-7 h-7 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white leading-tight">Entra con tu huella o tu cara</p>
          <p className="text-[11px] text-emerald-200/80 leading-snug mt-0.5">
            {step === 'ready'
              ? 'Toca el botón y pon tu huella o mira la cámara.'
              : 'La próxima vez entras sin escribir la clave.'}
          </p>
        </div>
        {step !== 'ready' && (
          <button onClick={dismiss} aria-label="Ahora no" className="rf-tap -mr-1 -mt-1 p-1.5 text-gray-400 hover:text-white">
            <XMarkIcon className="w-4 h-4" />
          </button>
        )}
      </div>

      {step === 'offer' && (
        <button onClick={() => setStep('password')} className="rf-tap mt-3 w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold py-2.5">
          Activar
        </button>
      )}

      {step === 'password' && (
        <form onSubmit={confirmPassword} className="mt-3 space-y-2">
          <label htmlFor="passkey-password" className="block text-[11px] font-bold text-gray-300">
            Confirma tu clave para activarla
          </label>
          <div className="flex gap-2">
            <input
              id="passkey-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              required
              autoFocus
              className="min-w-0 flex-1 rounded-xl border border-gray-700 bg-gray-900/70 px-3 py-2.5 text-base text-white focus:outline-none focus:border-emerald-500/60"
            />
            <button type="submit" disabled={busy || !password} className="rf-tap shrink-0 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold px-4">
              {busy ? '…' : 'Seguir'}
            </button>
          </div>
        </form>
      )}

      {step === 'ready' && (
        <button onClick={scanBiometric} disabled={busy} className="rf-tap mt-3 w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-sm font-bold py-2.5">
          <FingerPrintIcon className="w-5 h-5" aria-hidden="true" />
          {busy ? 'Esperando al celular…' : 'Usar huella o cara'}
        </button>
      )}

      {error && <p role="alert" className="mt-2 text-[11px] text-red-300">{error}</p>}
    </section>
  );
}

// Pie del panel: dónde se ve (y se quita) la huella de ESTE celular.
export function PasskeyDeviceStatus() {
  const [active, setActive] = useState(() => Boolean(localPasskey.get()));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // Se entera al instante cuando la oferta de arriba activa la huella.
  useEffect(() => {
    const sync = () => setActive(Boolean(localPasskey.get()));
    window.addEventListener('rf-passkey', sync);
    return () => window.removeEventListener('rf-passkey', sync);
  }, []);

  if (!active && !msg) return null;
  if (!active) return <p role="status" className="text-[11px] text-gray-500 mb-2">{msg}</p>;

  const remove = async () => {
    setBusy(true);
    try {
      const { passkeys = [] } = await passkeyService.list();
      const mine = localPasskey.get()?.id;
      // Sin id local (ya estaba activa al activarla): se quitan todas las de la cuenta.
      const targets = mine ? passkeys.filter((p) => p.credential_id === mine) : passkeys;
      for (const p of targets) await passkeyService.remove(p.id);
      localPasskey.clear();
      setActive(false);
      setMsg('Quitamos la huella de este celular. Entras con tu clave.');
    } catch {
      setMsg('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <p className="text-[11px] text-gray-500 mb-2 flex items-center justify-center gap-1.5">
      <FingerPrintIcon className="w-3.5 h-3.5" aria-hidden="true" />
      Huella activa en este celular ·
      <button onClick={remove} disabled={busy} className="rf-tap font-bold text-gray-400 hover:text-white underline underline-offset-2 disabled:opacity-50">
        {busy ? 'Quitando…' : 'Quitar'}
      </button>
    </p>
  );
}
