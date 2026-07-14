import { useEffect, useState } from 'react';
import { clubPublicService } from '../api/services';

/**
 * Sección de Configuración: link público del club (para compartir por WhatsApp)
 * + anuncio "Hoy se rompe".
 */
export default function ClubPublicLink() {
  const [token, setToken] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const [showJackpot, setShowJackpot] = useState(true);
  const [savedMsg, setSavedMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const d = await clubPublicService.get();
        setToken(d.public_token);
        setAnnouncement(d.public_announcement || '');
        setShowJackpot(d.show_jackpot !== false);
      } catch { /* ignora */ }
      finally { setLoading(false); }
    })();
  }, []);

  const url = token ? `${window.location.origin}/c/${token}` : '';

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); } catch { /* ignora */ }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const shareWhatsApp = () => {
    const text = `Actividad en vivo de nuestro club 👇\n${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  const toggleJackpot = async () => {
    const next = !showJackpot;
    setShowJackpot(next);  // optimista: el switch responde al toque
    try {
      await clubPublicService.setShowJackpot(next);
      setSavedMsg('Guardado ✓'); setTimeout(() => setSavedMsg(''), 2000);
    } catch {
      setShowJackpot(!next);  // revertir si el server rechazó
      setSavedMsg('Error al guardar');
    }
  };

  const saveAnnouncement = async () => {
    try {
      await clubPublicService.updateAnnouncement(announcement);
      setSavedMsg('Guardado ✓'); setTimeout(() => setSavedMsg(''), 2000);
    } catch { setSavedMsg('Error al guardar'); }
  };

  if (loading) return null;

  return (
    <div className="bg-gray-800/40 border border-gray-700/50 rounded-2xl p-5 space-y-4">
      <div>
        <h3 className="text-white font-bold flex items-center gap-2">🔗 Link público del club</h3>
        <p className="text-gray-500 text-xs mt-0.5">Compartilo en tu grupo: los jugadores ven mesas y torneos en vivo.</p>
      </div>

      {url && (
        <>
          <div className="flex items-center gap-2 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2">
            <span className="text-emerald-400 text-xs font-mono truncate flex-1">{url}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={copy} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold py-2 rounded-lg transition-colors">
              {copied ? 'Copiado ✓' : 'Copiar link'}
            </button>
            <button onClick={shareWhatsApp} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-2 rounded-lg transition-colors">
              Compartir por WhatsApp
            </button>
          </div>
        </>
      )}

      <div className="pt-2 border-t border-gray-700/50">
        <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">
          Anuncio "Hoy se rompe" (opcional)
        </label>
        <div className="flex gap-2">
          <input
            type="text" value={announcement} maxLength={120}
            onChange={(e) => setAnnouncement(e.target.value)}
            placeholder="Ej: Hoy se rompe a las 8pm 🔥"
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-emerald-500 focus:outline-none"
          />
          <button onClick={saveAnnouncement} className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 rounded-lg transition-colors">
            Guardar
          </button>
        </div>
        {savedMsg && <p className="text-emerald-400 text-[11px] mt-1">{savedMsg}</p>}
      </div>

      {/* Jackpot visible para los jugadores (link público + su panel). Es el
          MISMO número del widget de la mesa: entradas − pagos + ajustes. */}
      <div className="pt-3 border-t border-gray-700/50">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-bold">🎰 Mostrar el jackpot a los jugadores</p>
            <p className="text-gray-400 text-[11px] leading-snug mt-0.5">
              Aparece en el link público y en el panel de cada jugador. Es el mismo saldo que ves en la mesa; se actualiza al cerrar la caja.
            </p>
          </div>
          <button
            onClick={toggleJackpot}
            role="switch"
            aria-checked={showJackpot}
            aria-label="Mostrar el jackpot a los jugadores"
            className={`relative shrink-0 w-12 h-7 rounded-full transition-colors ${showJackpot ? 'bg-emerald-500' : 'bg-gray-600'}`}
          >
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${showJackpot ? 'left-6' : 'left-1'}`} />
          </button>
        </div>
      </div>
    </div>
  );
}
