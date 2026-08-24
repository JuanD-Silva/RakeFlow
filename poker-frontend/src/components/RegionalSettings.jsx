import { useEffect, useState } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { setRegional } from '../utils/formatters';
import { GlobeAmericasIcon } from '@heroicons/react/24/outline';

// Región del club: zona horaria, moneda y formato. Default Colombia; un club
// de otro país lo cambia UNA vez y toda la app (staff + panel del jugador)
// formatea con ello. Solo el OWNER guarda.
const TIMEZONES = [
  ['America/Bogota', 'Colombia — Bogotá'],
  ['America/Mexico_City', 'México — CDMX'],
  ['America/Cancun', 'México — Cancún'],
  ['America/Lima', 'Perú — Lima'],
  ['America/Guayaquil', 'Ecuador — Guayaquil'],
  ['America/Panama', 'Panamá'],
  ['America/Costa_Rica', 'Costa Rica'],
  ['America/Guatemala', 'Guatemala'],
  ['America/Santo_Domingo', 'Rep. Dominicana'],
  ['America/Caracas', 'Venezuela — Caracas'],
  ['America/La_Paz', 'Bolivia — La Paz'],
  ['America/Asuncion', 'Paraguay — Asunción'],
  ['America/Santiago', 'Chile — Santiago'],
  ['America/Argentina/Buenos_Aires', 'Argentina — Buenos Aires'],
  ['America/Montevideo', 'Uruguay — Montevideo'],
  ['America/Sao_Paulo', 'Brasil — São Paulo'],
  ['America/New_York', 'EE. UU. — Este (Miami/NY)'],
  ['Europe/Madrid', 'España — Madrid'],
];
const CURRENCIES = [
  ['COP', 'Peso colombiano'], ['MXN', 'Peso mexicano'], ['USD', 'Dólar (USD)'],
  ['PEN', 'Sol peruano'], ['ARS', 'Peso argentino'], ['CLP', 'Peso chileno'],
  ['BRL', 'Real brasileño'], ['UYU', 'Peso uruguayo'], ['PYG', 'Guaraní'],
  ['BOB', 'Boliviano'], ['GTQ', 'Quetzal'], ['DOP', 'Peso dominicano'],
  ['CRC', 'Colón costarricense'], ['EUR', 'Euro'],
];
const LOCALES = [
  ['es-CO', 'Español (Colombia)'], ['es-MX', 'Español (México)'], ['es-AR', 'Español (Argentina)'],
  ['es-CL', 'Español (Chile)'], ['es-PE', 'Español (Perú)'], ['es-UY', 'Español (Uruguay)'],
  ['es-PY', 'Español (Paraguay)'], ['es-BO', 'Español (Bolivia)'], ['es-GT', 'Español (Guatemala)'],
  ['es-DO', 'Español (R. Dominicana)'], ['es-CR', 'Español (Costa Rica)'], ['es-ES', 'Español (España)'],
  ['en-US', 'English (US)'], ['pt-BR', 'Português (Brasil)'],
];

const Select = ({ label, value, onChange, options, disabled }) => (
  <label className="block">
    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">{label}</span>
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
      className="mt-1 w-full min-h-11 bg-gray-900 text-white border border-gray-600 rounded-lg px-3 text-sm focus:border-emerald-500 outline-none disabled:opacity-60">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  </label>
);

export default function RegionalSettings() {
  const { isOwner } = useAuth();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // {type:'ok'|'err', text}

  useEffect(() => {
    let alive = true;
    api.get('/config/regional')
      .then((r) => { if (alive) setForm(r.data); })
      .catch(() => { if (alive) setForm(false); });
    return () => { alive = false; };
  }, []);

  if (form === null) return null;
  if (form === false) return null; // sin permiso o error: la sección no estorba

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api.put('/config/regional', form);
      setRegional(r.data);
      setMsg({ type: 'ok', text: 'Guardado. Toda la app usa ya esta región.' });
    } catch (e) {
      setMsg({ type: 'err', text: e.response?.data?.detail || 'No se pudo guardar.' });
    } finally {
      setBusy(false);
    }
  };

  // Vista previa con los valores del formulario (sin tocar la config global)
  let preview = '';
  try {
    const money = new Intl.NumberFormat(form.locale, { style: 'currency', currency: form.currency, maximumFractionDigits: 0 }).format(1250000);
    const hora = new Date().toLocaleTimeString(form.locale, { hour: '2-digit', minute: '2-digit', timeZone: form.timezone });
    preview = `${money} · ahora son las ${hora}`;
  } catch { preview = ''; }

  return (
    <div className="bg-gray-800/40 border border-gray-700/50 rounded-2xl p-4 space-y-3">
      <div>
        <h3 className="text-sm font-black text-white uppercase tracking-wide inline-flex items-center gap-1.5">
          <GlobeAmericasIcon className="w-4 h-4 text-emerald-300" /> Región y moneda
        </h3>
        <p className="text-[11px] text-gray-500">Zona horaria y moneda del club — así se muestran horas y plata en toda la app.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Select label="Zona horaria" value={form.timezone} onChange={(v) => setForm({ ...form, timezone: v })} options={TIMEZONES} disabled={!isOwner} />
        <Select label="Moneda" value={form.currency} onChange={(v) => setForm({ ...form, currency: v })} options={CURRENCIES} disabled={!isOwner} />
        <Select label="Formato" value={form.locale} onChange={(v) => setForm({ ...form, locale: v })} options={LOCALES} disabled={!isOwner} />
      </div>
      {preview && <p className="text-xs text-gray-400">Vista previa: <b className="text-emerald-300 font-mono">{preview}</b></p>}
      <div className="flex items-center gap-3 flex-wrap">
        {isOwner ? (
          <button type="button" onClick={save} disabled={busy}
            className="min-h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold uppercase tracking-wide disabled:opacity-50">
            {busy ? 'Guardando…' : 'Guardar región'}
          </button>
        ) : (
          <p className="text-[11px] text-gray-500">Solo el dueño puede cambiar la región.</p>
        )}
        {msg && <p className={`text-xs font-bold ${msg.type === 'ok' ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>}
      </div>
      <p className="text-[11px] text-gray-500">La suscripción a RakeFlow se cobra en pesos colombianos, aparte de la moneda del club.</p>
    </div>
  );
}
