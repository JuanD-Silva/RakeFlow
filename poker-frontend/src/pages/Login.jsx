// src/pages/Login.jsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../api/axios';

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
      // 1. Enviar credenciales (Ojo: OAuth2 pide FormData, pero aquí lo enviamos como JSON si tu backend lo acepta,
      // o como x-www-form-urlencoded. Tu backend usa OAuth2PasswordRequestForm, así que espera form-data).
      
      const formData = new FormData();
      formData.append('username', email); // Backend espera 'username' aunque sea email
      formData.append('password', password);

      const response = await api.post('/auth/login', formData);

      // 2. Guardar Token
      const { access_token } = response.data;
      localStorage.setItem('token', access_token);

      // 3. Entrar al Dashboard
      navigate('/dashboard'); 
      window.location.reload(); // Recarga para asegurar que carguen los datos del club

    } catch (err) {
      console.error(err);
      setError('Credenciales inválidas. Verifica tu email y contraseña.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 px-4">
      <div className="max-w-md w-full bg-gray-800 p-8 rounded-2xl shadow-2xl border border-gray-700">
        
        {/* LOGO / TITULO */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
            Poker SaaS
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
              className="w-full bg-gray-900 text-white border border-gray-600 rounded-lg p-3 focus:outline-none focus:border-blue-500"
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
              className="w-full bg-gray-900 text-white border border-gray-600 rounded-lg p-3 focus:outline-none focus:border-blue-500"
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white font-bold py-3 rounded-lg shadow-lg transform transition-all active:scale-95 disabled:opacity-50"
          >
            {loading ? 'Validando...' : 'Iniciar Sesión 🚀'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-gray-500">
          ¿Aún no tienes cuenta?{' '}
          <Link to="/register" className="text-blue-400 hover:text-blue-300 font-bold transition-colors">
            Crea tu Club Gratis
          </Link>
        </div>
      </div>
    </div>
  );
}