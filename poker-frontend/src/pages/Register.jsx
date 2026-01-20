// src/pages/Register.jsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../api/axios';

export default function Register() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // 1. Registrar Club
      await api.post('/auth/register', formData);
      
      // 2. Auto-Login inmediato (Opcional, pero mejora UX)
      const loginData = new FormData();
      loginData.append('username', formData.email);
      loginData.append('password', formData.password);
      
      const loginResponse = await api.post('/auth/login', loginData);
      localStorage.setItem('token', loginResponse.data.access_token);

      // 3. Ir al dashboard
      navigate('/setup');
      window.location.reload();

    } catch (err) {
      console.error(err);
      if (err.response && err.response.data && err.response.data.detail) {
        setError(err.response.data.detail); // Mensaje del backend (ej: "Email ya existe")
      } else {
        setError('Error al registrar. Inténtalo de nuevo.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 px-4">
      <div className="max-w-md w-full bg-gray-800 p-8 rounded-2xl shadow-2xl border border-gray-700">
        
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white">Únete a Poker SaaS</h1>
          <p className="text-gray-400 mt-2">Gestiona tus partidas como un profesional</p>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-500 text-red-200 p-3 rounded mb-6 text-sm text-center">
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleRegister} className="space-y-4">
          <div>
            <label className="block text-gray-400 text-sm font-bold mb-2">Nombre del Club</label>
            <input
              type="text"
              name="name"
              onChange={handleChange}
              className="w-full bg-gray-900 text-white border border-gray-600 rounded-lg p-3 focus:border-green-500 outline-none"
              placeholder="Ej: Royal Poker Club"
              required
            />
          </div>

          <div>
            <label className="block text-gray-400 text-sm font-bold mb-2">Correo Electrónico</label>
            <input
              type="email"
              name="email"
              onChange={handleChange}
              className="w-full bg-gray-900 text-white border border-gray-600 rounded-lg p-3 focus:border-green-500 outline-none"
              placeholder="tucorreo@ejemplo.com"
              required
            />
          </div>

          <div>
            <label className="block text-gray-400 text-sm font-bold mb-2">Contraseña</label>
            <input
              type="password"
              name="password"
              onChange={handleChange}
              className="w-full bg-gray-900 text-white border border-gray-600 rounded-lg p-3 focus:border-green-500 outline-none"
              placeholder="Mínimo 6 caracteres"
              minLength="6"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 rounded-lg shadow-lg transform transition-all active:scale-95 disabled:opacity-50 mt-4"
          >
            {loading ? 'Creando Club...' : '✨ Crear Cuenta Gratis'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-gray-500">
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" className="text-green-400 hover:text-green-300 font-bold transition-colors">
            Inicia Sesión aquí
          </Link>
        </div>
      </div>
    </div>
  );
}