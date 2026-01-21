// src/App.jsx
import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

// IMPORTACIONES
import GameControl from './components/GameControl';
import SessionHistory from './components/SessionHistory'; 
import WeeklyReport from './components/WeeklyReport';
import PlayerLeaderboard from './components/PlayerLeaderboard';
import Navigation from './components/Navigation'; // 👈 IMPORTANTE: Tu nuevo componente
import Login from './pages/Login';
import Register from './pages/Register';
import Setup from './pages/Setup';

// --- COMPONENTE PRINCIPAL (Dashboard Protegido) ---
function PokerManagerApp({ onLogout }) {
  // Estado de la vista actual (Por defecto 'game')
  const [currentView, setCurrentView] = useState('game');

return (
    // Usamos el fondo oscuro global
    <div className="min-h-screen bg-[#0f172a] text-gray-100 font-sans selection:bg-emerald-500 selection:text-white">
      
      {/* BARRA DE NAVEGACIÓN (Ya no necesita onLogout) */}
      <Navigation 
        currentView={currentView} 
        setView={setCurrentView} 
      />

      <main className="py-8 max-w-7xl mx-auto px-4 md:px-6">
        
        {/* RENDERIZADO CONDICIONAL DE VISTAS */}
        
        {currentView === 'game' && (
          // 👇 AQUÍ ES EL CAMBIO IMPORTANTE: Pasamos onLogout a GameControl
          <GameControl onLogout={onLogout} />
        )}
        
        {currentView === 'history' && (
          <SessionHistory />
        )}
        
        {currentView === 'finance' && (
          <WeeklyReport />
        )} 
        
        {currentView === 'ranking' && (
          <PlayerLeaderboard />
        )}
      </main>

    </div>
  );
}

// --- RUTAS Y PROTECCIÓN (Lógica de autenticación) ---
export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));

  // Listener para sincronizar token entre pestañas o al loguearse
  useEffect(() => {
    const handleStorageChange = () => setToken(localStorage.getItem('token'));
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken(null);
  };

  return (
    <BrowserRouter>
      <Routes>
        {/* Rutas Públicas */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        
        {/* Configuración Inicial */}
        <Route 
          path="/setup" 
          element={token ? <Setup /> : <Navigate to="/login" />} 
        />
        
        {/* Dashboard Protegido */}
        <Route 
          path="/*" 
          element={
            token ? (
              <PokerManagerApp onLogout={handleLogout} />
            ) : (
              <Navigate to="/login" />
            )
          } 
        />
      </Routes>
    </BrowserRouter>
  );
}