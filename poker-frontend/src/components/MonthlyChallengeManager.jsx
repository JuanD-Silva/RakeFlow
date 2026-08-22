import { useEffect, useState } from 'react';
import { challengeService } from '../api/services';
import { useAuth } from '../context/AuthContext';

/**
 * Configuración: retos rotativos del mes (PR7 retención). El staff define hasta
 * 3 objetivos mensuales (métrica + meta + recompensa que entrega en caja); el
 * panel del jugador muestra el progreso de cada uno. Combate el desgaste de los
 * badges fijos.
 *
 * Cada reto: META ÚNICA (una meta + recompensa) o ESCALONADO (varios tramos de
 * meta creciente, cada uno con su recompensa y una recompensa VIP opcional). El
 * set se guarda EN BLOQUE (el backend reemplaza los activos). OWNER/MANAGER.
 */
const MAX_CHALLENGES = 3;

const METRICS = [
  { key: 'visitas', label: 'Visitas', hint: 'noches que viene al club' },
  { key: 'horas', label: 'Horas', hint: 'horas en mesa cash' },
  { key: 'torneos', label: 'Torneos', hint: 'torneos jugados' },
];

const MONTHS = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// _k = key estable por fila (React reconcilia por key, no por índice → sin salto
// de foco al borrar un tramo del medio). Contador de módulo, solo para el render.
let _tierSeq = 1;
const newTier = () => ({ _k: _tierSeq++, target: '', reward: '', reward_vip: '' });
const emptyForm = () => ({
  title: '', description: '', metric: 'visitas', target: '', reward_text: '',
  escalonado: false, tiers: [newTier()],
});

// Reto cargado (shape del API) → payload de upsert, para reenviar el set completo.
const toUpsert = (ch) => ({
  title: ch.title,
  description: ch.description || null,
  metric: ch.metric,
  target: ch.target,
  reward_text: ch.reward_text || null,
  tiers: ch.tiers?.length
    ? ch.tiers.map((t) => ({ target: t.target, reward: t.reward || null, reward_vip: t.reward_vip || null }))
    : null,
});

const metricLabel = (m) => METRICS.find((x) => x.key === m)?.label.toLowerCase() || m;

export default function MonthlyChallengeManager() {
  const { isOwner, isManager } = useAuth();
  const canManage = isOwner || isManager;
  const [challenges, setChallenges] = useState([]);
  const [period, setPeriod] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // null = lista; -1 = creando uno nuevo; >=0 = editando ese índice del set.
  const [editingIndex, setEditingIndex] = useState(null);
  const [form, setForm] = useState(emptyForm());

  const load = async () => {
    try {
      const d = await challengeService.get();
      setChallenges(d.challenges || []);
      setPeriod(d.period);
      setError(null);
    } catch (e) {
      setError(e.response?.data?.detail || 'No se pudieron cargar los retos.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { if (canManage) load(); else setLoading(false); }, [canManage]);

  if (!canManage) return null;

  const startEdit = (index) => {
    if (index >= 0 && challenges[index]) {
      const ch = challenges[index];
      const tiers = ch.tiers?.length
        ? ch.tiers.map((t) => ({ _k: _tierSeq++, target: String(t.target), reward: t.reward || '', reward_vip: t.reward_vip || '' }))
        : [newTier()];
      setForm({
        title: ch.title,
        description: ch.description || '',
        metric: ch.metric,
        target: String(ch.target),
        reward_text: ch.reward_text || '',
        escalonado: !!ch.tiers?.length,
        tiers,
      });
    } else {
      setForm(emptyForm());
    }
    setError(null);
    setEditingIndex(index);
  };

  // --- edición de tramos ---
  const setTier = (i, key, val) =>
    setForm((f) => ({ ...f, tiers: f.tiers.map((t, j) => (j === i ? { ...t, [key]: val } : t)) }));
  const addTier = () => setForm((f) => ({ ...f, tiers: [...f.tiers, newTier()] }));
  const removeTier = (i) => setForm((f) => ({ ...f, tiers: f.tiers.filter((_, j) => j !== i) }));

  // Valida el form y devuelve el payload del reto, o null (setea error).
  const buildPayload = () => {
    if (!form.title.trim()) { setError('Ponele un título al reto.'); return null; }
    if (form.escalonado) {
      const rows = form.tiers
        .map((t) => ({ ...t, target: parseFloat(t.target) }))
        .filter((t) => t.target > 0 || t.reward.trim() || t.reward_vip.trim());
      if (!rows.length) { setError('Agregá al menos un tramo con su meta.'); return null; }
      for (const t of rows) {
        if (!(t.target > 0) || t.target > 1000) {
          setError('Cada tramo necesita una meta entre 1 y 1000.'); return null;
        }
      }
      const targets = rows.map((t) => t.target);
      for (let i = 1; i < targets.length; i++) {
        if (targets[i] <= targets[i - 1]) {
          setError('Los tramos deben ir en metas ascendentes (ej. 35, 50, 70).'); return null;
        }
      }
      return {
        title: form.title.trim(),
        description: form.description.trim() || null,
        metric: form.metric,
        target: Math.max(...targets),
        reward_text: null,
        tiers: rows.map((t) => ({
          target: t.target,
          reward: t.reward.trim() || null,
          reward_vip: t.reward_vip.trim() || null,
        })),
      };
    }
    const target = parseFloat(form.target);
    if (!(target > 0) || target > 1000) { setError('La meta debe ser un número entre 1 y 1000.'); return null; }
    return {
      title: form.title.trim(),
      description: form.description.trim() || null,
      metric: form.metric,
      target,
      reward_text: form.reward_text.trim() || null,
      tiers: null,
    };
  };

  // Guarda el SET completo (reemplazo en bloque): los otros retos van tal cual,
  // el que se edita/crea se inserta en su lugar.
  const persist = async (set) => {
    setBusy(true);
    try {
      await challengeService.save(set);
      setEditingIndex(null);
      await load();
    } catch (e) {
      const detail = e.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'No se pudo guardar. Prueba de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    setError(null);
    const payload = buildPayload();
    if (!payload) return;
    const set = challenges.map(toUpsert);
    if (editingIndex === -1) set.push(payload);
    else set[editingIndex] = payload;
    persist(set);
  };

  const removeChallenge = (index) => {
    setError(null);
    persist(challenges.map(toUpsert).filter((_, j) => j !== index));
  };

  const monthName = period ? `${MONTHS[period.month]} ${period.year}` : 'este mes';

  return (
    <div className="bg-gray-800/40 border border-gray-700/50 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-white uppercase tracking-wide">🎯 Retos del mes</h3>
          <p className="text-[11px] text-gray-500">Los ven los jugadores en su app · {monthName}</p>
        </div>
        {editingIndex === null && !loading && (
          <span className="text-[10px] font-black text-violet-300/80 nums shrink-0">{challenges.length}/{MAX_CHALLENGES}</span>
        )}
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm py-2">Cargando…</p>
      ) : editingIndex !== null ? (
        <div className="space-y-2.5">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={80}
            placeholder="Título (ej. Festival de Cash de Julio)"
            className="w-full bg-gray-900 text-white border border-gray-600 rounded-lg py-2 px-3 text-sm focus:border-violet-500 outline-none" />
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={160}
            placeholder="Descripción corta (opcional)"
            className="w-full bg-gray-900 text-white border border-gray-600 rounded-lg py-2 px-3 text-sm focus:border-violet-500 outline-none" />

          <select value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })}
            className="w-full bg-gray-900 text-white border border-gray-600 rounded-lg py-2 px-2 text-sm focus:border-violet-500 outline-none">
            {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label} ({m.hint})</option>)}
          </select>

          {/* Toggle meta única / escalonado */}
          <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
            <input type="checkbox" checked={form.escalonado}
              onChange={(e) => setForm({ ...form, escalonado: e.target.checked })}
              className="accent-violet-500 w-4 h-4" />
            Reto escalonado (varias metas, ej. 35 / 50 / 70)
          </label>

          {form.escalonado ? (
            <div className="space-y-2">
              {form.tiers.map((t, i) => (
                <div key={t._k} className="bg-gray-900/60 border border-gray-700/50 rounded-lg p-2 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-violet-300 w-14 shrink-0">Tramo {i + 1}</span>
                    <input type="number" inputMode="numeric" min="1" max="1000" value={t.target}
                      onChange={(e) => setTier(i, 'target', e.target.value)} placeholder="Meta"
                      className="w-20 bg-gray-900 text-white border border-gray-600 rounded-lg py-1.5 px-2 text-sm focus:border-violet-500 outline-none" />
                    <span className="text-[11px] text-gray-500">{metricLabel(form.metric)}</span>
                    {form.tiers.length > 1 && (
                      <button onClick={() => removeTier(i)} type="button"
                        className="ml-auto text-red-400/80 hover:text-red-400 text-xs font-bold px-1.5">✕</button>
                    )}
                  </div>
                  <input value={t.reward} onChange={(e) => setTier(i, 'reward', e.target.value)} maxLength={120}
                    placeholder="Recompensa (ej. Bono $100.000)"
                    className="w-full bg-gray-900 text-white border border-gray-600 rounded-lg py-1.5 px-2 text-xs focus:border-violet-500 outline-none" />
                  <input value={t.reward_vip} onChange={(e) => setTier(i, 'reward_vip', e.target.value)} maxLength={120}
                    placeholder="💎 Recompensa VIP (opcional, ej. Bono $150.000)"
                    className="w-full bg-gray-900 text-cyan-200 border border-cyan-700/40 rounded-lg py-1.5 px-2 text-xs focus:border-cyan-500 outline-none" />
                </div>
              ))}
              {form.tiers.length < 5 && (
                <button onClick={addTier} type="button"
                  className="w-full border border-dashed border-violet-500/40 text-violet-300 hover:bg-violet-500/10 font-bold py-1.5 rounded-lg text-xs">
                  + Agregar tramo
                </button>
              )}
              <p className="text-[10px] text-gray-500">El VIP ve su recompensa; el resto ve la base. Las entregás en caja.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="flex gap-2">
                <input type="number" inputMode="numeric" min="1" max="1000" value={form.target}
                  onChange={(e) => setForm({ ...form, target: e.target.value })} placeholder="Meta"
                  className="w-24 bg-gray-900 text-white border border-gray-600 rounded-lg py-2 px-3 text-sm focus:border-violet-500 outline-none" />
                <span className="text-xs text-gray-500 self-center">{metricLabel(form.metric)} en el mes</span>
              </div>
              <input value={form.reward_text} onChange={(e) => setForm({ ...form, reward_text: e.target.value })} maxLength={120}
                placeholder="Recompensa (ej. Ficha de $20.000) — la entregás en caja"
                className="w-full bg-gray-900 text-white border border-gray-600 rounded-lg py-2 px-3 text-sm focus:border-violet-500 outline-none" />
            </div>
          )}

          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-2">
            <button onClick={save} disabled={busy}
              className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-bold py-2 rounded-lg text-xs uppercase">
              {busy ? 'Guardando…' : (editingIndex === -1 ? 'Crear reto' : 'Guardar reto')}
            </button>
            <button onClick={() => { setEditingIndex(null); setError(null); }}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold py-2 rounded-lg text-xs uppercase">Cancelar</button>
          </div>
        </div>
      ) : challenges.length ? (
        <div className="space-y-2">
          {challenges.map((ch, i) => (
            <div key={ch.id ?? i} className="bg-gray-900/50 rounded-xl px-3 py-2.5">
              <p className="text-white font-bold text-sm">{ch.title}</p>
              {ch.description && <p className="text-xs text-gray-400 mt-0.5">{ch.description}</p>}
              {ch.tiers?.length ? (
                <div className="mt-1.5 space-y-0.5">
                  {ch.tiers.map((t, j) => (
                    <p key={j} className="text-[11px] text-gray-400">
                      <b className="text-violet-300">{t.target} {metricLabel(ch.metric)}</b>
                      {t.reward && <> → 🎁 {t.reward}</>}
                      {t.reward_vip && <span className="text-cyan-300"> · 💎 {t.reward_vip}</span>}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-gray-500 mt-1">
                  Meta: <b className="text-gray-300">{ch.target} {metricLabel(ch.metric)}</b>
                  {ch.reward_text && <> · 🎁 {ch.reward_text}</>}
                </p>
              )}
              <div className="flex gap-2 mt-2">
                <button onClick={() => startEdit(i)} disabled={busy}
                  className="flex-1 border border-violet-500/40 text-violet-300 hover:bg-violet-500/10 font-bold py-1.5 rounded-lg text-[11px] uppercase">Editar</button>
                <button onClick={() => removeChallenge(i)} disabled={busy}
                  className="flex-1 border border-red-500/40 text-red-400 hover:bg-red-500/10 font-bold py-1.5 rounded-lg text-[11px] uppercase">Quitar</button>
              </div>
            </div>
          ))}
          {error && <p className="text-red-400 text-xs">{error}</p>}
          {challenges.length < MAX_CHALLENGES && (
            <button onClick={() => startEdit(-1)} disabled={busy}
              className="w-full border border-dashed border-violet-500/40 text-violet-300 hover:bg-violet-500/10 font-bold py-2 rounded-lg text-xs uppercase">
              + Agregar reto ({challenges.length}/{MAX_CHALLENGES})
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-gray-400">Sin retos este mes. Poné hasta {MAX_CHALLENGES} y aparecen en la app de todos tus jugadores.</p>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button onClick={() => startEdit(-1)}
            className="w-full bg-violet-600 hover:bg-violet-500 text-white font-bold py-2 rounded-lg text-xs uppercase">Crear reto del mes</button>
        </div>
      )}
    </div>
  );
}
