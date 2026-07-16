import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { publicService } from '../api/services';
import { useAuth } from '../context/AuthContext';

// Auto-registro del JUGADOR por QR (self-service, sin OTP). El club se
// identifica por su public_token en la URL (/c/:token/entrar). El jugador entra
// nombre + teléfono + clave y obtiene su panel al toque; auto-login → /jugador.
// Si ya tiene cuenta en el club (409), lo mandamos a iniciar sesión.
export default function PlayerSelfRegister() {
  const navigate = useNavigate();
  const { token } = useParams();
  const { login } = useAuth();

  const [clubName, setClubName] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [alreadyHas, setAlreadyHas] = useState(false);
  const [busy, setBusy] = useState(false);

  // Personalizar con el nombre del club (mismo endpoint público del link).
  useEffect(() => {
    let alive = true;
    publicService.getClubActivity(token)
      .then((d) => { if (alive) setClubName(d?.club_name || ''); })
      .catch(() => { /* si falla, mostramos genérico */ });
    return () => { alive = false; };
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setAlreadyHas(false);
    if (name.trim().length < 2) { setError('Escribe tu nombre.'); return; }
    if (phone.replace(/\D/g, '').length < 7) { setError('Escribe tu número.'); return; }
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
      setError('La contraseña debe tener mínimo 8 caracteres, una mayúscula, una minúscula y un número.');
      return;
    }
    setBusy(true);
    try {
      const res = await publicService.selfRegisterPlayer({
        club_token: token, name: name.trim(), phone, password,
      });
      login(res.access_token);   // auto-login (rol player)
      navigate('/jugador');
    } catch (err) {
      if (err.response?.status === 409) {
        setAlreadyHas(true);
        setError('Ya tienes una cuenta en este club. Inicia sesión con tu teléfono.');
      } else {
        setError(err.response?.data?.detail || 'No pudimos crear tu cuenta. Intenta de nuevo.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0b1220] via-[#0a0f1a] to-black text-gray-100 font-sans flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <p className="text-emerald-500 text-xs font-black tracking-[0.3em] uppercase">
            {clubName || 'RakeFlow'} · Jugador
          </p>
          <h1 className="text-2xl font-black text-white mt-2">Entra a tu panel</h1>
          <p className="text-gray-400 text-sm mt-1">
            Tu ranking, tus logros y tu estatus en {clubName || 'el club'} — en tu bolsillo. Sin descargar nada.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <Field label="Tu nombre">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg py-3 px-4 focus:border-emerald-500 outline-none"
              placeholder="Como te conocen en el club" />
          </Field>
          <Field label="Tu teléfono">
            <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg py-3 px-4 focus:border-emerald-500 outline-none"
              placeholder="300 123 4567" />
          </Field>
          <Field label="Crea tu contraseña">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg py-3 px-4 focus:border-emerald-500 outline-none"
              placeholder="mín. 8, mayús, minús y número" />
          </Field>

          {error && <p className={`text-sm ${alreadyHas ? 'text-amber-400' : 'text-red-400'}`}>{error}</p>}
          {alreadyHas && (
            <Link to="/login"
              className="block text-center w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 rounded-xl uppercase tracking-wider">
              Iniciar sesión
            </Link>
          )}

          <button type="submit" disabled={busy}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl uppercase tracking-wider shadow-lg shadow-emerald-900/30">
            {busy ? 'Creando…' : 'Ver mi panel'}
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
