import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../api/axios';
import { authService } from '../api/services';
import { useAuth } from '../context/AuthContext';
import {
  UserIcon,
  EnvelopeIcon,
  LockClosedIcon,
  ExclamationTriangleIcon,
  CheckIcon,
  RocketLaunchIcon,
  EyeIcon,
  EyeSlashIcon,
  ArrowRightIcon
} from '@heroicons/react/24/outline';

export default function Register() {
  const [formData, setFormData] = useState({ name: '', email: '', password: '' });
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [registered, setRegistered] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const passwordRules = [
    { label: 'Minimo 8 caracteres', test: (p) => p.length >= 8 },
    { label: 'Una letra mayuscula', test: (p) => /[A-Z]/.test(p) },
    { label: 'Una letra minuscula', test: (p) => /[a-z]/.test(p) },
    { label: 'Un numero', test: (p) => /[0-9]/.test(p) },
  ];

  const passwordValid = formData.password && passwordRules.every(r => r.test(formData.password));

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    if (!passwordValid) {
      setError('La contrasena no cumple los requisitos de seguridad.');
      setLoading(false);
      return;
    }
    if (formData.password !== confirmPassword) {
      setError('Las contrasenas no coinciden.');
      setLoading(false);
      return;
    }
    if (!acceptTerms) {
      setError('Debes aceptar los Terminos y la Politica de Privacidad para continuar.');
      setLoading(false);
      return;
    }
    try {
      await api.post('/auth/register', { ...formData, accept_terms: true });
      setRegistered(true);
    } catch (err) {
      console.error(err);
      if (err.response?.data?.detail) {
        setError(err.response.data.detail);
      } else {
        setError('Error al registrar. Intentalo de nuevo.');
      }
    } finally {
      setLoading(false);
    }
  };

  const benefits = [
    'Panel de control completo',
    'Reportes financieros en tiempo real',
    'Gestion de torneos y cash games',
  ];

  // Confetti
  useEffect(() => {
    if (registered) {
      import('canvas-confetti').then((confettiModule) => {
        const confetti = confettiModule.default;
        // Primer disparo
        confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 }, colors: ['#10b981', '#06b6d4', '#8b5cf6', '#f59e0b'] });
        // Segundo disparo con delay
        setTimeout(() => {
          confetti({ particleCount: 60, spread: 100, origin: { y: 0.5, x: 0.3 }, colors: ['#10b981', '#06b6d4'] });
          confetti({ particleCount: 60, spread: 100, origin: { y: 0.5, x: 0.7 }, colors: ['#8b5cf6', '#f59e0b'] });
        }, 400);
      });
    }
  }, [registered]);

  // PANTALLA DE TRANSICION — Club creado exitosamente
  if (registered) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0f1a] px-6 py-10 font-sans relative noise-bg">
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-emerald-600/8 rounded-full blur-[120px] animate-drift"></div>
          <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-violet-600/6 rounded-full blur-[100px] animate-drift delay-500"></div>
          <div className="absolute inset-0 opacity-[0.015]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)', backgroundSize: '80px 80px' }}></div>
        </div>

        <div className="relative z-10 w-full max-w-lg text-center">
          <div className="bg-gray-800/30 backdrop-blur-xl p-10 md:p-14 rounded-3xl border border-gray-700/50 shadow-2xl shadow-black/20">

            {/* Icono animado */}
            <div className="animate-scale-in mb-8">
              <div className="w-24 h-24 bg-emerald-500/10 rounded-3xl flex items-center justify-center mx-auto border border-emerald-500/20 shadow-lg shadow-emerald-900/20">
                <span className="text-5xl">🎉</span>
              </div>
            </div>

            <h1 className="animate-fade-up delay-200 text-3xl md:text-4xl font-black text-white tracking-tight mb-4">
              Todo listo!
            </h1>
            <p className="animate-fade-up delay-300 text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400 font-black text-2xl mb-3">
              {formData.name}
            </p>
            <p className="animate-fade-up delay-300 text-gray-400 text-base mb-10 max-w-sm mx-auto leading-relaxed">
              Tu club ya es parte de RakeFlow. Estas a dos pasos de tener el control total de tus finanzas.
            </p>

            <div className="animate-fade-up delay-400 bg-gray-900/40 rounded-2xl p-6 mb-8 border border-gray-700/30">
              <p className="text-white text-sm font-bold mb-4 uppercase tracking-wider">Siguiente: Configurar tu club</p>
              <div className="space-y-4 text-left">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center text-white text-sm font-black flex-shrink-0 shadow-lg shadow-emerald-900/30">1</div>
                  <div>
                    <p className="text-white text-base font-bold">Gastos fijos</p>
                    <p className="text-gray-500 text-sm">Define si tienes una meta mensual de gastos</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-gray-700 flex items-center justify-center text-gray-400 text-sm font-black flex-shrink-0">2</div>
                  <div>
                    <p className="text-gray-300 text-base font-bold">Distribucion de socios</p>
                    <p className="text-gray-500 text-sm">Reparte las ganancias por porcentaje entre socios</p>
                  </div>
                </div>
              </div>
              <p className="text-gray-600 text-xs mt-4 text-center">Solo toma 1 minuto. Puedes cambiarlo despues.</p>
            </div>

            <button
              onClick={async () => {
                try {
                  const loginResponse = await authService.login(formData.email, formData.password);
                  login(loginResponse.access_token);
                  navigate('/setup');
                } catch { navigate('/login'); }
              }}
              className="animate-fade-up delay-600 w-full py-4 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg shadow-emerald-900/20 hover:shadow-[0_0_30px_rgba(16,185,129,0.3)]"
            >
              Configurar mi club <ArrowRightIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0f1a] px-4 py-10 font-sans relative noise-bg">

      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 right-1/4 w-[400px] h-[400px] bg-emerald-600/6 rounded-full blur-[120px] animate-drift"></div>
        <div className="absolute bottom-1/3 left-1/4 w-[350px] h-[350px] bg-cyan-600/5 rounded-full blur-[100px] animate-drift delay-500"></div>
        <div className="absolute inset-0 opacity-[0.015]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)', backgroundSize: '80px 80px' }}></div>
      </div>

      <div className="relative z-10 w-full max-w-md">

        {/* Stepper visual */}
        <div className="animate-fade-up flex items-center justify-center gap-3 mb-8">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-white text-xs font-black">1</div>
            <span className="text-emerald-400 text-xs font-bold uppercase tracking-wider hidden sm:inline">Registro</span>
          </div>
          <div className="w-8 h-px bg-gray-700"></div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-gray-500 text-xs font-black">2</div>
            <span className="text-gray-500 text-xs font-bold uppercase tracking-wider hidden sm:inline">Meta</span>
          </div>
          <div className="w-8 h-px bg-gray-700"></div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-gray-500 text-xs font-black">3</div>
            <span className="text-gray-500 text-xs font-bold uppercase tracking-wider hidden sm:inline">Socios</span>
          </div>
        </div>

        {/* Logo */}
        <div className="text-center mb-8 animate-fade-up delay-100">
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
        <div className="animate-fade-up delay-200 bg-gray-800/30 backdrop-blur-xl p-8 rounded-3xl border border-gray-700/50 shadow-2xl shadow-black/20">

          <div className="text-center mb-6 animate-fade-up delay-300">
            <h1 className="text-2xl font-black text-white tracking-tight">Crea tu Club</h1>
            <p className="text-gray-500 mt-1 text-sm">Comienza a gestionar tu club de poker</p>
          </div>

          {/* Benefits */}
          <div className="animate-fade-up delay-400 bg-emerald-500/5 border border-emerald-500/10 rounded-xl p-4 mb-6 space-y-2">
            {benefits.map((b, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-gray-300" style={{ animationDelay: `${500 + i * 100}ms` }}>
                <CheckIcon className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                {b}
              </div>
            ))}
          </div>

          {error && (
            <div className="animate-fade-up bg-red-500/10 border border-red-500/20 text-red-300 p-4 rounded-xl mb-6 text-sm flex items-center gap-3">
              <ExclamationTriangleIcon className="w-5 h-5 text-red-400 flex-shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleRegister} className="space-y-4">
            <div className="animate-fade-up delay-500">
              <label className="block text-gray-400 text-xs font-bold mb-2 ml-1 uppercase tracking-wider">
                Nombre del Club
              </label>
              <div className="relative group">
                <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 group-focus-within:text-emerald-400 transition-colors duration-300" />
                <input
                  type="text"
                  name="name"
                  onChange={handleChange}
                  className="w-full bg-gray-900/60 text-white border border-gray-700 rounded-xl py-3.5 pl-12 pr-4
                             placeholder-gray-600 transition-all duration-300
                             focus:outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/10
                             hover:border-gray-600"
                  placeholder="Ej: Royal Poker Club"
                  required
                />
              </div>
            </div>

            <div className="animate-fade-up delay-600">
              <label className="block text-gray-400 text-xs font-bold mb-2 ml-1 uppercase tracking-wider">
                Correo Electronico
              </label>
              <div className="relative group">
                <EnvelopeIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 group-focus-within:text-emerald-400 transition-colors duration-300" />
                <input
                  type="email"
                  name="email"
                  onChange={handleChange}
                  className="w-full bg-gray-900/60 text-white border border-gray-700 rounded-xl py-3.5 pl-12 pr-4
                             placeholder-gray-600 transition-all duration-300
                             focus:outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/10
                             hover:border-gray-600"
                  placeholder="tucorreo@ejemplo.com"
                  required
                />
              </div>
            </div>

            <div className="animate-fade-up delay-700">
              <label className="block text-gray-400 text-xs font-bold mb-2 ml-1 uppercase tracking-wider">
                Contrasena
              </label>
              <div className="relative group">
                <LockClosedIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 group-focus-within:text-emerald-400 transition-colors duration-300" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  onChange={handleChange}
                  className="w-full bg-gray-900/60 text-white border border-gray-700 rounded-xl py-3.5 pl-12 pr-12
                             placeholder-gray-600 transition-all duration-300
                             focus:outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/10
                             hover:border-gray-600"
                  placeholder="Minimo 8 caracteres"
                  minLength="8"
                  required
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-emerald-400 transition-colors p-1">
                  {showPassword ? <EyeSlashIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
                </button>
              </div>
              {/* Indicadores de seguridad */}
              {formData.password && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 px-1">
                  {passwordRules.map((rule, i) => {
                    const passes = rule.test(formData.password);
                    return (
                      <div key={i} className="flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full transition-colors ${passes ? 'bg-emerald-500' : 'bg-gray-600'}`}></div>
                        <span className={`text-[10px] font-medium transition-colors ${passes ? 'text-emerald-400' : 'text-gray-500'}`}>{rule.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="animate-fade-up delay-800">
              <label className="block text-gray-400 text-xs font-bold mb-2 ml-1 uppercase tracking-wider">
                Confirmar Contrasena
              </label>
              <div className="relative group">
                <LockClosedIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 group-focus-within:text-emerald-400 transition-colors duration-300" />
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={`w-full bg-gray-900/60 text-white border rounded-xl py-3.5 pl-12 pr-12
                             placeholder-gray-600 transition-all duration-300
                             focus:outline-none focus:ring-2 hover:border-gray-600 ${
                               confirmPassword && formData.password
                                 ? confirmPassword === formData.password
                                   ? 'border-emerald-500/50 focus:border-emerald-500/50 focus:ring-emerald-500/10'
                                   : 'border-red-500/50 focus:border-red-500/50 focus:ring-red-500/10'
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
              {confirmPassword && formData.password && confirmPassword !== formData.password && (
                <p className="text-red-400 text-xs mt-1.5 ml-1 font-medium animate-fade-up">Las contrasenas no coinciden</p>
              )}
            </div>

            <label className="animate-fade-up delay-700 flex items-start gap-3 cursor-pointer select-none group mt-1">
              <input
                type="checkbox"
                checked={acceptTerms}
                onChange={(e) => setAcceptTerms(e.target.checked)}
                className="mt-1 w-4 h-4 rounded border-gray-600 bg-gray-900 text-emerald-500 focus:ring-2 focus:ring-emerald-500/30 focus:ring-offset-0 cursor-pointer accent-emerald-500"
                required
              />
              <span className="text-xs text-gray-400 leading-relaxed group-hover:text-gray-300 transition-colors">
                He leído y acepto los{' '}
                <Link to="/terms" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300 underline decoration-dotted underline-offset-2">
                  Términos y Condiciones
                </Link>{' '}
                y la{' '}
                <Link to="/privacy" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300 underline decoration-dotted underline-offset-2">
                  Política de Privacidad
                </Link>
                .
              </span>
            </label>

            <button
              type="submit"
              disabled={loading || !acceptTerms}
              className="animate-fade-up delay-800 w-full mt-3 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold py-4 rounded-xl
                         shadow-[0_0_25px_rgba(16,185,129,0.25)] hover:shadow-[0_0_35px_rgba(16,185,129,0.4)]
                         transition-all duration-300 active:scale-[0.98]
                         disabled:opacity-60 disabled:cursor-not-allowed disabled:shadow-none
                         flex items-center justify-center gap-2 text-sm uppercase tracking-wider"
            >
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Creando Club...
                </>
              ) : (
                <><RocketLaunchIcon className="w-5 h-5" /> Crear Mi Club</>
              )}
            </button>
          </form>

          <div className="mt-8 text-center text-sm text-gray-500 animate-fade-up delay-800">
            ¿Ya tienes cuenta?{' '}
            <Link to="/login" className="text-emerald-400 hover:text-emerald-300 font-bold transition-colors relative after:absolute after:bottom-0 after:left-0 after:w-0 hover:after:w-full after:h-px after:bg-emerald-400 after:transition-all">
              Inicia Sesion
            </Link>
          </div>
        </div>

        <div className="animate-fade-up delay-800 text-center mt-6">
          <Link to="/" className="text-gray-600 hover:text-gray-400 text-xs font-bold uppercase tracking-wider transition-colors">
            ← Volver al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}
