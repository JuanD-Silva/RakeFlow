import { useEffect, useState } from 'react';
import { challengeService } from '../api/services';
import { useAuth } from '../context/AuthContext';

/**
 * Configuración: reto rotativo del mes (PR7 retención). El staff define un
 * objetivo mensual (métrica + meta + recompensa que entrega en caja); el panel
 * del jugador muestra el progreso. Combate el desgaste de los badges fijos.
 * OWNER/MANAGER (el backend lo exige igual).
 */
const METRICS = [
  { key: 'visitas', label: 'Visitas', hint: 'noches que viene al club' },
  { key: 'horas', label: 'Horas', hint: 'horas en mesa cash' },
  { key: 'torneos', label: 'Torneos', hint: 'torneos jugados' },
];

const MONTHS = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export default function MonthlyChallengeManager() {
  const { isOwner, isManager } = useAuth();
  const canManage = isOwner || isManager;
  const [current, setCurrent] = useState(null);
  const [period, setPeriod] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ title: '', description: '', metric: 'visitas', target: '', reward_text: '' });

  const load = async () => {
    try {
      const d = await challengeService.get();
      setCurrent(d.challenge);
      setPeriod(d.period);
      setError(null);
    } catch (e) {
      setError(e.response?.data?.detail || 'No se pudo cargar el reto.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { if (canManage) load(); else setLoading(false); }, [canManage]);

  if (!canManage) return null;

  const startEdit = () => {
    setForm(current
      ? { title: current.title, description: current.description || '', metric: current.metric, target: String(current.target), reward_text: current.reward_text || '' }
      : { title: '', description: '', metric: 'visitas', target: '', reward_text: '' });
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    setError(null);
    const target = parseFloat(form.target);
    if (!form.title.trim()) { setError('Ponele un título al reto.'); return; }
    if (!(target > 0)) { setError('La meta debe ser un número mayor a 0.'); return; }
    setBusy(true);
    try {
      await challengeService.upsert({
        title: form.title.trim(),
        description: form.description.trim() || null,
        metric: form.metric,
        target,
        reward_text: form.reward_text.trim() || null,
      });
      setEditing(false);
      await load();
    } catch (e) {
      setError(e.response?.data?.detail || 'No se pudo guardar el reto.');
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try { await challengeService.clear(); await load(); }
    catch (e) { setError(e.response?.data?.detail || 'No se pudo quitar el reto.'); }
    finally { setBusy(false); }
  };

  const monthName = period ? `${MONTHS[period.month]} ${period.year}` : 'este mes';

  return (
    <div className="bg-gray-800/40 border border-gray-700/50 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-black text-white uppercase tracking-wide">🎯 Reto del mes</h3>
          <p className="text-[11px] text-gray-500">Lo ven los jugadores en su app · {monthName}</p>
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm py-2">Cargando…</p>
      ) : editing ? (
        <div className="space-y-2.5">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={80}
            placeholder="Título (ej. Vení 3 miércoles seguidos)"
            className="w-full bg-gray-900 text-white border border-gray-600 rounded-lg py-2 px-3 text-sm focus:border-violet-500 outline-none" />
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={160}
            placeholder="Descripción corta (opcional)"
            className="w-full bg-gray-900 text-white border border-gray-600 rounded-lg py-2 px-3 text-sm focus:border-violet-500 outline-none" />
          <div className="flex gap-2">
            <select value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })}
              className="flex-1 bg-gray-900 text-white border border-gray-600 rounded-lg py-2 px-2 text-sm focus:border-violet-500 outline-none">
              {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label} ({m.hint})</option>)}
            </select>
            <input type="number" inputMode="numeric" min="1" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })}
              placeholder="Meta"
              className="w-24 bg-gray-900 text-white border border-gray-600 rounded-lg py-2 px-3 text-sm focus:border-violet-500 outline-none" />
          </div>
          <input value={form.reward_text} onChange={(e) => setForm({ ...form, reward_text: e.target.value })} maxLength={120}
            placeholder="Recompensa (ej. Ficha de $20.000) — la entregás en caja"
            className="w-full bg-gray-900 text-white border border-gray-600 rounded-lg py-2 px-3 text-sm focus:border-violet-500 outline-none" />
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-2">
            <button onClick={save} disabled={busy}
              className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-bold py-2 rounded-lg text-xs uppercase">
              {busy ? 'Guardando…' : 'Guardar reto'}
            </button>
            <button onClick={() => setEditing(false)}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold py-2 rounded-lg text-xs uppercase">Cancelar</button>
          </div>
        </div>
      ) : current ? (
        <div className="space-y-2">
          <div className="bg-gray-900/50 rounded-xl px-3 py-2.5">
            <p className="text-white font-bold text-sm">{current.title}</p>
            {current.description && <p className="text-xs text-gray-400 mt-0.5">{current.description}</p>}
            <p className="text-[11px] text-gray-500 mt-1">
              Meta: <b className="text-gray-300">{current.target} {current.metric}</b>
              {current.reward_text && <> · 🎁 {current.reward_text}</>}
            </p>
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-2">
            <button onClick={startEdit} disabled={busy}
              className="flex-1 border border-violet-500/40 text-violet-300 hover:bg-violet-500/10 font-bold py-2 rounded-lg text-xs uppercase">Editar</button>
            <button onClick={clear} disabled={busy}
              className="flex-1 border border-red-500/40 text-red-400 hover:bg-red-500/10 font-bold py-2 rounded-lg text-xs uppercase">Quitar</button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-gray-400">Sin reto este mes. Poné uno y aparece en la app de todos tus jugadores.</p>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button onClick={startEdit}
            className="w-full bg-violet-600 hover:bg-violet-500 text-white font-bold py-2 rounded-lg text-xs uppercase">Crear reto del mes</button>
        </div>
      )}
    </div>
  );
}
