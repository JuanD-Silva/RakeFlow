// src/components/Layout.jsx
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Layout({ children }) {
  const { logout } = useAuth();

  const handleLogout = () => {
    logout();
  };

  return (
<div className="min-h-screen bg-gray-900 text-white flex flex-col w-full max-w-full overflow-x-hidden">      
      {/* --- NAVBAR SUPERIOR (Horizontal) --- */}
      <nav className="bg-gray-800 border-b border-gray-700 shadow-lg sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            
            {/* IZQUIERDA: Logo y Título */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-blue-500 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20 text-white font-bold text-lg">
                P
              </div>
              <Link to="/dashboard" className="text-xl font-bold tracking-tight text-white hover:text-gray-200 transition-colors">
                Poker SaaS
              </Link>
            </div>

            {/* CENTRO: Menú de Navegación (Opcional) */}
            <div className="hidden md:flex items-center gap-6">
                <Link to="/dashboard" className="text-sm font-medium text-blue-400 border-b-2 border-blue-500 py-5">
                    Dashboard
                </Link>
                {/* Puedes agregar más links aquí (Jugadores, Config, etc.) */}
            </div>

            {/* DERECHA: Botón Cerrar Sesión */}
            <div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 text-sm font-medium text-gray-400 hover:text-red-400 transition-colors px-3 py-2 rounded-md hover:bg-gray-700/50"
              >
                <span>Cerrar Sesión</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>

          </div>
        </div>
      </nav>

      {/* --- CONTENIDO PRINCIPAL --- */}
      {/* Centrado y con margen superior */}
      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {children}
      </main>
      
    </div>
  );
}