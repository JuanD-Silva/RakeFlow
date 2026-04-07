import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api/axios';
import {
  LockClosedIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  EyeSlashIcon
} from '@heroicons/react/24/outline';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      setError('La contrasena debe tener minimo 8 caracteres, una mayuscula, una minuscula y un numero.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Las contrasenas no coinciden.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/reset-password', { token, new_password: password });
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.detail || 'Error al restablecer. El enlace puede haber expirado.');
    } finally {
      setLoading(false);
    }
  };

  const passwordsMatch = confirmPassword && password && password === confirmPassword;
  const passwordsMismatch = confirmPassword && password && password !== confirmPassword;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0f1a] px-4 font-sans relative noise-bg">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute bottom-1/3 right-1/3 w-[400px] h-[400px] bg-cyan-600/5 rounded-full blur-[120px] animate-drift"></div>
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
          {success ? (
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-emerald-500/20">
                <CheckCircleIcon className="w-8 h-8 text-emerald-400" />
              </div>
              <h2 className="text-xl font-black text-white mb-2">Contrasena actualizada</h2>
              <p className="text-gray-400 text-sm mb-6">Ya puedes iniciar sesion con tu nueva contrasena.</p>
              <Link to="/login" className="inline-flex bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold py-3 px-8 rounded-xl transition-all active:scale-[0.98] text-sm uppercase tracking-wider">
                Ir al Login
              </Link>
            </div>
          ) : !token ? (
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-red-500/20">
                <ExclamationTriangleIcon className="w-8 h-8 text-red-400" />
              </div>
              <h2 className="text-xl font-black text-white mb-2">Enlace invalido</h2>
              <p className="text-gray-400 text-sm mb-6">Este enlace no es valido. Solicita uno nuevo.</p>
              <Link to="/forgot-password" className="text-emerald-400 hover:text-emerald-300 font-bold text-sm transition-colors">
                Solicitar nuevo enlace
              </Link>
            </div>
          ) : (
            <>
              <div className="text-center mb-8">
                <h1 className="text-2xl font-black text-white tracking-tight">Nueva contrasena</h1>
                <p className="text-gray-500 mt-1 text-sm">Ingresa tu nueva contrasena</p>
              </div>

              {error && (
                <div className="animate-fade-up bg-red-500/10 border border-red-500/20 text-red-300 p-4 rounded-xl mb-6 text-sm flex items-center gap-3">
                  <ExclamationTriangleIcon className="w-5 h-5 text-red-400 flex-shrink-0" />
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-gray-400 text-xs font-bold mb-2 ml-1 uppercase tracking-wider">Nueva contrasena</label>
                  <div className="relative group">
                    <LockClosedIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 group-focus-within:text-emerald-400 transition-colors" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-gray-900/60 text-white border border-gray-700 rounded-xl py-3.5 pl-12 pr-12 placeholder-gray-600 transition-all duration-300 focus:outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/10 hover:border-gray-600"
                      placeholder="Minimo 6 caracteres"
                      minLength="6"
                      required
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-emerald-400 transition-colors p-1">
                      {showPassword ? <EyeSlashIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-gray-400 text-xs font-bold mb-2 ml-1 uppercase tracking-wider">Confirmar contrasena</label>
                  <div className="relative group">
                    <LockClosedIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 group-focus-within:text-emerald-400 transition-colors" />
                    <input
                      type={showConfirm ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className={`w-full bg-gray-900/60 text-white border rounded-xl py-3.5 pl-12 pr-12 placeholder-gray-600 transition-all duration-300 focus:outline-none focus:ring-2 hover:border-gray-600 ${
                        passwordsMatch ? 'border-emerald-500/50 focus:border-emerald-500/50 focus:ring-emerald-500/10'
                        : passwordsMismatch ? 'border-red-500/50 focus:border-red-500/50 focus:ring-red-500/10'
                        : 'border-gray-700 focus:border-emerald-500/50 focus:ring-emerald-500/10'
                      }`}
                      placeholder="Repite la contrasena"
                      minLength="6"
                      required
                    />
                    <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-emerald-400 transition-colors p-1">
                      {showConfirm ? <EyeSlashIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
                    </button>
                  </div>
                  {passwordsMismatch && (
                    <p className="text-red-400 text-xs mt-1.5 ml-1 font-medium">Las contrasenas no coinciden</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading || passwordsMismatch}
                  className="w-full mt-2 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold py-4 rounded-xl shadow-[0_0_25px_rgba(16,185,129,0.25)] hover:shadow-[0_0_35px_rgba(16,185,129,0.4)] transition-all duration-300 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm uppercase tracking-wider"
                >
                  {loading ? (
                    <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> Guardando...</>
                  ) : (
                    'Restablecer contrasena'
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
