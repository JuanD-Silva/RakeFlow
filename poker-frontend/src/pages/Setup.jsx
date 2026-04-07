import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../api/axios';
import {
  CurrencyDollarIcon,
  UserGroupIcon,
  TrashIcon,
  PlusCircleIcon,
  CheckBadgeIcon,
  ChartPieIcon,
  ArrowRightIcon,
  ArrowLeftIcon,
  RocketLaunchIcon
} from '@heroicons/react/24/outline';

export default function Setup() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const [transitioning, setTransitioning] = useState(false);

  const [wantsMeta, setWantsMeta] = useState(null); // null = no elegido, true/false
  const [goal, setGoal] = useState('');
  const [partners, setPartners] = useState([
    { name: 'Socio Principal', percentage: 100 }
  ]);
  const [totalPercent, setTotalPercent] = useState(100);

  useEffect(() => {
    const sum = partners.reduce((acc, curr) => acc + (parseFloat(curr.percentage) || 0), 0);
    setTotalPercent(sum);
  }, [partners]);

  const changeStep = (newStep) => {
    setTransitioning(true);
    setTimeout(() => {
      setStep(newStep);
      setTransitioning(false);
    }, 200);
  };

  const addPartner = () => {
    setPartners([...partners, { name: '', percentage: 0 }]);
  };

  const removePartner = (index) => {
    setPartners(partners.filter((_, i) => i !== index));
  };

  const updatePartner = (index, field, value) => {
    const updated = [...partners];
    updated[index][field] = value;
    setPartners(updated);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (Math.round(totalPercent) !== 100 || partners.some(p => p.name.trim() === '')) return;

    setLoading(true);
    try {
      const finalGoal = goal === '' ? 0 : parseFloat(goal);
      await api.post('/config/initial-setup', {
        monthly_goal: finalGoal,
        partners: partners.map(p => ({
          name: p.name,
          percentage: parseFloat(p.percentage)
        }))
      });

      // Verificar si tiene suscripcion, si no ir a subscribe
      try {
        const subRes = await api.get('/payments/status');
        navigate(subRes.data.subscription_active ? '/dashboard' : '/subscribe');
      } catch {
        navigate('/subscribe');
      }
    } catch (error) {
      console.error(error);
      alert("Error guardando configuracion: " + (error.response?.data?.detail || error.message));
    } finally {
      setLoading(false);
    }
  };

  const isValid = Math.round(totalPercent) === 100 && partners.every(p => p.name.trim() !== '');

  const stepLabels = ['Registro', 'Meta', 'Socios'];

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0f1a] px-4 py-10 font-sans relative noise-bg">

      {/* Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] right-[-5%] w-[400px] h-[400px] bg-emerald-600/6 rounded-full blur-[120px] animate-drift"></div>
        <div className="absolute bottom-[-10%] left-[-5%] w-[400px] h-[400px] bg-violet-600/5 rounded-full blur-[100px] animate-drift delay-500"></div>
        <div className="absolute inset-0 opacity-[0.015]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)', backgroundSize: '80px 80px' }}></div>
      </div>

      <div className="relative z-10 max-w-lg w-full">

        {/* Logo */}
        <div className="text-center mb-6 animate-fade-up">
          <Link to="/" className="inline-flex items-center gap-2 group">
            <div className="bg-gradient-to-br from-emerald-600 to-green-900 p-2 rounded-xl border border-emerald-500/30 group-hover:shadow-lg group-hover:shadow-emerald-500/20 transition-all">
              <span className="text-xl leading-none">💸</span>
            </div>
            <span className="text-white font-black text-2xl tracking-tighter uppercase">
              Rake<span className="text-emerald-500">Flow</span>
            </span>
          </Link>
        </div>

        {/* Stepper */}
        <div className="animate-fade-up delay-100 flex items-center justify-center gap-3 mb-8">
          {stepLabels.map((label, i) => {
            const stepNum = i + 1;
            const isCompleted = (stepNum === 1) || (stepNum < step + 1);
            const isCurrent = stepNum === step + 1;
            return (
              <div key={i} className="flex items-center gap-2">
                {i > 0 && (
                  <div className={`w-8 h-px transition-all duration-500 ${isCompleted ? 'bg-emerald-500' : 'bg-gray-700'}`}></div>
                )}
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black transition-all duration-500 ${
                    isCompleted ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' :
                    isCurrent ? 'bg-gray-700 text-white ring-2 ring-emerald-500/30' :
                    'bg-gray-800 text-gray-500'
                  }`}>
                    {isCompleted && stepNum === 1 ? <CheckBadgeIcon className="w-4 h-4" /> : stepNum}
                  </div>
                  <span className={`text-xs font-bold uppercase tracking-wider hidden sm:inline transition-colors duration-300 ${
                    isCompleted ? 'text-emerald-400' : isCurrent ? 'text-white' : 'text-gray-600'
                  }`}>{label}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* STEPS */}
        <div className={`transition-all duration-200 ${transitioning ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}>

          {/* STEP 1: Meta Mensual */}
          {step === 1 && (
            <div className="bg-gray-800/30 backdrop-blur-xl p-8 rounded-3xl border border-gray-700/50 shadow-2xl shadow-black/20">
              <div className="text-center mb-8 animate-fade-up delay-200">
                <div className="mx-auto w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center mb-4 border border-emerald-500/20 animate-scale-in delay-300">
                  <CurrencyDollarIcon className="w-8 h-8 text-emerald-400" />
                </div>
                <h2 className="text-2xl font-black text-white tracking-tight">Gastos Fijos</h2>
                <p className="text-gray-500 mt-2 text-sm">
                  ¿Tu club tiene un monto fijo mensual que debe cubrir? (alquiler, servicios, deudas, etc.)
                </p>
              </div>

              {/* Toggle SI/NO */}
              <div className="animate-fade-up delay-400 grid grid-cols-1 gap-3 mb-6">
                <button
                  type="button"
                  onClick={() => setWantsMeta(true)}
                  className={`group relative rounded-2xl p-5 text-left transition-all duration-300 active:scale-[0.98] border overflow-hidden ${
                    wantsMeta === true
                      ? 'bg-emerald-500/10 border-emerald-500/40 shadow-lg shadow-emerald-900/20 ring-1 ring-emerald-500/20'
                      : 'bg-gray-900/30 border-gray-700 hover:border-gray-600 hover:bg-gray-800/40'
                  }`}
                >
                  {wantsMeta === true && <div className="absolute inset-0 bg-emerald-500/5"></div>}
                  <div className="relative flex items-start gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 border transition-all duration-300 ${
                      wantsMeta === true
                        ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
                        : 'bg-gray-800 border-gray-700 text-gray-500 group-hover:text-gray-400'
                    }`}>
                      <CurrencyDollarIcon className="w-6 h-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`font-black text-base transition-colors ${wantsMeta === true ? 'text-emerald-300' : 'text-gray-300'}`}>
                        Si, tengo gastos fijos
                      </p>
                      <p className={`text-xs mt-1 leading-relaxed transition-colors ${wantsMeta === true ? 'text-emerald-400/60' : 'text-gray-500'}`}>
                        Alquiler, servicios o deudas con un monto fijo mensual que se descuenta primero del rake.
                      </p>
                    </div>
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-1 transition-all duration-300 ${
                      wantsMeta === true
                        ? 'border-emerald-500 bg-emerald-500'
                        : 'border-gray-600 group-hover:border-gray-500'
                    }`}>
                      {wantsMeta === true && <div className="w-2 h-2 rounded-full bg-white"></div>}
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => { setWantsMeta(false); setGoal(''); }}
                  className={`group relative rounded-2xl p-5 text-left transition-all duration-300 active:scale-[0.98] border overflow-hidden ${
                    wantsMeta === false
                      ? 'bg-violet-500/10 border-violet-500/40 shadow-lg shadow-violet-900/20 ring-1 ring-violet-500/20'
                      : 'bg-gray-900/30 border-gray-700 hover:border-gray-600 hover:bg-gray-800/40'
                  }`}
                >
                  {wantsMeta === false && <div className="absolute inset-0 bg-violet-500/5"></div>}
                  <div className="relative flex items-start gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 border transition-all duration-300 ${
                      wantsMeta === false
                        ? 'bg-violet-500/20 border-violet-500/30 text-violet-400'
                        : 'bg-gray-800 border-gray-700 text-gray-500 group-hover:text-gray-400'
                    }`}>
                      <ChartPieIcon className="w-6 h-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`font-black text-base transition-colors ${wantsMeta === false ? 'text-violet-300' : 'text-gray-300'}`}>
                        No, solo repartir por porcentaje
                      </p>
                      <p className={`text-xs mt-1 leading-relaxed transition-colors ${wantsMeta === false ? 'text-violet-400/60' : 'text-gray-500'}`}>
                        Todo el rake se reparte entre socios por porcentaje. Puedes asignar uno para gastos (ej: "Caja" al 20%).
                      </p>
                    </div>
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-1 transition-all duration-300 ${
                      wantsMeta === false
                        ? 'border-violet-500 bg-violet-500'
                        : 'border-gray-600 group-hover:border-gray-500'
                    }`}>
                      {wantsMeta === false && <div className="w-2 h-2 rounded-full bg-white"></div>}
                    </div>
                  </div>
                </button>
              </div>

              {/* Input de meta (solo si eligió SI) */}
              {wantsMeta === true && (
                <div className="animate-fade-up">
                  <label className="block text-gray-400 text-xs font-bold mb-2 ml-1 uppercase tracking-wider">
                    Meta mensual (monto fijo)
                  </label>
                  <div className="relative mb-4">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-2xl font-light">$</span>
                    <input
                      type="number"
                      value={goal}
                      onChange={(e) => setGoal(e.target.value)}
                      className="w-full bg-gray-900/60 text-white border border-gray-600 rounded-xl py-4 pl-10 pr-4 focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 outline-none font-mono text-3xl font-bold placeholder-gray-600 transition-all"
                      placeholder="0"
                      min="0"
                    />
                  </div>
                  <p className="text-gray-600 text-xs mb-4 px-1">
                    Este monto se descuenta primero del rake de cada sesion. Cuando se alcance la meta en el mes, el resto va a los socios.
                  </p>
                </div>
              )}

              {/* Tip si eligió NO */}
              {wantsMeta === false && (
                <div className="animate-fade-up bg-violet-500/5 border border-violet-500/10 rounded-xl p-4 mb-6">
                  <p className="text-violet-300 text-sm font-bold mb-1">Tip: Gastos como porcentaje</p>
                  <p className="text-gray-400 text-xs leading-relaxed">
                    En el siguiente paso puedes agregar un "socio" llamado <span className="text-white font-bold">"Gastos"</span> o <span className="text-white font-bold">"Caja"</span> y asignarle un porcentaje del rake (ej: 20%). Asi separas automaticamente un fondo para gastos sin necesidad de una meta fija.
                  </p>
                </div>
              )}

              <button
                onClick={() => changeStep(2)}
                disabled={wantsMeta === null}
                className={`w-full py-4 rounded-xl font-bold text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
                  wantsMeta !== null
                    ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white shadow-lg shadow-emerald-900/20 hover:shadow-[0_0_30px_rgba(16,185,129,0.3)]'
                    : 'bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700'
                }`}
              >
                Siguiente <ArrowRightIcon className="w-5 h-5" />
              </button>
            </div>
          )}

          {/* STEP 2: Socios */}
          {step === 2 && (
            <div className="bg-gray-800/30 backdrop-blur-xl p-8 rounded-3xl border border-gray-700/50 shadow-2xl shadow-black/20">
              <div className="text-center mb-6 animate-fade-up">
                <div className="mx-auto w-16 h-16 bg-violet-500/10 rounded-2xl flex items-center justify-center mb-4 border border-violet-500/20 animate-scale-in delay-100">
                  <ChartPieIcon className="w-8 h-8 text-violet-400" />
                </div>
                <h2 className="text-2xl font-black text-white tracking-tight">Distribucion de Socios</h2>
                <p className="text-gray-500 mt-2 text-sm">
                  {wantsMeta
                    ? 'Despues de cubrir la meta fija, como se reparten las ganancias?'
                    : 'Define como se reparte el rake. Puedes agregar un "socio" para gastos (ej: Caja 20%).'
                  }
                  {' '}Los porcentajes deben sumar 100%.
                </p>
              </div>

              {/* Barra de progreso */}
              <div className="mb-6 animate-fade-up delay-200">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs text-gray-500 font-bold uppercase tracking-wider">Total asignado</span>
                  <span className={`font-mono font-black text-sm transition-colors ${isValid ? 'text-emerald-400' : 'text-red-400'}`}>
                    {totalPercent}%
                  </span>
                </div>
                <div className="h-2.5 w-full bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 rounded-full ${isValid ? 'bg-emerald-500' : totalPercent > 100 ? 'bg-red-500' : 'bg-amber-500'}`}
                    style={{ width: `${Math.min(totalPercent, 100)}%` }}
                  ></div>
                </div>
              </div>

              {/* Lista de socios */}
              <div className="space-y-3 mb-4 max-h-[40vh] overflow-y-auto">
                {partners.map((partner, index) => (
                  <div key={index} className="animate-fade-up flex items-center gap-3 bg-gray-900/40 p-3 rounded-xl border border-gray-700/50 hover:border-gray-600 transition-all" style={{ animationDelay: `${300 + index * 80}ms` }}>
                    <div className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400 flex-shrink-0">
                      <UserGroupIcon className="w-4 h-4" />
                    </div>
                    <input
                      type="text"
                      value={partner.name}
                      onChange={(e) => updatePartner(index, 'name', e.target.value)}
                      placeholder="Nombre del socio"
                      className="flex-1 bg-transparent text-white text-sm font-bold outline-none placeholder-gray-600 border-b border-transparent focus:border-violet-500/50 pb-0.5 transition-colors min-w-0"
                    />
                    <div className="relative w-20 flex-shrink-0">
                      <input
                        type="number"
                        value={partner.percentage}
                        onChange={(e) => updatePartner(index, 'percentage', e.target.value)}
                        className="w-full bg-black/20 border border-gray-600 rounded-lg py-2 px-2 text-right text-white font-mono text-sm focus:border-violet-500 focus:ring-1 focus:ring-violet-500/50 outline-none transition-all pr-7"
                        placeholder="0"
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs pointer-events-none">%</span>
                    </div>
                    {partners.length > 1 && (
                      <button onClick={() => removePartner(index)} className="p-2 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-400/10 transition-colors flex-shrink-0">
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <button onClick={addPartner} className="animate-fade-up delay-400 w-full py-3 mb-6 rounded-xl border border-dashed border-gray-600 text-gray-500 hover:text-violet-400 hover:border-violet-500/50 hover:bg-violet-500/5 transition-all text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2">
                <PlusCircleIcon className="w-5 h-5" /> Agregar Socio
              </button>

              {/* Botones */}
              <div className="animate-fade-up delay-500 flex gap-3">
                <button onClick={() => changeStep(1)} className="flex-shrink-0 py-4 px-5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold transition-colors border border-gray-700 active:scale-[0.97]">
                  <ArrowLeftIcon className="w-5 h-5" />
                </button>
                <button
                  onClick={handleSave}
                  disabled={loading || !isValid}
                  className={`flex-1 py-4 rounded-xl font-bold text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
                    isValid
                      ? 'bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white shadow-lg shadow-emerald-900/20 hover:shadow-[0_0_30px_rgba(16,185,129,0.3)]'
                      : 'bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700'
                  }`}
                >
                  {loading ? (
                    <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> Guardando...</>
                  ) : isValid ? (
                    <><RocketLaunchIcon className="w-5 h-5" /> Finalizar y Entrar</>
                  ) : (
                    `Ajusta los % a 100% (${totalPercent}%)`
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
