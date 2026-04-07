import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api/axios';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [status, setStatus] = useState('loading'); // loading, success, error
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Enlace invalido. No se encontro un token de verificacion.');
      return;
    }

    async function verify() {
      try {
        const res = await api.post('/auth/verify-email', { token });
        setStatus('success');
        setMessage(res.data.message);
      } catch (err) {
        setStatus('error');
        setMessage(err.response?.data?.detail || 'Error al verificar. El enlace puede ser invalido o ya fue usado.');
      }
    }
    verify();
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0f1a] px-4 font-sans relative noise-bg">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/3 w-[400px] h-[400px] bg-emerald-600/5 rounded-full blur-[120px]"></div>
        <div className="absolute inset-0 opacity-[0.015]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)', backgroundSize: '80px 80px' }}></div>
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-10">
          <Link to="/" className="inline-flex items-center gap-2 group">
            <div className="bg-gradient-to-br from-emerald-600 to-green-900 p-2 rounded-xl border border-emerald-500/30 group-hover:shadow-lg group-hover:shadow-emerald-500/20 transition-all">
              <span className="text-xl leading-none">💸</span>
            </div>
            <span className="text-white font-black text-2xl tracking-tighter uppercase">
              Rake<span className="text-emerald-500">Flow</span>
            </span>
          </Link>
        </div>

        <div className="bg-gray-800/30 backdrop-blur-xl p-8 rounded-3xl border border-gray-700/50 shadow-2xl shadow-black/20">
          {status === 'loading' && (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto mb-4"></div>
              <p className="text-gray-400 text-sm">Verificando tu email...</p>
            </div>
          )}

          {status === 'success' && (
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-emerald-500/20">
                <CheckCircleIcon className="w-8 h-8 text-emerald-400" />
              </div>
              <h2 className="text-xl font-black text-white mb-2">Email verificado</h2>
              <p className="text-gray-400 text-sm mb-6">{message}</p>
              <Link to="/login" className="inline-flex bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold py-3 px-8 rounded-xl transition-all active:scale-[0.98] text-sm uppercase tracking-wider">
                Iniciar Sesion
              </Link>
            </div>
          )}

          {status === 'error' && (
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-red-500/20">
                <ExclamationTriangleIcon className="w-8 h-8 text-red-400" />
              </div>
              <h2 className="text-xl font-black text-white mb-2">Error de verificacion</h2>
              <p className="text-gray-400 text-sm mb-6">{message}</p>
              <Link to="/login" className="text-emerald-400 hover:text-emerald-300 font-bold text-sm transition-colors">
                Ir al login
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
