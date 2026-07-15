import { useEffect, useState } from 'react';
import { authService } from '../api/services';
import { useAuth } from '../context/AuthContext';
import { ROLE_META, homeForRole } from '../utils/accountMeta';

// Switcher de cuenta dentro de la app (multi-cuenta): quien juega y también
// dealea, o juega en varios clubes, salta entre sus cuentas SIN volver a
// escribir la clave. Solo aparece si la sesión abrió más de una cuenta
// (el backend limita /auth/my-accounts a las que la clave del login abrió).
// Para una sola cuenta (todos hoy) no renderiza nada: los headers no cambian.
export default function AccountSwitcher() {
  const { userId, uids, login } = useAuth();
  const multi = (uids?.length || 0) > 1;   // el token ya sabe cuántas cuentas hay
  const [accounts, setAccounts] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!multi) return undefined;   // una sola cuenta: ni consulta la API
    let cancelled = false;
    authService.myAccounts()
      .then((d) => { if (!cancelled) setAccounts(d.accounts || []); })
      .catch(() => { /* sin switcher: la app sigue con la cuenta actual */ });
    return () => { cancelled = true; };
  }, [multi]);

  if (!multi || accounts.length <= 1) return null;

  const switchTo = async (uid) => {
    if (uid === userId || busy) return;
    setBusy(true);
    try {
      const data = await authService.switchAccount(uid);
      login(data.access_token);
      // Recarga limpia en el home del nuevo rol: el panel de jugador y el de
      // dealer son mundos distintos; re-montar evita cualquier estado viejo.
      window.location.assign(homeForRole(data.role));
    } catch {
      setBusy(false);   // reintentar; la cuenta actual queda intacta
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Cambiar de cuenta"
        className="rf-tap shrink-0 flex items-center gap-1.5 text-xs font-bold text-emerald-300/90 hover:text-white border border-emerald-500/30 bg-emerald-500/10 rounded-lg px-2.5 py-1.5"
      >
        <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" aria-hidden="true">
          <path d="M4 7h13m0 0-3-3m3 3-3 3M20 17H7m0 0 3-3m-3 3 3 3"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Cambiar
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-md bg-[#0c121e] border-t border-x border-gray-700/60 rounded-t-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] animate-fade-up">
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-gray-600" />
            <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-3 px-1">Cambiar de cuenta</p>
            <div className="flex flex-col gap-2">
              {accounts.map((a) => {
                const meta = ROLE_META[a.role] || { emoji: '👤', label: a.role };
                const current = a.user_id === userId;
                return (
                  <button
                    key={a.user_id}
                    disabled={busy || current}
                    onClick={() => switchTo(a.user_id)}
                    className={`rf-tap flex items-center gap-3 rounded-xl border px-3 py-3 text-left ${
                      current
                        ? 'border-emerald-500/50 bg-emerald-500/10'
                        : 'border-gray-700/60 bg-white/[0.03] hover:bg-white/[0.06] disabled:opacity-60'
                    }`}
                  >
                    <span className="grid place-items-center w-9 h-9 rounded-lg bg-white/5 text-lg shrink-0">{meta.emoji}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-bold text-white">{meta.label}</span>
                      <span className="block text-xs text-gray-400 truncate">{a.club_name}</span>
                    </span>
                    {current
                      ? <span className="text-emerald-400 font-black shrink-0">✓</span>
                      : <span className="text-gray-500 shrink-0">›</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
