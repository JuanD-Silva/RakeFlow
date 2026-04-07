import { useState, useEffect, useRef } from 'react';
import api from '../api/axios';
import {
  CurrencyDollarIcon,
  ChartPieIcon,
  CalendarIcon,
  TrashIcon,
  PlusCircleIcon,
  CheckBadgeIcon,
  ArrowPathIcon,
  Cog6ToothIcon,
  InformationCircleIcon,
  ExclamationTriangleIcon,
  ChevronDownIcon
} from '@heroicons/react/24/outline';

const RULE_OPTIONS = [
  {
    value: 'FIXED',
    label: 'Monto Fijo',
    desc: 'Se descuenta un monto exacto cada sesion',
    icon: CurrencyDollarIcon,
    iconBg: 'bg-amber-500/10',
    iconBorder: 'border-amber-500/20',
    iconText: 'text-amber-400',
    focusRing: 'focus-within:border-amber-500/50',
  },
  {
    value: 'PERCENTAGE',
    label: 'Porcentaje',
    desc: 'Se calcula sobre lo que quede disponible',
    icon: ChartPieIcon,
    iconBg: 'bg-blue-500/10',
    iconBorder: 'border-blue-500/20',
    iconText: 'text-blue-400',
    focusRing: 'focus-within:border-blue-500/50',
  },
  {
    value: 'QUOTA',
    label: 'Meta Mensual',
    desc: 'Se acumula hasta la meta y luego se detiene',
    icon: CalendarIcon,
    iconBg: 'bg-emerald-500/10',
    iconBorder: 'border-emerald-500/20',
    iconText: 'text-emerald-400',
    focusRing: 'focus-within:border-emerald-500/50',
  },
];

function getTypeInfo(ruleType) {
  return RULE_OPTIONS.find(o => o.value === ruleType) || RULE_OPTIONS[1];
}

// Dropdown custom para tablet
function TypeSelector({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = getTypeInfo(value);

  useEffect(() => {
    const handleClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('touchstart', handleClick);
    return () => { document.removeEventListener('mousedown', handleClick); document.removeEventListener('touchstart', handleClick); };
  }, []);

  return (
    <div className="relative" ref={ref}>
      {/* BOTON TRIGGER */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full bg-gray-900 border border-gray-600 rounded-xl p-4 flex items-center gap-3 text-left transition-colors hover:border-gray-500 active:bg-gray-800"
      >
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border ${current.iconBg} ${current.iconBorder}`}>
          <current.icon className={`w-5 h-5 ${current.iconText}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm">{current.label}</p>
          <p className="text-gray-500 text-xs truncate">{current.desc}</p>
        </div>
        <ChevronDownIcon className={`w-5 h-5 text-gray-500 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* DROPDOWN PANEL */}
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-2 bg-gray-900 border border-gray-600 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden">
          {RULE_OPTIONS.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => { onChange(option.value); setOpen(false); }}
                className={`w-full p-4 flex items-center gap-3 text-left transition-colors active:bg-gray-700 ${
                  isSelected ? 'bg-gray-800' : 'hover:bg-gray-800/60'
                }`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border ${option.iconBg} ${option.iconBorder}`}>
                  <option.icon className={`w-5 h-5 ${option.iconText}`} />
                </div>
                <div className="flex-1">
                  <p className={`font-bold text-sm ${isSelected ? 'text-white' : 'text-gray-300'}`}>{option.label}</p>
                  <p className="text-gray-500 text-xs">{option.desc}</p>
                </div>
                {isSelected && (
                  <div className="w-2 h-2 rounded-full bg-violet-500 flex-shrink-0"></div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ConfigPanel() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => { loadRules(); }, []);

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const loadRules = async () => {
    setLoading(true);
    try {
      const res = await api.get('/config/distribution');
      if (res.data.length > 0) {
        setRules(res.data.map(r => ({
          name: r.name, rule_type: r.rule_type, value: r.value, priority: r.priority
        })));
      } else {
        setRules([
          { name: 'Meta Mensual (Fijos)', rule_type: 'QUOTA', value: 0, priority: 1 },
          { name: 'Socio Principal', rule_type: 'PERCENTAGE', value: 100, priority: 2 }
        ]);
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Error cargando reglas.' });
    } finally {
      setLoading(false);
    }
  };

  const updateRule = (index, field, value) => {
    const updated = [...rules];
    updated[index][field] = value;
    setRules(updated);
  };

  const addRule = () => {
    const maxPriority = Math.max(...rules.map(r => r.priority), 0);
    setRules([...rules, { name: '', rule_type: 'PERCENTAGE', value: 0, priority: maxPriority + 1 }]);
  };

  const removeRule = (index) => {
    setRules(rules.filter((_, i) => i !== index));
  };

  const percentRules = rules.filter(r => r.rule_type === 'PERCENTAGE');
  const totalPercent = percentRules.reduce((acc, r) => acc + (parseFloat(r.value) || 0), 0);
  const isPercentValid = percentRules.length === 0 || Math.round(totalPercent) === 100;

  const handleSave = async () => {
    if (!isPercentValid) {
      setMessage({ type: 'error', text: `Los porcentajes deben sumar 100%. Actual: ${totalPercent}%` });
      return;
    }
    if (rules.some(r => !r.name.trim())) {
      setMessage({ type: 'error', text: 'Todas las reglas deben tener nombre.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api.post('/config/distribution', rules.map(r => ({
        name: r.name.trim(), rule_type: r.rule_type,
        value: parseFloat(r.value) || 0, priority: r.priority
      })));
      setMessage({ type: 'success', text: 'Reglas guardadas correctamente.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.detail || 'Error guardando.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-64 space-y-4">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-violet-500"></div>
      <p className="text-gray-500 font-mono text-sm">Cargando reglas...</p>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in pb-24">

      {/* HEADER */}
      <div className="bg-gray-800/40 rounded-2xl border border-gray-700/50 p-6 backdrop-blur-sm">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 bg-violet-500/10 rounded-2xl flex items-center justify-center border border-violet-500/20 flex-shrink-0">
            <Cog6ToothIcon className="w-7 h-7 text-violet-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-black text-white tracking-tight uppercase">Reglas de Negocio</h2>
            <p className="text-gray-500 text-sm mt-1">
              Al cerrar cada sesion, el rake se distribuye en orden de prioridad.
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowHelp(!showHelp)}
          className="mt-4 flex items-center gap-2 text-violet-400/70 hover:text-violet-300 text-xs font-bold uppercase tracking-wider transition-colors w-full"
        >
          <InformationCircleIcon className="w-4 h-4" />
          {showHelp ? 'Ocultar ayuda' : 'Como funciona el orden?'}
        </button>

        {showHelp && (
          <div className="mt-3 bg-black/30 rounded-xl p-4 border border-gray-700/50 space-y-3 text-sm text-gray-400">
            <p>
              <span className="text-white font-bold">La prioridad define quien cobra primero.</span> El sistema recorre las reglas en orden (#1, #2, #3...):
            </p>
            <div className="space-y-2 pl-1">
              <div className="flex items-start gap-3">
                <span className="bg-amber-500/20 text-amber-400 font-mono text-xs font-black px-2 py-1 rounded flex-shrink-0">#1</span>
                <span>Primero se pagan gastos fijos o metas mensuales.</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="bg-blue-500/20 text-blue-400 font-mono text-xs font-black px-2 py-1 rounded flex-shrink-0">#2</span>
                <span>Lo que sobre se reparte por porcentaje entre socios.</span>
              </div>
            </div>
            <p className="text-gray-500 text-xs border-t border-gray-700/50 pt-3">
              Usa las flechas para cambiar el orden. Si dos reglas tienen la misma prioridad, se procesan sobre la misma base.
            </p>
          </div>
        )}
      </div>

      {/* MENSAJE */}
      {message && (
        <div className={`p-4 rounded-xl text-sm font-bold flex items-center gap-3 ${
          message.type === 'success'
            ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
            : 'bg-red-500/10 border border-red-500/30 text-red-400'
        }`}>
          {message.type === 'success'
            ? <CheckBadgeIcon className="w-5 h-5 flex-shrink-0" />
            : <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0" />
          }
          {message.text}
        </div>
      )}

      {/* REGLAS */}
      <div className="space-y-4">
        {rules.map((rule, index) => {
          const typeInfo = getTypeInfo(rule.rule_type);

          return (
            <div key={index} className="bg-gray-800/60 rounded-2xl border border-gray-700/50 transition-all">

              {/* CABECERA: Nombre + Prioridad + Borrar */}
              <div className="flex items-end gap-3 p-4 pb-3">

                {/* Nombre */}
                <div className="flex-1 min-w-0">
                  <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block mb-1 pl-1">Nombre</label>
                  <input
                    type="text"
                    value={rule.name}
                    onChange={(e) => updateRule(index, 'name', e.target.value)}
                    placeholder="Ej: Alquiler, Socio Juan..."
                    className="w-full bg-gray-900 border border-gray-600 rounded-xl py-3 px-4 text-white text-base font-bold outline-none focus:border-violet-500/50 transition-colors placeholder-gray-600"
                  />
                </div>

                {/* Prioridad editable */}
                <div className="w-20 flex-shrink-0">
                  <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block mb-1 pl-1">Orden</label>
                  <input
                    type="number"
                    value={rule.priority}
                    onChange={(e) => updateRule(index, 'priority', parseInt(e.target.value) || 1)}
                    min="1"
                    className="w-full bg-gray-900 border border-gray-600 rounded-xl py-3 px-2 text-center text-white font-mono text-base font-bold outline-none focus:border-violet-500/50 transition-colors"
                  />
                </div>

                {/* Eliminar */}
                {rules.length > 1 && (
                  <button
                    onClick={() => removeRule(index)}
                    className="p-3 rounded-xl text-gray-600 hover:text-red-400 hover:bg-red-400/10 transition-colors active:bg-red-400/20 flex-shrink-0"
                  >
                    <TrashIcon className="w-5 h-5" />
                  </button>
                )}
              </div>

              {/* CUERPO: Tipo + Valor */}
              <div className="px-4 pb-4 space-y-3">
                {/* Tipo (dropdown custom) */}
                <div>
                  <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block mb-1 pl-1">Tipo de regla</label>
                  <TypeSelector
                    value={rule.rule_type}
                    onChange={(val) => updateRule(index, 'rule_type', val)}
                  />
                </div>

                {/* Valor */}
                <div>
                  <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block mb-1 pl-1">
                    {rule.rule_type === 'PERCENTAGE' ? 'Porcentaje' : rule.rule_type === 'QUOTA' ? 'Meta mensual' : 'Monto por sesion'}
                  </label>
                  <div className="relative">
                    {rule.rule_type !== 'PERCENTAGE' && (
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-bold pointer-events-none">$</span>
                    )}
                    <input
                      type="number"
                      value={rule.value}
                      onChange={(e) => updateRule(index, 'value', e.target.value)}
                      className={`w-full bg-gray-900 border border-gray-600 rounded-xl py-3 text-white font-mono text-lg font-bold outline-none focus:ring-1 transition-all ${
                        rule.rule_type === 'PERCENTAGE'
                          ? 'text-right pr-10 pl-4 focus:border-blue-500 focus:ring-blue-500/50'
                          : 'text-right pr-4 pl-8 focus:border-amber-500 focus:ring-amber-500/50'
                      }`}
                      placeholder="0"
                      min="0"
                    />
                    {rule.rule_type === 'PERCENTAGE' && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-lg font-bold pointer-events-none">%</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* AGREGAR */}
      <button
        onClick={addRule}
        className="w-full py-5 rounded-2xl border-2 border-dashed border-gray-700 text-gray-500 hover:text-violet-400 hover:border-violet-500/40 hover:bg-violet-500/5 transition-all text-sm font-bold uppercase tracking-widest flex items-center justify-center gap-2 active:bg-violet-500/10"
      >
        <PlusCircleIcon className="w-6 h-6" />
        Agregar Regla
      </button>

      {/* RESUMEN PORCENTAJES */}
      {percentRules.length > 0 && (
        <div className={`rounded-2xl border p-5 ${
          isPercentValid ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20'
        }`}>
          <div className="flex items-center justify-between mb-3">
            <span className={`text-sm font-bold ${isPercentValid ? 'text-emerald-400' : 'text-red-400'}`}>
              Total porcentajes
            </span>
            <span className={`font-mono text-3xl font-black ${isPercentValid ? 'text-emerald-400' : 'text-red-400'}`}>
              {totalPercent}%
            </span>
          </div>
          <div className="h-3 w-full bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ease-out rounded-full ${isPercentValid ? 'bg-emerald-500' : 'bg-red-500'}`}
              style={{ width: `${Math.min(totalPercent, 100)}%` }}
            ></div>
          </div>
          {!isPercentValid && (
            <p className="text-red-400/70 text-xs mt-2 font-medium">
              {totalPercent < 100 ? `Faltan ${(100 - totalPercent).toFixed(1)}% por asignar.` : `Excede por ${(totalPercent - 100).toFixed(1)}%.`}
            </p>
          )}
        </div>
      )}

      {/* ACCIONES (sticky) */}
      <div className="fixed bottom-0 left-0 right-0 bg-gray-900/95 backdrop-blur-md border-t border-gray-700/50 p-4 z-40">
        <div className="max-w-2xl mx-auto flex gap-3">
          <button
            onClick={loadRules}
            className="py-4 px-5 rounded-2xl bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold text-sm flex items-center justify-center gap-2 transition-colors border border-gray-700 active:bg-gray-600"
          >
            <ArrowPathIcon className="w-5 h-5" />
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !isPercentValid}
            className={`flex-1 py-4 rounded-2xl font-bold text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
              isPercentValid
                ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white shadow-lg shadow-violet-900/30'
                : 'bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700'
            }`}
          >
            {saving ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                Guardando...
              </>
            ) : isPercentValid ? (
              <>
                <CheckBadgeIcon className="w-6 h-6" />
                Guardar Cambios
              </>
            ) : (
              `Ajusta los % a 100%`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
