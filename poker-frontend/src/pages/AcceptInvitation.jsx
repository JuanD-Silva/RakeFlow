import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { userService } from '../api/services';
import { useAuth } from '../context/AuthContext';
import {
  UserIcon,
  LockClosedIcon,
  CheckIcon,
  EyeIcon,
  EyeSlashIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

export default function AcceptInvitation() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();
  const { login } = useAuth();

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const passwordRules = [
    { label: 'Mínimo 8 caracteres', test: (p) => p.length >= 8 },
    { label: 'Una mayúscula', test: (p) => /[A-Z]/.test(p) },
    { label: 'Una minúscula', test: (p) => /[a-z]/.test(p) },
    { label: 'Un número', test: (p) => /[0-9]/.test(p) },
  ];
  const passwordValid = password && passwordRules.every(r => r.test(password));

  useEffect(() => {
    if (!token) setError('El enlace no incluye token de invitación.');
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('Escribe tu nombre.');
    if (!passwordValid) return setError('La contraseña no cumple los requisitos.');
    if (password !== confirmPassword) return setError('Las contraseñas no coinciden.');

    setLoading(true);
    try {
      const res = await userService.acceptInvitation({ token, name: name.trim(), password });
      login(res.access_token);
      navigate('/dashboard');
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(detail || 'No se pudo aceptar la invitación.');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center px-6">
        <div className="bg-gray-900 border border-red-500/30 rounded-2xl p-8 max-w-md w-full text-center">
          <ExclamationTriangleIcon className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Enlace inválido</h2>
          <p className="text-gray-400 text-sm mb-6">El enlace de invitación no es correcto. Pide a quien te invitó que te lo reenvíe.</p>
          <Link to="/" className="text-emerald-400 hover:text-emerald-300 text-sm font-bold">
            Volver al inicio
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0f1a] px-6 py-10 font-sans">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <span className="text-3xl font-black text-white tracking-tight">
            Rake<span className="text-emerald-500">Flow</span>
          </span>
        </div>

        <div className="bg-gray-900/80 backdrop-blur border border-gray-800 rounded-2xl p-8 shadow-2xl">
          <h1 className="text-2xl font-bold text-white mb-2">Aceptar invitación</h1>
          <p className="text-gray-400 text-sm mb-6">
            Completa tus datos para crear tu cuenta y unirte al club.
          </p>

          {error && (
            <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-300 text-sm flex items-start gap-2">
              <ExclamationTriangleIcon className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1.5 block">Tu nombre</label>
              <div className="relative">
                <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-10 pr-4 py-3 text-white placeholder-gray-500 focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/10 focus:outline-none"
                  placeholder="Pedro Cajero"
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1.5 block">Contraseña</label>
              <div className="relative">
                <LockClosedIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-10 pr-12 py-3 text-white placeholder-gray-500 focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/10 focus:outline-none"
                  placeholder="••••••••"
                  required
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-emerald-400">
                  {showPassword ? <EyeSlashIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
                </button>
              </div>
              {password && (
                <ul className="mt-2 space-y-1">
                  {passwordRules.map((r) => (
                    <li key={r.label} className={`text-xs flex items-center gap-1.5 ${r.test(password) ? 'text-emerald-400' : 'text-gray-500'}`}>
                      <CheckIcon className="w-3 h-3" /> {r.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <label className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1.5 block">Confirmar contraseña</label>
              <div className="relative">
                <LockClosedIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={`w-full bg-gray-800 border rounded-xl pl-10 pr-4 py-3 text-white placeholder-gray-500 focus:ring-2 focus:outline-none ${
                    confirmPassword && password
                      ? password === confirmPassword
                        ? 'border-emerald-500/50 focus:border-emerald-500/50 focus:ring-emerald-500/10'
                        : 'border-red-500/50 focus:border-red-500/50 focus:ring-red-500/10'
                      : 'border-gray-700 focus:border-emerald-500/50 focus:ring-emerald-500/10'
                  }`}
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold py-3.5 rounded-xl shadow-lg transition-all disabled:opacity-60 disabled:cursor-not-allowed text-sm uppercase tracking-wider"
            >
              {loading ? 'Procesando…' : 'Aceptar y entrar'}
            </button>
          </form>
        </div>

        <p className="text-center text-gray-600 text-xs mt-6">
          ¿Ya tienes cuenta? <Link to="/login" className="text-emerald-400 hover:text-emerald-300 font-bold">Iniciar sesión</Link>
        </p>
      </div>
    </div>
  );
}
