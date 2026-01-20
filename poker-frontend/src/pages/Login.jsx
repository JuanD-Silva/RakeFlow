// src/pages/Login.jsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
// 👇 1. CAMBIO IMPORTANTE: Importamos el servicio, no 'api' directo
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
      // 👇 2. USAMOS EL SERVICIO
      // Ya no necesitas crear FormData aquí manualmente.
      // authService.login se encarga de convertirlo a URLSearchParams (el formato correcto).
      const data = await authService.login(email, password);

      // 3. Guardar Token (El servicio devuelve response.data, así que accedemos directo)
      localStorage.setItem('token', data.access_token);

      // 4. Entrar al Dashboard
      navigate('/dashboard'); 
      // El reload está bien para limpiar estados anteriores en este MVP
      window.location.reload(); 

    } catch (err) {
      console.error(err);
      // Mensaje de error más amigable
      setError('Credenciales incorrectas o error en el servidor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 px-4">
      <div className="max-w-md w-full bg-gray-800 p-8 rounded-2xl shadow-2xl border border-gray-700">
        
        {/* LOGO / TITULO */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-500">
            RakeFlow
          </h1>
          <p className="text-gray-400 mt-2">Gestión profesional de clubes</p>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-500 text-red-200 p-3 rounded mb-6 text-sm text-center animate-pulse">
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-gray-400 text-sm font-bold mb-2">Correo Electrónico</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-gray-900 text-white border border-gray-600 rounded-lg p-3 focus:outline-none focus:border-emerald-500 transition-colors"
              placeholder="admin@pokerclub.com"
              required
            />
          </div>

          <div>
            <label className="block text-gray-400 text-sm font-bold mb-2">Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-gray-900 text-white border border-gray-600 rounded-lg p-3 focus:outline-none focus:border-emerald-500 transition-colors"
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white font-bold py-3 rounded-lg shadow-lg transform transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Validando...' : 'Iniciar Sesión 🚀'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-gray-500">
          ¿Aún no tienes cuenta?{' '}
          <Link to="/register" className="text-emerald-400 hover:text-emerald-300 font-bold transition-colors">
            Crea tu Club 
          </Link>
        </div>
      </div>
    </div>
  );
}