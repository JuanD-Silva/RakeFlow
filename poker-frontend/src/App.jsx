// src/App.jsx
import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

// IMPORTACIONES
import { AuthProvider, useAuth } from './context/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';
import GameControl from './components/GameControl';
import SessionHistory from './components/SessionHistory';
import WeeklyReport from './components/WeeklyReport';
import PlayerLeaderboard from './components/PlayerLeaderboard';
import Navigation from './components/Navigation';
import Login from './pages/Login';
import Register from './pages/Register';
import Setup from './pages/Setup';

// --- COMPONENTE PRINCIPAL (Dashboard Protegido) ---
function PokerManagerApp() {
  const [currentView, setCurrentView] = useState('game');

  return (
    <div className="min-h-screen bg-[#0f172a] text-gray-100 font-sans selection:bg-emerald-500 selection:text-white">

      <Navigation
        currentView={currentView}
        setView={setCurrentView}
      />

      <main className="py-8 max-w-7xl mx-auto px-4 md:px-6">
        <ErrorBoundary>
          {currentView === 'game' && <GameControl />}
          {currentView === 'history' && <SessionHistory />}
          {currentView === 'finance' && <WeeklyReport />}
          {currentView === 'ranking' && <PlayerLeaderboard />}
        </ErrorBoundary>
      </main>
    </div>
  );
}

// --- RUTAS Y PROTECCION ---
function AppRoutes() {
  const { token } = useAuth();

  return (
    <Routes>
      {/* Rutas Publicas */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* Configuracion Inicial */}
      <Route
        path="/setup"
        element={token ? <Setup /> : <Navigate to="/login" />}
      />

      {/* Dashboard Protegido */}
      <Route
        path="/*"
        element={
          token ? <PokerManagerApp /> : <Navigate to="/login" />
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
