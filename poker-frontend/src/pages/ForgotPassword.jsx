import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import {
  EnvelopeIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError('Error al enviar. Intentalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0f1a] px-4 font-sans relative noise-bg">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/3 w-[400px] h-[400px] bg-amber-600/5 rounded-full blur-[120px] animate-drift"></div>
        <div className="absolute inset-0 opacity-[0.015]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)', backgroundSize: '80px 80px' }}></div>
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-10 animate-fade-up">
          <Link to="/" className="inline-flex items-center gap-2 group">
            <div className="bg-gradient-to-br from-emerald-600 to-green-900 p-2 rounded-xl border border-emerald-500/30 group-hover:shadow-lg group-hover:shadow-emerald-500/20 transition-all">
              <span className="text-xl leading-none">💸</span>
            </div>
            <span className="text-white font-black text-2xl tracking-tighter uppercase">
              Rake<span className="text-emerald-500">Flow</span>
            </span>
          </Link>
        </div>

        <div className="animate-fade-up delay-100 bg-gray-800/30 backdrop-blur-xl p-8 rounded-3xl border border-gray-700/50 shadow-2xl shadow-black/20">
          {sent ? (
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-emerald-500/20">
                <CheckCircleIcon className="w-8 h-8 text-emerald-400" />
              </div>
              <h2 className="text-xl font-black text-white mb-2">Revisa tu correo</h2>
              <p className="text-gray-400 text-sm mb-6">
                Si <span className="text-white font-bold">{email}</span> esta registrado, recibiras un enlace para restablecer tu contrasena.
              </p>
              <Link to="/login" className="text-emerald-400 hover:text-emerald-300 font-bold text-sm transition-colors">
                ← Volver al login
              </Link>
            </div>
          ) : (
            <>
              <div className="text-center mb-8">
                <h1 className="text-2xl font-black text-white tracking-tight">Recuperar contrasena</h1>
                <p className="text-gray-500 mt-1 text-sm">Ingresa tu email y te enviaremos instrucciones</p>
              </div>

              {error && (
                <div className="animate-fade-up bg-red-500/10 border border-red-500/20 text-red-300 p-4 rounded-xl mb-6 text-sm flex items-center gap-3">
                  <ExclamationTriangleIcon className="w-5 h-5 text-red-400 flex-shrink-0" />
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-gray-400 text-xs font-bold mb-2 ml-1 uppercase tracking-wider">
                    Correo Electronico
                  </label>
                  <div className="relative group">
                    <EnvelopeIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 group-focus-within:text-emerald-400 transition-colors" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-gray-900/60 text-white border border-gray-700 rounded-xl py-3.5 pl-12 pr-4 placeholder-gray-600 transition-all duration-300 focus:outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/10 hover:border-gray-600"
                      placeholder="tucorreo@ejemplo.com"
                      required
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold py-4 rounded-xl shadow-[0_0_25px_rgba(16,185,129,0.25)] hover:shadow-[0_0_35px_rgba(16,185,129,0.4)] transition-all duration-300 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm uppercase tracking-wider"
                >
                  {loading ? (
                    <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> Enviando...</>
                  ) : (
                    'Enviar instrucciones'
                  )}
                </button>
              </form>

              <div className="mt-8 text-center">
                <Link to="/login" className="text-gray-500 hover:text-gray-300 text-sm font-bold transition-colors flex items-center justify-center gap-2">
                  <ArrowLeftIcon className="w-4 h-4" /> Volver al login
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
