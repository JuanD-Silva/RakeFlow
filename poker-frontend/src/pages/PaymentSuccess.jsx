import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api/axios';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';

export default function PaymentSuccess() {
  const [searchParams] = useSearchParams();
  // Wompi pasa ?id=<tx_id>; el flujo viejo (test/manual) usaba ?ref_payco=...
  const ref = searchParams.get('id') || searchParams.get('ref_payco') || '';
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    async function checkStatus() {
      // PaymentCallback ya confirmo con Wompi antes de redirigir aca.
      // Solo revalidamos el status del club.
      try {
        const statusRes = await api.get('/payments/status');
        if (statusRes.data.subscription_active && statusRes.data.plan_type === 'PRO') {
          localStorage.removeItem('rakeflow_wizard_done');
          setStatus('success');
        } else {
          setStatus('pending');
        }
      } catch {
        setStatus('pending');
      }
    }
    checkStatus();
  }, [ref]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0f1a] px-4 font-sans relative noise-bg">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/3 w-[400px] h-[400px] bg-emerald-600/8 rounded-full blur-[120px]"></div>
        <div className="absolute inset-0 opacity-[0.015]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)', backgroundSize: '80px 80px' }}></div>
      </div>

      <div className="relative z-10 w-full max-w-md text-center">
        <div className="bg-gray-800/30 backdrop-blur-xl p-10 rounded-3xl border border-gray-700/50 shadow-2xl shadow-black/20 animate-fade-up">

          {status === 'loading' && (
            <>
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto mb-6"></div>
              <h1 className="text-xl font-black text-white mb-2">Verificando pago...</h1>
              <p className="text-gray-500 text-sm">Esto puede tomar unos segundos.</p>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="w-20 h-20 bg-emerald-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-emerald-500/20 animate-scale-in">
                <CheckCircleIcon className="w-10 h-10 text-emerald-400" />
              </div>
              <h1 className="text-2xl font-black text-white tracking-tight mb-2">Pago exitoso</h1>
              <p className="text-gray-400 text-sm mb-2">Tu suscripcion a RakeFlow Pro esta activa.</p>
              {ref && <p className="text-gray-600 text-xs font-mono mb-8">Ref: {ref}</p>}
              <Link to="/dashboard" className="inline-flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold py-4 px-8 rounded-xl transition-all active:scale-[0.98] text-sm uppercase tracking-wider shadow-lg shadow-emerald-900/20">
                Ir al Dashboard
              </Link>
            </>
          )}

          {status === 'pending' && (
            <>
              <div className="w-20 h-20 bg-amber-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-amber-500/20 animate-scale-in">
                <ExclamationTriangleIcon className="w-10 h-10 text-amber-400" />
              </div>
              <h1 className="text-2xl font-black text-white tracking-tight mb-2">Pago en proceso</h1>
              <p className="text-gray-400 text-sm mb-2">Tu pago esta siendo procesado. La suscripcion se activara automaticamente en unos minutos.</p>
              {ref && <p className="text-gray-600 text-xs font-mono mb-8">Ref: {ref}</p>}
              <Link to="/dashboard" className="inline-flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white font-bold py-4 px-8 rounded-xl transition-all active:scale-[0.98] text-sm uppercase tracking-wider">
                Ir al Dashboard
              </Link>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="w-20 h-20 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-red-500/20 animate-scale-in">
                <ExclamationTriangleIcon className="w-10 h-10 text-red-400" />
              </div>
              <h1 className="text-2xl font-black text-white tracking-tight mb-2">Error en el pago</h1>
              <p className="text-gray-400 text-sm mb-8">No pudimos verificar tu pago. Si crees que es un error, contacta soporte.</p>
              <Link to="/subscribe" className="inline-flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white font-bold py-4 px-8 rounded-xl transition-all active:scale-[0.98] text-sm uppercase tracking-wider">
                Intentar de nuevo
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
