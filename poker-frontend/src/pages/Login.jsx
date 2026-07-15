import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { authService } from '../api/services';
import { useAuth } from '../context/AuthContext';
import { ROLE_META } from '../utils/accountMeta';
import {
  EnvelopeIcon,
  LockClosedIcon,
  ArrowRightIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  EyeSlashIcon
} from '@heroicons/react/24/outline';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // Multi-cuenta: si la clave abre varias cuentas, el backend NO entra directo
  // sino que devuelve la lista para elegir (+ un select_token efímero).
  const [accounts, setAccounts] = useState(null);
  const [selectToken, setSelectToken] = useState(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login } = useAuth();

  // Entra con el token recibido (login directo o cuenta ya elegida). El router
  // reenvía jugador→/jugador y dealer→/dealer desde /dashboard.
  const finishLogin = (data) => {
    login(data.access_token);
    const next = searchParams.get('next');
    if (next && next.startsWith('/')) navigate(next);
    else navigate(data.setup_completed ? '/dashboard' : '/setup');
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await authService.login(email, password);
      if (data.multi_account) {
        setAccounts(data.accounts);
        setSelectToken(data.select_token);
      } else {
        finishLogin(data);
      }
    } catch (err) {
      console.error(err);
      setError('Credenciales inválidas. Verifica tu correo/teléfono y tu contraseña.');
    } finally {
      setLoading(false);
    }
  };

  const pickAccount = async (userId) => {
    setLoading(true);
    setError('');
    try {
      const data = await authService.selectAccount(selectToken, userId);
      finishLogin(data);
    } catch (err) {
      console.error(err);
      // El select_token dura 10 min; si venció, se vuelve al formulario.
      setError('No se pudo entrar a esa cuenta. Inicia sesión de nuevo.');
      setAccounts(null);
      setSelectToken(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0f1a] px-4 font-sans relative noise-bg">

      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/3 w-[400px] h-[400px] bg-emerald-600/6 rounded-full blur-[120px] animate-drift"></div>
        <div className="absolute bottom-1/4 right-1/3 w-[350px] h-[350px] bg-violet-600/5 rounded-full blur-[100px] animate-drift delay-500"></div>
        <div className="absolute inset-0 opacity-[0.015]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)', backgroundSize: '80px 80px' }}></div>
      </div>

      <div className="relative z-10 w-full max-w-md">

        {/* Logo */}
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

        {/* Card */}
        <div className="animate-fade-up delay-100 bg-gray-800/30 backdrop-blur-xl p-8 rounded-3xl border border-gray-700/50 shadow-2xl shadow-black/20">

          {error && (
            <div className="animate-fade-up bg-red-500/10 border border-red-500/20 text-red-300 p-4 rounded-xl mb-6 text-sm flex items-center gap-3">
              <ExclamationTriangleIcon className="w-5 h-5 text-red-400 flex-shrink-0" />
              {error}
            </div>
          )}

          {accounts ? (
            /* ---- Selección de cuenta (multi-cuenta) ---- */
            <div className="animate-fade-up">
              <div className="text-center mb-6">
                <h1 className="text-2xl font-black text-white tracking-tight">¿Cómo quieres entrar?</h1>
                <p className="text-gray-500 mt-1 text-sm">Tienes varias cuentas con este número.</p>
              </div>

              <div className="flex flex-col gap-2.5">
                {accounts.map((a) => {
                  const meta = ROLE_META[a.role] || { emoji: '👤', label: a.role };
                  return (
                    <button
                      key={a.user_id}
                      onClick={() => pickAccount(a.user_id)}
                      disabled={loading}
                      className="rf-tap flex items-center gap-3 rounded-2xl border border-gray-700/60 bg-gray-900/40 hover:bg-gray-900/70 hover:border-emerald-500/40 px-4 py-3.5 text-left transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <span className="grid place-items-center w-10 h-10 rounded-xl bg-white/5 text-xl shrink-0">{meta.emoji}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-white font-bold text-[15px] leading-tight">{meta.label}</span>
                        <span className="block text-gray-400 text-xs truncate">{a.club_name}</span>
                      </span>
                      <ArrowRightIcon className="w-4 h-4 text-gray-500 shrink-0" />
                    </button>
                  );
                })}
              </div>

              <div className="mt-6 text-center">
                <button
                  onClick={() => { setAccounts(null); setSelectToken(null); setPassword(''); }}
                  className="text-gray-500 hover:text-gray-300 text-xs font-bold transition-colors"
                >
                  ← Usar otra cuenta
                </button>
              </div>
            </div>
          ) : (
            /* ---- Formulario de login ---- */
            <>
              <div className="text-center mb-8">
                <h1 className="text-2xl font-black text-white tracking-tight">Bienvenido de vuelta</h1>
                <p className="text-gray-500 mt-1 text-sm">Ingresa a tu club de poker</p>
              </div>

              <form onSubmit={handleLogin} className="space-y-5">
                <div>
                  <label className="block text-gray-400 text-xs font-bold mb-2 ml-1 uppercase tracking-wider">
                    Correo o teléfono
                  </label>
                  <div className="relative group">
                    <EnvelopeIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 group-focus-within:text-emerald-400 transition-colors" />
                    <input
                      type="text"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-gray-900/60 text-white border border-gray-700 rounded-xl py-3.5 pl-12 pr-4
                                 placeholder-gray-600 transition-all duration-300
                                 focus:outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/10
                                 hover:border-gray-600"
                      placeholder="correo o teléfono (dealers)"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-gray-400 text-xs font-bold mb-2 ml-1 uppercase tracking-wider">
                    Contraseña
                  </label>
                  <div className="relative group">
                    <LockClosedIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 group-focus-within:text-emerald-400 transition-colors" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-gray-900/60 text-white border border-gray-700 rounded-xl py-3.5 pl-12 pr-12
                                 placeholder-gray-600 transition-all duration-300
                                 focus:outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/10
                                 hover:border-gray-600"
                      placeholder="••••••••"
                      required
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-emerald-400 transition-colors p-1">
                      {showPassword ? <EyeSlashIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-2 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold py-4 rounded-xl
                             shadow-[0_0_25px_rgba(16,185,129,0.25)] hover:shadow-[0_0_35px_rgba(16,185,129,0.4)]
                             transition-all duration-300 active:scale-[0.98]
                             disabled:opacity-60 disabled:cursor-not-allowed disabled:shadow-none
                             flex items-center justify-center gap-2 text-sm uppercase tracking-wider"
                >
                  {loading ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      Validando...
                    </>
                  ) : (
                    <>Iniciar sesión <ArrowRightIcon className="w-4 h-4" /></>
                  )}
                </button>
              </form>

              <div className="mt-6 text-center">
                <Link to="/forgot-password" className="text-gray-500 hover:text-gray-300 text-xs font-bold transition-colors">
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>

              <div className="mt-4 text-center text-sm text-gray-500">
                ¿Aún no tienes cuenta?{' '}
                <Link to="/register" className="text-emerald-400 hover:text-emerald-300 font-bold transition-colors relative after:absolute after:bottom-0 after:left-0 after:w-0 hover:after:w-full after:h-px after:bg-emerald-400 after:transition-all">
                  Crea tu Club
                </Link>
              </div>
            </>
          )}
        </div>

        {/* Back to landing */}
        <div className="animate-fade-up delay-300 text-center mt-6">
          <Link to="/" className="text-gray-600 hover:text-gray-400 text-xs font-bold uppercase tracking-wider transition-colors">
            ← Volver al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}
