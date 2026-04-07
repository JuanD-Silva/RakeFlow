import { useState } from 'react';
import {
  PlayCircleIcon,
  ClockIcon,
  ChartBarIcon,
  TrophyIcon,
  Cog6ToothIcon,
  ArrowRightIcon,
  ArrowLeftIcon,
  CheckBadgeIcon,
  BanknotesIcon,
  UserGroupIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';

const steps = [
  {
    icon: PlayCircleIcon,
    emoji: '♠️',
    title: 'Bienvenido a RakeFlow',
    subtitle: 'Tu sistema de gestion de club',
    desc: 'Vamos a hacer un recorrido rapido por las secciones principales para que sepas donde encontrar todo.',
    color: 'emerald',
    iconBg: 'bg-emerald-500/10 border-emerald-500/20',
    iconText: 'text-emerald-400',
  },
  {
    icon: BanknotesIcon,
    emoji: '💰',
    title: 'Mesa Activa',
    subtitle: 'Cash Games y Torneos',
    desc: 'Desde aqui inicias partidas de cash o torneos. Registras buy-ins, cashouts, rebuys y cierras caja al final con auditoria automatica.',
    tip: 'La sesion no se crea hasta que registres el primer jugador.',
    color: 'emerald',
    iconBg: 'bg-emerald-500/10 border-emerald-500/20',
    iconText: 'text-emerald-400',
  },
  {
    icon: ClockIcon,
    emoji: '📋',
    title: 'Historial',
    subtitle: 'Sesiones pasadas',
    desc: 'Consulta el detalle de cada sesion cerrada: cuanto se genero, como se distribuyo y el resultado de cada jugador.',
    color: 'blue',
    iconBg: 'bg-blue-500/10 border-blue-500/20',
    iconText: 'text-blue-400',
  },
  {
    icon: ChartBarIcon,
    emoji: '📊',
    title: 'Caja Semanal',
    subtitle: 'Reportes financieros',
    desc: 'Visualiza el rake generado por semana o mes. Ve cuanto se fue a meta, cuanto a socios y el progreso de la meta mensual.',
    color: 'violet',
    iconBg: 'bg-violet-500/10 border-violet-500/20',
    iconText: 'text-violet-400',
  },
  {
    icon: TrophyIcon,
    emoji: '🏆',
    title: 'Ranking',
    subtitle: 'Clasificacion de jugadores',
    desc: 'Los rankings mensuales de ganadores, mayores consumidores y jugadores con mas tiempo en mesa.',
    color: 'amber',
    iconBg: 'bg-amber-500/10 border-amber-500/20',
    iconText: 'text-amber-400',
  },
  {
    icon: Cog6ToothIcon,
    emoji: '⚙️',
    title: 'Reglas',
    subtitle: 'Configuracion del negocio',
    desc: 'Cambia en cualquier momento como se distribuye el rake: montos fijos, porcentajes, metas mensuales. Agrega o elimina socios.',
    color: 'pink',
    iconBg: 'bg-pink-500/10 border-pink-500/20',
    iconText: 'text-pink-400',
  },
  {
    icon: CheckBadgeIcon,
    emoji: '🚀',
    title: 'Listo para empezar!',
    subtitle: 'Tu club esta configurado',
    desc: 'Ya tienes todo para gestionar tu club. Abre tu primera mesa y empieza a controlar el rake como un profesional.',
    color: 'emerald',
    iconBg: 'bg-emerald-500/10 border-emerald-500/20',
    iconText: 'text-emerald-400',
  },
];

export default function OnboardingWizard({ onComplete }) {
  const [current, setCurrent] = useState(0);
  const [exiting, setExiting] = useState(false);

  const isFirst = current === 0;
  const isLast = current === steps.length - 1;
  const step = steps[current];

  const goNext = () => {
    if (isLast) {
      handleClose();
      return;
    }
    setExiting(true);
    setTimeout(() => {
      setCurrent(current + 1);
      setExiting(false);
    }, 200);
  };

  const goBack = () => {
    if (isFirst) return;
    setExiting(true);
    setTimeout(() => {
      setCurrent(current - 1);
      setExiting(false);
    }, 200);
  };

  const handleClose = () => {
    localStorage.setItem('rakeflow_wizard_done', 'true');
    onComplete();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in-view">

      <div className="w-full max-w-md">

        {/* Skip */}
        <div className="flex justify-end mb-3">
          <button onClick={handleClose} className="text-gray-500 hover:text-gray-300 text-xs font-bold uppercase tracking-wider flex items-center gap-1 transition-colors">
            Saltar tour <XMarkIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Card */}
        <div className={`bg-gray-900/95 rounded-3xl border border-gray-700/50 shadow-2xl overflow-hidden transition-all duration-200 ${exiting ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}>

          {/* Emoji hero */}
          <div className="relative pt-10 pb-6 flex justify-center">
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full blur-[80px] opacity-20 ${
                step.color === 'emerald' ? 'bg-emerald-500' :
                step.color === 'blue' ? 'bg-blue-500' :
                step.color === 'violet' ? 'bg-violet-500' :
                step.color === 'amber' ? 'bg-amber-500' :
                step.color === 'pink' ? 'bg-pink-500' : 'bg-gray-500'
              }`}></div>
            </div>
            <div className="relative">
              <div className={`w-20 h-20 rounded-2xl flex items-center justify-center border ${step.iconBg} animate-scale-in`}>
                <span className="text-4xl">{step.emoji}</span>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="px-8 pb-8 text-center">
            <p className={`text-xs font-bold uppercase tracking-widest mb-1 ${step.iconText}`}>{step.subtitle}</p>
            <h2 className="text-2xl font-black text-white tracking-tight mb-3">{step.title}</h2>
            <p className="text-gray-400 text-sm leading-relaxed mb-2">{step.desc}</p>
            {step.tip && (
              <p className="text-gray-500 text-xs bg-gray-800/50 rounded-lg px-3 py-2 mt-3 border border-gray-700/50">
                <span className="text-amber-400 font-bold">Tip:</span> {step.tip}
              </p>
            )}

            {/* Progress dots */}
            <div className="flex items-center justify-center gap-1.5 mt-6 mb-6">
              {steps.map((_, i) => (
                <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === current ? 'w-6 bg-emerald-500' : i < current ? 'w-1.5 bg-emerald-500/50' : 'w-1.5 bg-gray-700'
                }`}></div>
              ))}
            </div>

            {/* Buttons */}
            <div className="flex gap-3">
              {!isFirst && (
                <button
                  onClick={goBack}
                  className="py-3.5 px-5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold transition-colors border border-gray-700 active:scale-[0.97]"
                >
                  <ArrowLeftIcon className="w-5 h-5" />
                </button>
              )}
              <button
                onClick={goNext}
                className={`flex-1 py-3.5 rounded-xl font-bold text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
                  isLast
                    ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white shadow-lg shadow-emerald-900/20'
                    : 'bg-gray-800 hover:bg-gray-700 text-white border border-gray-700'
                }`}
              >
                {isLast ? (
                  <><CheckBadgeIcon className="w-5 h-5" /> Empezar</>
                ) : (
                  <>Siguiente <ArrowRightIcon className="w-5 h-5" /></>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
