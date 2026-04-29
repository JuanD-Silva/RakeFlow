import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import WompiCardForm from '../components/WompiCardForm';
import {
  CheckIcon,
  CreditCardIcon,
  ShieldCheckIcon,
  ClockIcon,
  SparklesIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

const PLAN_FEATURES = [
  'Mesas ilimitadas',
  'Jugadores ilimitados',
  'Torneos ilimitados',
  'Reportes avanzados',
  'Soporte prioritario',
  'Multi-usuario (cajeros)',
];

export default function Subscribe() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [startingTrial, setStartingTrial] = useState(false);
  const [showCardModal, setShowCardModal] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    async function load() {
      try {
        const statusRes = await api.get('/payments/status');
        setStatus(statusRes.data);
        // Solo redirigir al dashboard si ya tiene tarjeta tokenizada
        // (sino dejarlo entrar a tokenizar). El query param ?force evita
        // cualquier redirect (util para "actualizar tarjeta").
        const force = new URLSearchParams(window.location.search).get('force');
        if (
          !force &&
          statusRes.data.subscription_active &&
          !statusRes.data.in_trial &&
          statusRes.data.has_payment_method
        ) {
          navigate('/dashboard');
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleStartTrial = async () => {
    setStartingTrial(true);
    try {
      await api.post('/payments/start-trial');
      localStorage.removeItem('rakeflow_wizard_done');
      navigate('/dashboard');
    } catch (err) {
      console.error(err);
    } finally {
      setStartingTrial(false);
    }
  };

  const handleSubscribeWompi = () => setShowCardModal(true);

  const handleCardSuccess = (data) => {
    setShowCardModal(false);
    localStorage.removeItem('rakeflow_wizard_done');
    navigate(`/payment-success?id=${encodeURIComponent(data.transaction_id || '')}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-500 mx-auto"></div>
      </div>
    );
  }

  const canTrial = status && !status.subscription_active && !status.trial_end;
  const inTrial = status?.in_trial;

  return (
    <div className="min-h-screen bg-[#0a0f1a] px-4 py-10 font-sans relative noise-bg">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/3 w-[400px] h-[400px] bg-emerald-600/6 rounded-full blur-[120px] animate-drift"></div>
        <div className="absolute bottom-1/4 right-1/3 w-[350px] h-[350px] bg-violet-600/5 rounded-full blur-[100px] animate-drift delay-500"></div>
        <div className="absolute inset-0 opacity-[0.015]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)', backgroundSize: '80px 80px' }}></div>
      </div>

      <div className="relative z-10 max-w-lg mx-auto">

        <div className="text-center mb-8 animate-fade-up">
          <Link to="/" className="inline-flex items-center gap-2 group">
            <div className="bg-gradient-to-br from-emerald-600 to-green-900 p-2 rounded-xl border border-emerald-500/30 group-hover:shadow-lg group-hover:shadow-emerald-500/20 transition-all">
              <span className="text-xl leading-none">💸</span>
            </div>
            <span className="text-white font-black text-2xl tracking-tighter uppercase">
              Rake<span className="text-emerald-500">Flow</span>
            </span>
          </Link>
        </div>

        {inTrial && (
          <div className="animate-fade-up delay-100 bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 mb-6 flex items-center gap-3">
            <ClockIcon className="w-6 h-6 text-amber-400 flex-shrink-0" />
            <div>
              <p className="text-amber-300 text-sm font-bold">Periodo de prueba activo</p>
              <p className="text-amber-400/60 text-xs">Te quedan {status.trial_days_remaining} dias. Suscríbete para no perder acceso.</p>
            </div>
          </div>
        )}

        <div className="animate-fade-up delay-200 bg-gray-800/30 backdrop-blur-xl rounded-3xl border border-emerald-500/20 shadow-2xl shadow-black/20 overflow-hidden">

          <div className="bg-gradient-to-r from-emerald-900/40 to-teal-900/30 p-8 text-center border-b border-emerald-500/10">
            <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-4 py-1.5 mb-4">
              <SparklesIcon className="w-4 h-4 text-emerald-400" />
              <span className="text-emerald-400 text-xs font-bold uppercase tracking-wider">Plan Pro</span>
            </div>
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-5xl font-black text-white font-mono">$49.900</span>
              <span className="text-gray-500 text-sm">/mes</span>
            </div>
            <p className="text-gray-400 text-sm mt-2">Todo lo que necesitas para gestionar tu club</p>
          </div>

          <div className="p-8">
            <ul className="space-y-3 mb-8">
              {PLAN_FEATURES.map((feat, i) => (
                <li key={i} className="flex items-center gap-3 text-sm text-gray-300 animate-fade-up" style={{ animationDelay: `${300 + i * 60}ms` }}>
                  <div className="w-5 h-5 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                    <CheckIcon className="w-3 h-3 text-emerald-500" />
                  </div>
                  {feat}
                </li>
              ))}
            </ul>

            <div className="space-y-3">
              {canTrial && (
                <button
                  onClick={handleStartTrial}
                  disabled={startingTrial}
                  className="w-full py-4 rounded-xl bg-gray-800 hover:bg-gray-700 text-white font-bold text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all active:scale-[0.98] border border-gray-700"
                >
                  {startingTrial ? (
                    <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> Activando...</>
                  ) : (
                    <><ClockIcon className="w-5 h-5" /> Probar 7 dias gratis</>
                  )}
                </button>
              )}

              <button
                onClick={handleSubscribeWompi}
                className="w-full py-4 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg shadow-emerald-900/20 hover:shadow-[0_0_30px_rgba(16,185,129,0.3)]"
              >
                <CreditCardIcon className="w-5 h-5" /> Suscribirme con tarjeta
              </button>
              <p className="text-[10px] text-gray-500 text-center -mt-1">Renovación automática mensual. Cancela cuando quieras.</p>
            </div>

            <div className="flex items-center justify-center gap-2 mt-6 text-gray-600 text-xs">
              <ShieldCheckIcon className="w-4 h-4" />
              Pago seguro con Wompi · Bancolombia
            </div>
          </div>
        </div>

        {inTrial && (
          <div className="animate-fade-up delay-500 text-center mt-6">
            <Link to="/dashboard" className="text-gray-600 hover:text-gray-400 text-xs font-bold uppercase tracking-wider transition-colors">
              Volver al dashboard
            </Link>
          </div>
        )}
      </div>

      {/* MODAL: Form de tarjeta */}
      {showCardModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-[60] flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-gray-900 rounded-2xl border border-emerald-500/30 shadow-2xl w-full max-w-md overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="bg-gray-800 px-5 py-4 border-b border-gray-700 flex items-center justify-between sticky top-0 z-10">
              <div className="flex items-center gap-2">
                <CreditCardIcon className="w-5 h-5 text-emerald-400" />
                <h3 className="text-white font-bold">Suscripción mensual</h3>
              </div>
              <button onClick={() => setShowCardModal(false)} className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white">
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5">
              <WompiCardForm
                amountCop={2000}
                onSuccess={handleCardSuccess}
                onCancel={() => setShowCardModal(false)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
