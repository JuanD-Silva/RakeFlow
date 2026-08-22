import { useState } from 'react';
import { playerService } from '../api/services';
import { PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';

// "Sin teléfono" era un callejón sin salida en el directorio: sin número no
// hay WhatsApp ni invitación. Aquí se agrega en línea, sin salir de la lista.
export default function PhoneEditor({ playerId, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const save = async (e) => {
    e.preventDefault();
    if (phone.replace(/\D/g, '').length < 10) { setErr('Escribe el celular con sus 10 dígitos.'); return; }
    setBusy(true); setErr(null);
    try {
      await playerService.updatePhone(playerId, phone.trim());
      setEditing(false);
      onSaved?.();
    } catch (ex) {
      setErr(ex.response?.data?.detail || 'No se pudo guardar el teléfono.');
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1 min-h-8 text-xs text-gray-400 hover:text-emerald-300 font-bold">
        <PlusIcon className="w-3.5 h-3.5" /> Agregar teléfono
      </button>
    );
  }
  return (
    <form onSubmit={save} className="flex flex-wrap items-center gap-2 mt-1">
      <input
        type="tel" inputMode="tel" autoFocus value={phone} onChange={(e) => setPhone(e.target.value)}
        placeholder="Celular (10 dígitos)" aria-label="Celular del jugador"
        className="w-44 min-h-11 bg-gray-800 text-white border border-gray-600 rounded-xl px-3 text-sm focus:border-emerald-500 outline-none"
      />
      <button type="submit" disabled={busy}
        className="min-h-11 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-40">
        {busy ? 'Guardando…' : 'Guardar'}
      </button>
      <button type="button" onClick={() => { setEditing(false); setErr(null); }} aria-label="Cancelar"
        className="min-h-11 min-w-11 flex items-center justify-center text-gray-500 hover:text-gray-300">
        <XMarkIcon className="w-5 h-5" />
      </button>
      {err && <p className="basis-full text-xs text-red-300 font-bold">{err}</p>}
    </form>
  );
}
