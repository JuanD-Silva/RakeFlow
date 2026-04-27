import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { wompiService } from '../api/services';
import {
  CheckIcon,
  CreditCardIcon,
  ShieldCheckIcon,
  ClockIcon,
  SparklesIcon,
  BeakerIcon,
} from '@heroicons/react/24/outline';

const PLAN_FEATURES = [
  'Mesas ilimitadas',
  'Jugadores ilimitados',
  'Torneos ilimitados',
  'Reportes avanzados',
  'Soporte prioritario',
  'Multi-usuario (cajeros)',
];

// Calcula SHA-256 hex del string usando WebCrypto (browser nativo)
async function sha256Hex(text) {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export default function Subscribe() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [startingTrial, setStartingTrial] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [activating, setActivating] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    async function load() {
      try {
        const statusRes = await api.get('/payments/status');
        setStatus(statusRes.data);
        if (statusRes.data.subscription_active && !statusRes.data.in_trial) {
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

  // Wompi Hosted Checkout: redirect a checkout.wompi.co con los params firmados.
  // El usuario paga ahi, luego Wompi redirige a redirect-url?id=<tx_id>&env=test
  // El PaymentCallback se encarga de confirmar con el backend.
  const handleSubscribeWompi = async () => {
    setRedirecting(true);
    try {
      const cfg = await wompiService.getConfig();
      const amountInCents = cfg.amount_cop * 100;
      const reference = `${cfg.reference_prefix}${Date.now()}`;
      const currency = cfg.currency || 'COP';

      // Signature de integridad: SHA-256(reference + amount_in_cents + currency + integrity_key)
      const signature = await sha256Hex(
        `${reference}${amountInCents}${currency}${cfg.integrity_key}`
      );

      const redirectUrl = `${window.location.origin}/payment-callback`;

      const params = new URLSearchParams({
        'public-key': cfg.public_key,
        currency,
        'amount-in-cents': String(amountInCents),
        reference,
        'signature:integrity': signature,
        'redirect-url': redirectUrl,
        'customer-data:email': cfg.club_email || '',
      });

      window.location.href = `https://checkout.wompi.co/p/?${params.toString()}`;
    } catch (err) {
      console.error(err);
      alert('No se pudo iniciar el pago. Intenta de nuevo.');
      setRedirecting(false);
    }
  };

  const handleTestActivate = async () => {
    setActivating(true);
    try {
      const res = await api.post('/payments/activate-test');
      if (res.data.subscription_active) {
        localStorage.removeItem('rakeflow_wizard_done');
        navigate('/payment-success?id=test');
      }
    } catch (err) {
      console.error(err);
      alert('Error activando modo test');
    } finally {
      setActivating(false);
    }
  };

  if (loading || activating || redirecting) {
    return (
      <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-500 mx-auto mb-4"></div>
          {activating && <p className="text-gray-400 text-sm">Activando suscripción...</p>}
          {redirecting && <p className="text-gray-400 text-sm">Redirigiendo a Wompi...</p>}
        </div>
      </div>
    );
  }

  const canTrial = status && !status.subscription_active && !status.trial_end;
  const inTrial = status?.in_trial;
  const isTestMode = true; // Sandbox visible siempre que no esten en prod (lo decide el backend mismo)

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
                <CreditCardIcon className="w-5 h-5" /> Suscribirme con tarjeta / PSE / Nequi
              </button>

              {isTestMode && (
                <button
                  onClick={handleTestActivate}
                  className="w-full py-3 rounded-xl bg-violet-900/30 hover:bg-violet-800/40 text-violet-300 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all border border-violet-500/20"
                >
                  <BeakerIcon className="w-4 h-4" /> Activar sin pago (modo test)
                </button>
              )}
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
    </div>
  );
}
