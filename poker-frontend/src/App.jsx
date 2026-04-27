// src/App.jsx
import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import api from './api/axios';

// IMPORTACIONES
import { AuthProvider, useAuth } from './context/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';
import OnboardingWizard from './components/OnboardingWizard';
import GameControl from './components/GameControl';
import SessionHistory from './components/SessionHistory';
import WeeklyReport from './components/WeeklyReport';
import PlayerLeaderboard from './components/PlayerLeaderboard';
import ConfigPanel from './components/ConfigPanel';
import Navigation from './components/Navigation';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import Setup from './pages/Setup';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';
import Subscribe from './pages/Subscribe';
import PaymentSuccess from './pages/PaymentSuccess';
import CheckoutFrame from './pages/CheckoutFrame';
import PaymentCallback from './pages/PaymentCallback';
import Terms from './pages/Terms';
import Privacy from './pages/Privacy';
import AcceptInvitation from './pages/AcceptInvitation';
import TeamPanel from './components/TeamPanel';

// --- COMPONENTE PRINCIPAL (Dashboard Protegido) ---
function PokerManagerApp() {
  const [currentView, setCurrentView] = useState('game');
  const [checkingSetup, setCheckingSetup] = useState(true);
  const [emailVerified, setEmailVerified] = useState(true);
  const [resending, setResending] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [trialInfo, setTrialInfo] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    async function checkSetup() {
      try {
        const res = await api.get('/auth/me');
        if (!res.data.setup_completed) {
          navigate('/setup');
          return;
        }
        setEmailVerified(res.data.email_verified);

        // Verificar suscripcion
        try {
          const subRes = await api.get('/payments/status');
          if (!subRes.data.subscription_active) {
            navigate('/subscribe');
            return;
          }
          if (subRes.data.in_trial) {
            setTrialInfo(subRes.data);
          }
        } catch {}

        // Mostrar wizard si es primera vez
        if (!localStorage.getItem('rakeflow_wizard_done')) {
          setShowWizard(true);
        }
      } catch {
        // Si falla, dejamos pasar
      }
      setCheckingSetup(false);
    }
    checkSetup();
  }, []);

  const handleResendVerification = async () => {
    setResending(true);
    try {
      await api.post('/auth/resend-verification');
    } catch {}
    setResending(false);
  };

  if (checkingSetup) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f172a] text-gray-100 font-sans selection:bg-emerald-500 selection:text-white">

      {/* Wizard de onboarding */}
      {showWizard && <OnboardingWizard onComplete={() => setShowWizard(false)} />}

      <Navigation
        currentView={currentView}
        setView={setCurrentView}
      />

      {/* Banner de verificación de email */}
      {!emailVerified && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-3">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
            <p className="text-amber-300 text-sm font-medium">
              Verifica tu correo electronico para asegurar tu cuenta.
            </p>
            <button
              onClick={handleResendVerification}
              disabled={resending}
              className="text-amber-400 hover:text-amber-300 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
            >
              {resending ? 'Enviando...' : 'Reenviar email'}
            </button>
          </div>
        </div>
      )}

      {/* Banner de trial */}
      {trialInfo && (
        <div className="bg-violet-500/10 border-b border-violet-500/20 px-4 py-3">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
            <p className="text-violet-300 text-sm font-medium">
              Periodo de prueba: <span className="text-white font-bold">{trialInfo.trial_days_remaining} dias restantes</span>
            </p>
            <button
              onClick={() => navigate('/subscribe')}
              className="bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold uppercase tracking-wider px-4 py-1.5 rounded-lg transition-colors"
            >
              Suscribirme ahora
            </button>
          </div>
        </div>
      )}

      <main className="py-8 max-w-7xl mx-auto px-4 md:px-6">
        <ErrorBoundary>
          {currentView === 'game' && <GameControl />}
          {currentView === 'history' && <SessionHistory />}
          {currentView === 'finance' && <WeeklyReport />}
          {currentView === 'ranking' && <PlayerLeaderboard />}
          {currentView === 'team' && <TeamPanel />}
          {currentView === 'config' && <ConfigPanel />}
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
      {/* Landing publica */}
      <Route path="/" element={token ? <Navigate to="/dashboard" /> : <Landing />} />

      {/* Auth */}
      <Route path="/login" element={token ? <Navigate to="/dashboard" /> : <Login />} />
      <Route path="/register" element={token ? <Navigate to="/setup" /> : <Register />} />
      <Route path="/forgot-password" element={token ? <Navigate to="/dashboard" /> : <ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/subscribe" element={token ? <Subscribe /> : <Navigate to="/login" />} />
      <Route path="/checkout-frame" element={token ? <CheckoutFrame /> : <Navigate to="/login" />} />
      <Route path="/payment-callback" element={<PaymentCallback />} />
      <Route path="/payment-success" element={token ? <PaymentSuccess /> : <Navigate to="/login" />} />

      {/* Paginas legales (publicas) */}
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />

      {/* Aceptar invitacion (publica) */}
      <Route path="/accept-invitation" element={<AcceptInvitation />} />

      {/* Configuracion Inicial */}
      <Route path="/setup" element={token ? <Setup /> : <Navigate to="/login" />} />

      {/* Dashboard Protegido */}
      <Route path="/dashboard/*" element={token ? <PokerManagerApp /> : <Navigate to="/" />} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" />} />
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
