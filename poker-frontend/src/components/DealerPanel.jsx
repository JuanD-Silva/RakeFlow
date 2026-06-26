import { useState, useEffect } from 'react';
import { dealerService } from '../api/services';
import Modal from './Modal';
import DealerShiftForm from './DealerShiftForm';
import { ClockIcon, ArrowsRightLeftIcon, PauseIcon } from '@heroicons/react/24/outline';

function formatElapsed(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Barra de dealer en la mesa cash: dealer actual + cronómetro de turno +
 * cambiar/terminar. Si el club no usa dealers es solo un botón discreto.
 *
 * El cronómetro usa elapsed_minutes que calcula el backend (no parsea
 * datetimes naive en el front) y tickea localmente cada 30s.
 */
export default function DealerPanel({ sessionId, refreshTrigger }) {
  const [openShift, setOpenShift] = useState(null);
  const [localMinutes, setLocalMinutes] = useState(0);
  const [modalMode, setModalMode] = useState(null); // "start" | "change" | "end" | null
  const [loadedAt, setLoadedAt] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const shifts = await dealerService.getShifts(sessionId);
        if (cancelled) return;
        const open = shifts.find(s => !s.end_time) || null;
        setOpenShift(open);
        setLocalMinutes(open ? open.elapsed_minutes : 0);
        setLoadedAt(Date.now());
      } catch (err) {
        console.error("Error cargando turno de dealer", err);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId, refreshTrigger, reloadKey]);

  // Tick local del cronómetro cada 30s a partir del elapsed del backend
  useEffect(() => {
    if (!openShift) return;
    const interval = setInterval(() => {
      const driftMin = Math.floor((Date.now() - loadedAt) / 60000);
      setLocalMinutes(openShift.elapsed_minutes + driftMin);
    }, 30000);
    return () => clearInterval(interval);
  }, [openShift, loadedAt]);

  const handleSuccess = () => {
    setModalMode(null);
    setReloadKey(k => k + 1);
  };

  if (!sessionId) return null;

  return (
    <>
      {openShift ? (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3 flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-9 h-9 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center justify-center shrink-0">
              <span className="text-base">🃏</span>
            </div>
            <div className="min-w-0">
              <p className="text-white font-bold text-sm truncate">{openShift.dealer_name}</p>
              <p className="text-amber-400/80 text-xs flex items-center gap-1.5 font-mono flex-wrap">
                <ClockIcon className="w-3.5 h-3.5" /> {formatElapsed(localMinutes)}
                {openShift.hourly_rate_cop > 0 && (
                  <span className="text-emerald-400/90">
                    · ~${Math.round((localMinutes / 60) * openShift.hourly_rate_cop).toLocaleString('es-CO')} hrs
                    {openShift.rake_pct > 0 && <span className="text-gray-500"> + {openShift.rake_pct}% rake</span>}
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setModalMode("change")}
              className="flex-1 md:flex-none bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold px-4 py-2.5 rounded-lg transition-all active:scale-[0.98] flex items-center justify-center gap-1.5"
            >
              <ArrowsRightLeftIcon className="w-4 h-4" /> Cambiar
            </button>
            <button
              onClick={() => setModalMode("end")}
              className="flex-1 md:flex-none bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-bold px-4 py-2.5 rounded-lg border border-gray-700 transition-all active:scale-[0.98] flex items-center justify-center gap-1.5"
            >
              <PauseIcon className="w-4 h-4" /> Terminar
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setModalMode("start")}
          className="group/assign w-full bg-gradient-to-r from-amber-500/10 to-amber-600/5 hover:from-amber-500/20 hover:to-amber-600/10 border border-amber-500/30 hover:border-amber-500/60 rounded-xl px-4 py-3 transition-all active:scale-[0.99] flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-500/15 border border-amber-500/30 rounded-lg flex items-center justify-center shrink-0 group-hover/assign:scale-110 transition-transform">
              <span className="text-base">🃏</span>
            </div>
            <div className="text-left">
              <p className="text-amber-300 font-bold text-sm leading-tight">Asignar dealer</p>
              <p className="text-amber-400/50 text-[11px] leading-tight">Lleva sus horas y % del rake</p>
            </div>
          </div>
          <span className="text-amber-400 text-lg font-bold group-hover/assign:translate-x-0.5 transition-transform shrink-0">+</span>
        </button>
      )}

      <Modal
        isOpen={!!modalMode}
        onClose={() => setModalMode(null)}
        title={
          modalMode === "start" ? "Asignar Dealer" :
          modalMode === "change" ? "Cambio de Dealer" : "Terminar Turno"
        }
      >
        {modalMode && (
          <DealerShiftForm
            mode={modalMode}
            sessionId={sessionId}
            currentShift={openShift}
            onSuccess={handleSuccess}
          />
        )}
      </Modal>
    </>
  );
}
