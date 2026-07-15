import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { publicService } from '../api/services';
import { useAuth } from '../context/AuthContext';

// Activación de la cuenta del JUGADOR (clon del flujo de dealers): verifica el
// número con el código de WhatsApp y crea la contraseña. Auto-login → /jugador.
export default function PlayerActivate() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [params] = useSearchParams();

  const [phone, setPhone] = useState(params.get('phone') || '');
  const [code, setCode] = useState(params.get('code') || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (phone.replace(/\D/g, '').length < 7) { setError('Ingresa tu número.'); return; }
    if (code.trim().length < 4) { setError('Ingresa el código que recibiste.'); return; }
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
      setError('La contraseña debe tener mínimo 8 caracteres, una mayúscula, una minúscula y un número.');
      return;
    }
    setBusy(true);
    try {
      const res = await publicService.activatePlayer({ phone, code: code.trim(), password });
      login(res.access_token);   // auto-login (rol player)
      navigate('/jugador');
    } catch (err) {
      setError(err.response?.data?.detail || 'No se pudo activar la cuenta.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0b1220] via-[#0a0f1a] to-black text-gray-100 font-sans flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <p className="text-emerald-500 text-xs font-black tracking-[0.3em] uppercase">RakeFlow · Jugador</p>
          <h1 className="text-2xl font-black text-white mt-2">Activá tu cuenta</h1>
          <p className="text-gray-400 text-sm mt-1">Tus estadísticas de juego, logros y ranking del club, en tu bolsillo.</p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <Field label="Tu teléfono">
            <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg py-3 px-4 focus:border-emerald-500 outline-none"
              placeholder="300 123 4567" />
          </Field>
          <Field label="Código de verificación">
            <input type="text" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)}
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg py-3 px-4 focus:border-emerald-500 outline-none tracking-[0.3em] font-mono text-center"
              placeholder="••••••" maxLength={10} />
          </Field>
          <Field label="Creá tu contraseña">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg py-3 px-4 focus:border-emerald-500 outline-none"
              placeholder="mín. 8, mayús, minús y número" />
          </Field>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button type="submit" disabled={busy}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl uppercase tracking-wider shadow-lg shadow-emerald-900/30">
            {busy ? 'Activando…' : 'Ver mis estadísticas'}
          </button>
        </form>

        <p className="text-center text-[11px] text-gray-600">Tu número será tu usuario para entrar.</p>
      </div>
    </div>
  );
}

const Field = ({ label, children }) => (
  <div>
    <label className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1.5 block">{label}</label>
    {children}
  </div>
);
