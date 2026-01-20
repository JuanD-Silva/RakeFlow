// src/pages/Register.jsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../api/axios';
// 👇 1. IMPORTAMOS EL SERVICIO
import { authService } from '../api/services';

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
      // 1. Registro (Esto suele ser JSON, así que api.post directo está bien)
      await api.post('/auth/register', formData);
      
      // 👇 2. AUTO-LOGIN CORREGIDO
      // En lugar de crear FormData manual (que da error 422),
      // usamos el servicio que ya sabe cómo hablar con FastAPI.
      const loginResponse = await authService.login(formData.email, formData.password);
      
      // 3. Guardar Token y redirigir
      localStorage.setItem('token', loginResponse.access_token); // Ojo: a veces authService devuelve 'access_token' directo o dentro de data. 
      // Revisando authService: devuelve response.data. Así que loginResponse ya es el objeto { access_token: "..." }

      navigate('/setup'); // O '/dashboard' si no tienes setup
      window.location.reload();

    } catch (err) {
      console.error(err);
      if (err.response && err.response.data && err.response.data.detail) {
        setError(err.response.data.detail);
      } else {
        setError('Error al registrar. Inténtalo de nuevo.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800 px-4 font-sans">
      
      <div className="max-w-md w-full bg-gray-800/50 backdrop-blur-lg p-8 rounded-2xl border border-gray-700/50 shadow-[0_8px_30px_rgb(0,0,0,0.12)]">
        
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold text-white tracking-tight">
            Únete a <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">Poker SaaS</span>
          </h1>
          <p className="text-gray-400 mt-2 text-sm font-medium tracking-wide opacity-80">
            GESTIONA TUS PARTIDAS COMO UN PROFESIONAL
          </p>
        </div>

        {error && (
          <div className="animate-in fade-in slide-in-from-top-2 duration-300 bg-red-500/10 border border-red-500/20 text-red-200 p-3 rounded-lg mb-6 text-sm text-center shadow-inner">
             <span className="inline-block mr-2">⚠️</span> {error}
          </div>
        )}

        <form onSubmit={handleRegister} className="space-y-5">
          <div className="group">
            <label className="block text-gray-400 text-xs font-bold mb-1.5 ml-1 uppercase tracking-wider transition-colors group-focus-within:text-green-400">
              Nombre del Club
            </label>
            <input
              type="text"
              name="name"
              onChange={handleChange}
              className="w-full bg-gray-900/80 text-white border border-gray-700 rounded-xl p-3.5 
                         placeholder-gray-600 transition-all duration-300 ease-out
                         focus:outline-none focus:border-green-500/50 focus:ring-4 focus:ring-green-500/10 
                         hover:border-gray-600"
              placeholder="Ej: Royal Poker Club"
              required
            />
          </div>

          <div className="group">
            <label className="block text-gray-400 text-xs font-bold mb-1.5 ml-1 uppercase tracking-wider transition-colors group-focus-within:text-green-400">
              Correo Electrónico
            </label>
            <input
              type="email"
              name="email"
              onChange={handleChange}
              className="w-full bg-gray-900/80 text-white border border-gray-700 rounded-xl p-3.5 
                         placeholder-gray-600 transition-all duration-300 ease-out
                         focus:outline-none focus:border-green-500/50 focus:ring-4 focus:ring-green-500/10 
                         hover:border-gray-600"
              placeholder="tucorreo@ejemplo.com"
              required
            />
          </div>

          <div className="group">
            <label className="block text-gray-400 text-xs font-bold mb-1.5 ml-1 uppercase tracking-wider transition-colors group-focus-within:text-green-400">
              Contraseña
            </label>
            <input
              type="password"
              name="password"
              onChange={handleChange}
              className="w-full bg-gray-900/80 text-white border border-gray-700 rounded-xl p-3.5 
                         placeholder-gray-600 transition-all duration-300 ease-out
                         focus:outline-none focus:border-green-500/50 focus:ring-4 focus:ring-green-500/10 
                         hover:border-gray-600"
              placeholder="Mínimo 6 caracteres"
              minLength="6"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-4 bg-gradient-to-r from-green-600 to-emerald-600 text-white font-bold py-3.5 rounded-xl 
                       shadow-[0_0_20px_rgba(34,197,94,0.3)] hover:shadow-[0_0_25px_rgba(34,197,94,0.5)]
                       transform transition-all duration-300 active:scale-[0.98] 
                       disabled:opacity-70 disabled:cursor-not-allowed disabled:shadow-none hover:brightness-110"
          >
             {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Creando Club...
              </span>
            ) : (
              '✨ Crear Cuenta Gratis'
            )}
          </button>
        </form>

        <div className="mt-8 text-center text-sm text-gray-500">
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" className="text-green-400 hover:text-green-300 hover:underline font-semibold transition-all">
            Inicia Sesión aquí
          </Link>
        </div>
      </div>
    </div>
  );
}