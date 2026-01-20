import { 
  PlayCircleIcon, 
  ClockIcon, 
  TrophyIcon, 
  UsersIcon, 
  ChartBarIcon,
  ArrowRightOnRectangleIcon 
} from '@heroicons/react/24/solid';

export default function Navigation({ currentView, setView, onLogout }) {
  
const navItems = [
    { id: 'game', label: 'Mesa Activa', icon: <PlayCircleIcon className="w-5 h-5" /> },
    { id: 'history', label: 'Historial', icon: <ClockIcon className="w-5 h-5" /> },
    // 👇 Cambiamos 'players' por 'finance' para el Reporte Semanal
    { id: 'finance', label: 'Caja Semanal', icon: <ChartBarIcon className="w-5 h-5" /> }, 
    // 👇 Usamos 'ranking' para el Leaderboard
    { id: 'ranking', label: 'Ranking', icon: <TrophyIcon className="w-5 h-5" /> },
  ];

  return (
    <nav className="bg-gray-900 border-b border-gray-800 sticky top-0 z-50 shadow-2xl">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex justify-between items-center h-20">
          
          {/* 1. LOGO / MARCA */}
<div className="flex items-center gap-3 cursor-pointer group" onClick={() => setView('game')}>
            <div className="bg-gradient-to-br from-emerald-600 to-green-900 p-2.5 rounded-xl shadow-lg group-hover:shadow-emerald-500/20 transition-all duration-300 border border-emerald-500/30 relative overflow-hidden">
               {/* Brillo interno */}
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
                   Mambo SaS
                 </span>
              </div>
            </div>
          </div>

          {/* 2. MENU CENTRAL (Pestañas) */}
          <div className="hidden md:flex space-x-1 bg-gray-800/50 p-1.5 rounded-xl border border-gray-700/50 backdrop-blur-sm">
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
                  {/* Icono con color dinámico */}
                  <span className={`transition-colors duration-200 ${isActive ? 'text-emerald-400' : 'text-gray-500'}`}>
                    {item.icon}
                  </span>
                  
                  {item.label}

                  {/* Indicador inferior brillante si está activo */}
                  {isActive && (
                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1/3 h-0.5 bg-emerald-500 rounded-full shadow-[0_0_8px_#10b981]"></span>
                  )}
                </button>
              );
            })}
          </div>

          {/* 3. PERFIL / SALIR */}
          <div className="flex items-center gap-4">
             {/* Info Usuario (Opcional) */}
             <div className="hidden lg:block text-right">
                <p className="text-gray-300 text-xs font-bold">Admin</p>
                <div className="flex items-center gap-1.5">
                   <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                   <p className="text-[10px] text-green-500 font-mono uppercase tracking-wider">Online</p>
                </div>
             </div>

             <button 
               onClick={onLogout}
               className="group flex items-center gap-2 bg-gray-800 hover:bg-red-900/20 text-gray-400 hover:text-red-400 px-4 py-2 rounded-lg border border-gray-700 hover:border-red-900/50 transition-all duration-300"
               title="Cerrar Sesión"
             >
               <span className="text-xs font-bold uppercase tracking-wider hidden sm:block">Salir</span>
               <ArrowRightOnRectangleIcon className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
             </button>
          </div>
        </div>

        {/* MENU MÓVIL (Solo visible en pantallas pequeñas) */}
        <div className="md:hidden flex justify-around border-t border-gray-800 py-3 overflow-x-auto">
           {navItems.map((item) => (
             <button
                key={item.id}
                onClick={() => setView(item.id)}
                className={`flex flex-col items-center gap-1 px-3 py-1 rounded-lg ${currentView === item.id ? 'text-emerald-400' : 'text-gray-500'}`}
             >
                <div className={`${currentView === item.id ? 'bg-emerald-900/30' : ''} p-2 rounded-full`}>
                   {item.icon}
                </div>
                <span className="text-[9px] font-bold uppercase tracking-wider">{item.label}</span>
             </button>
           ))}
        </div>

      </div>
    </nav>
  );
}