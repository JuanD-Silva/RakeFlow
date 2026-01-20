// src/pages/Login.jsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
// 👇 1. IMPORTAMOS EL SERVICIO (El que tiene el arreglo del header y URLSearchParams)
import { authService } from '../api/services'; 

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // 👇 2. USAMOS LA LÓGICA CENTRALIZADA
      // authService.login ya se encarga de convertir a URLSearchParams
      // y poner los headers correctos. ¡No uses new FormData() aquí!
      const data = await authService.login(email, password);

      // 3. Guardamos el token
      localStorage.setItem('token', data.access_token);

      navigate('/dashboard');
      window.location.reload(); 

    } catch (err) {
      console.error(err);
      setError('Credenciales inválidas. Verifica tu email y contraseña.');
    } finally {
      setLoading(false);
    }
  };

  // 👇 TU DISEÑO VISUAL (INTACTO)
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800 px-4 font-sans">
      
      <div className="max-w-md w-full bg-gray-800/50 backdrop-blur-lg p-8 rounded-2xl border border-gray-700/50 shadow-[0_8px_30px_rgb(0,0,0,0.12)]">
        
        <div className="text-center mb-8">
          <h1 className="text-4xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500 drop-shadow-sm">
            Poker SaaS
          </h1>
          <p className="text-gray-400 mt-2 text-sm font-medium tracking-wide opacity-80">
            GESTIÓN PROFESIONAL DE CLUBES
          </p>
        </div>

        {error && (
          <div className="animate-in fade-in slide-in-from-top-2 duration-300 bg-red-500/10 border border-red-500/20 text-red-200 p-3 rounded-lg mb-6 text-sm text-center shadow-inner">
            <span className="inline-block mr-2">⚠️</span> {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
          <div className="group">
            <label className="block text-gray-400 text-xs font-bold mb-1.5 ml-1 uppercase tracking-wider transition-colors group-focus-within:text-blue-400">
              Correo Electrónico
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-gray-900/80 text-white border border-gray-700 rounded-xl p-3.5 
                         placeholder-gray-600 transition-all duration-300 ease-out
                         focus:outline-none focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/10 
                         hover:border-gray-600"
              placeholder="admin@pokerclub.com"
              required
            />
          </div>

          <div className="group">
            <label className="block text-gray-400 text-xs font-bold mb-1.5 ml-1 uppercase tracking-wider transition-colors group-focus-within:text-blue-400">
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-gray-900/80 text-white border border-gray-700 rounded-xl p-3.5 
                         placeholder-gray-600 transition-all duration-300 ease-out
                         focus:outline-none focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/10 
                         hover:border-gray-600"
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-bold py-3.5 rounded-xl 
                       shadow-[0_0_20px_rgba(37,99,235,0.3)] hover:shadow-[0_0_25px_rgba(37,99,235,0.5)]
                       transform transition-all duration-300 active:scale-[0.98] 
                       disabled:opacity-70 disabled:cursor-not-allowed disabled:shadow-none hover:brightness-110"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Validando...
              </span>
            ) : (
              'Iniciar Sesión'
            )}
          </button>
        </form>

        <div className="mt-8 text-center text-sm text-gray-500">
          ¿Aún no tienes cuenta?{' '}
          <Link to="/register" className="text-blue-400 hover:text-blue-300 hover:underline font-semibold transition-all">
            Crea tu Club
          </Link>
        </div>
      </div>
    </div>
  );
}