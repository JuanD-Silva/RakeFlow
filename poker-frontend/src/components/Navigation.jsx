import { useState } from 'react';
import {
  PlayCircleIcon,
  ClockIcon,
  TrophyIcon,
  ChartBarIcon,
  Cog6ToothIcon,
  UsersIcon,
  Bars3Icon,
} from '@heroicons/react/24/solid';
import { useAuth } from '../context/AuthContext';

export default function Navigation({ currentView, setView, clubName }) {
  const { isOwner, isManager, canSeeReports } = useAuth();
  const [showMoreDrawer, setShowMoreDrawer] = useState(false);

  const navItems = [
    { id: 'game', label: 'Mesa Activa', icon: <PlayCircleIcon className="w-5 h-5" />, show: true },
    { id: 'history', label: 'Historial', icon: <ClockIcon className="w-5 h-5" />, show: canSeeReports },
    { id: 'finance', label: 'Caja Semanal', icon: <ChartBarIcon className="w-5 h-5" />, show: canSeeReports },
    { id: 'ranking', label: 'Ranking', icon: <TrophyIcon className="w-5 h-5" />, show: canSeeReports },
    { id: 'team', label: 'Equipo', icon: <UsersIcon className="w-5 h-5" />, show: isOwner || isManager },
    { id: 'config', label: 'Reglas', icon: <Cog6ToothIcon className="w-5 h-5" />, show: isOwner },
  ].filter(item => item.show);

  // En movil mostramos los 4 mas usados directo; el resto va a un drawer "Mas".
  // Con <=4 items visibles (cashier) no hay drawer.
  const mainItems = navItems.length > 4 ? navItems.slice(0, 4) : navItems;
  const extraItems = navItems.length > 4 ? navItems.slice(4) : [];

  const navigate = (id) => {
    setView(id);
    setShowMoreDrawer(false);
  };

  return (
    <nav className="bg-gray-900 border-b border-gray-800 sticky top-0 z-50 shadow-2xl">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex justify-between items-center h-20">

          {/* 1. LOGO / MARCA */}
          <div className="flex items-center gap-3 cursor-pointer group" onClick={() => setView('game')}>
            <div className="bg-gradient-to-br from-emerald-600 to-green-900 p-2.5 rounded-xl shadow-lg group-hover:shadow-emerald-500/20 transition-all duration-300 border border-emerald-500/30 relative overflow-hidden">
               <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-20 transition-opacity"></div>
               <span className="text-2xl leading-none relative z-10">💸</span>
            </div>

            <div className="flex flex-col">
              <h1 className="text-white font-black text-2xl tracking-tighter uppercase leading-none group-hover:text-emerald-300 transition-colors">
                Rake<span className="text-emerald-500">Flow</span>
              </h1>
              <div className="flex items-center gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">
                 <span className="w-1 h-1 bg-emerald-500 rounded-full"></span>
                 <span className="text-[10px] text-gray-400 font-bold tracking-[0.3em] uppercase">
                   {clubName || 'Panel del club'}
                 </span>
              </div>
            </div>
          </div>

          {/* 2. MENU CENTRAL (desktop) */}
          <div className="hidden md:flex gap-3 bg-gray-800/50 p-1.5 rounded-xl border border-gray-700/50 backdrop-blur-sm">
            {navItems.map((item) => {
              const isActive = currentView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setView(item.id)}
                  className={`
                    relative px-5 py-2.5 rounded-lg text-sm font-bold uppercase tracking-wide flex items-center gap-2 transition-all duration-200
                    ${isActive
                      ? 'text-white bg-gray-700 shadow-lg border border-gray-600'
                      : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                    }
                  `}
                >
                  <span className={`transition-colors duration-200 ${isActive ? 'text-emerald-400' : 'text-gray-500'}`}>
                    {item.icon}
                  </span>
                  {item.label}
                  {isActive && (
                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1/3 h-0.5 bg-emerald-500 rounded-full shadow-[0_0_8px_#10b981]"></span>
                  )}
                </button>
              );
            })}
          </div>

          {/* 3. INFO ADMIN (desktop ancho) */}
          <div className="hidden lg:block text-right">
             <p className="text-gray-300 text-xs font-bold">Admin</p>
             <div className="flex items-center justify-end gap-1.5">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                <p className="text-[10px] text-green-500 font-mono uppercase tracking-wider">Online</p>
             </div>
          </div>

        </div>

        {/* MENU MOVIL: hasta 4 items + boton "Mas" si hay extras
            Tipografia 11px (legible), touch targets >=48px (cumple WCAG/HIG). */}
        <div className="md:hidden flex border-t border-gray-800 px-1 py-1.5 gap-1">
           {mainItems.map((item) => {
             const isActive = currentView === item.id;
             return (
               <button
                  key={item.id}
                  onClick={() => navigate(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={item.label}
                  className="flex-1 min-w-0 min-h-[3rem] flex flex-col items-center justify-center gap-0.5 rounded-lg active:bg-gray-800 transition-colors"
               >
                  <div className={`p-1.5 rounded-full transition-colors ${isActive ? 'bg-emerald-900/40 text-emerald-400' : 'text-gray-500'}`}>
                     {item.icon}
                  </div>
                  <span className={`text-[11px] font-bold uppercase tracking-tight truncate max-w-full ${isActive ? 'text-emerald-300' : 'text-gray-400'}`}>
                     {item.label}
                  </span>
               </button>
             );
           })}
           {extraItems.length > 0 && (
             <button
                onClick={() => setShowMoreDrawer(true)}
                aria-label="Mas opciones"
                aria-expanded={showMoreDrawer}
                className="flex-1 min-w-0 min-h-[3rem] flex flex-col items-center justify-center gap-0.5 rounded-lg active:bg-gray-800 transition-colors"
             >
                <div className="p-1.5 rounded-full text-gray-500">
                   <Bars3Icon className="w-5 h-5" />
                </div>
                <span className="text-[11px] font-bold uppercase tracking-tight text-gray-400">
                   Más
                </span>
             </button>
           )}
        </div>

      </div>

      {/* DRAWER "MAS" (bottom sheet en movil) */}
      {showMoreDrawer && (
        <div
          className="md:hidden fixed inset-0 z-[60] flex items-end animate-fade-in"
          onClick={() => setShowMoreDrawer(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
          <div
            className="relative w-full bg-gray-900 border-t border-gray-700 rounded-t-2xl p-4 pb-6 space-y-2 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-1 bg-gray-700 rounded-full mx-auto mb-3" />
            <h3 className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-3 px-2">
              Más opciones
            </h3>
            {extraItems.map((item) => {
              const isActive = currentView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => navigate(item.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors min-h-[3rem] active:scale-[0.98] ${
                    isActive
                      ? 'bg-emerald-900/30 border border-emerald-500/30'
                      : 'bg-gray-800/60 hover:bg-gray-700 border border-transparent'
                  }`}
                >
                  <span className={isActive ? 'text-emerald-400' : 'text-gray-400'}>
                    {item.icon}
                  </span>
                  <span className={`font-bold text-sm ${isActive ? 'text-white' : 'text-gray-200'}`}>
                    {item.label}
                  </span>
                </button>
              );
            })}
            <button
              onClick={() => setShowMoreDrawer(false)}
              className="w-full mt-3 text-gray-500 hover:text-gray-300 text-xs font-bold uppercase tracking-wider py-2 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
