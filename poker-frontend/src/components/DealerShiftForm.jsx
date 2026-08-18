import { useState, useEffect, useRef } from 'react';
import { dealerService } from '../api/services';
import {
  UserIcon,
  MagnifyingGlassIcon,
  ExclamationTriangleIcon,
  UserPlusIcon,
  CheckBadgeIcon,
  CurrencyDollarIcon,
} from '@heroicons/react/24/outline';

function formatElapsed(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Formulario de turnos de dealer (va dentro del Modal genérico).
 * mode: "start"   → solo selector de dealer (asignar a mesa sin dealer)
 *       "change"  → rake contado del turno saliente + selector del entrante
 *       "end"     → solo rake contado (termina turno, mesa queda sin dealer)
 *       "declare" → rake contado HASTA AHORA (total acumulado, NO cierra el
 *                   turno) — mantiene el pago estimado del dealer al día
 */
export default function DealerShiftForm({ mode, sessionId, currentShift, onSuccess }) {
  const [dealers, setDealers] = useState([]);
  const [dealerId, setDealerId] = useState("");
  const [declaredRake, setDeclaredRake] = useState("");

  // Buscador
  const [searchTerm, setSearchTerm] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [filteredDealers, setFilteredDealers] = useState([]);

  // Crear dealer nuevo
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRate, setNewRate] = useState("");
  const [newPct, setNewPct] = useState("");

  const [loading, setLoading] = useState(false);
  const [loadingDealers, setLoadingDealers] = useState(true);
  const [error, setError] = useState(null);
  const [forceConfirm, setForceConfirm] = useState(null); // detail del 409 dealer en otra mesa

  const wrapperRef = useRef(null);
  const needsDealer = mode === 'start' || mode === 'change';
  const needsRake = mode === 'change' || mode === 'end' || mode === 'declare';

  // El input de rake arranca desde lo YA declarado del turno (declare-rake):
  // en "declare" es el total acumulado que se pisa; en change/end es el piso
  // conocido del total final. Si nunca declararon, queda vacío como siempre.
  useEffect(() => {
    if (needsRake && currentShift?.declared_rake > 0) {
      setDeclaredRake(String(Math.round(currentShift.declared_rake)));
    }
  }, [mode, currentShift]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (needsDealer) loadDealers();
    else setLoadingDealers(false);
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setFilteredDealers(
      dealers.filter(d => d.name.toLowerCase().includes(searchTerm.toLowerCase()))
    );
  }, [searchTerm, dealers]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef]);

  const loadDealers = async () => {
    setLoadingDealers(true);
    try {
      const data = await dealerService.list();
      // En change, no ofrecer al dealer que ya está en mesa
      const filtered = currentShift
        ? data.filter(d => d.id !== currentShift.dealer_id)
        : data;
      setDealers(filtered);
      setFilteredDealers(filtered);
    } catch (err) {
      console.error("Error cargando dealers", err);
      setError("No se pudo cargar la lista de dealers.");
    } finally {
      setLoadingDealers(false);
    }
  };

  const handleSelectDealer = (dealer) => {
    setDealerId(dealer.id);
    setSearchTerm(dealer.name);
    setShowDropdown(false);
  };

  const submit = async (force = false) => {
    setError(null);
    setForceConfirm(null);

    let finalDealerId = dealerId;

    try {
      setLoading(true);

      // Crear dealer nuevo si corresponde
      if (needsDealer && isCreatingNew) {
        if (!newName.trim()) {
          setError("El nombre del dealer es obligatorio.");
          setLoading(false);
          return;
        }
        const created = await dealerService.create({
          name: newName.trim(),
          hourly_rate_cop: parseFloat(newRate) || 0,
          rake_pct: parseFloat(newPct) || 0,
        });
        finalDealerId = created.id;
      }

      if (needsDealer && !finalDealerId) {
        setError("Selecciona un dealer.");
        setLoading(false);
        return;
      }
      if (needsRake && declaredRake === "") {
        setError("Ingresa el rake contado del turno.");
        setLoading(false);
        return;
      }

      const rake = parseFloat(declaredRake) || 0;
      // Guarda: rake en $0 suele ser un Enter sin contar → el % del dealer queda en $0.
      if (needsRake && rake === 0) {
        const ok = window.confirm(
          "El rake contado quedó en $0. ¿Seguro? El componente de % del rake de este dealer será $0."
        );
        if (!ok) { setLoading(false); return; }
      }
      if (mode === 'start') {
        await dealerService.startShift(sessionId, finalDealerId, force);
      } else if (mode === 'change') {
        await dealerService.changeShift(sessionId, finalDealerId, rake, force);
      } else if (mode === 'declare') {
        await dealerService.declareShiftRake(sessionId, rake);
      } else {
        await dealerService.endShift(sessionId, rake);
      }
      onSuccess();
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (err.response?.status === 409 && detail?.includes("turno abierto en")) {
        // Dealer en otra mesa: ofrecer force
        setForceConfirm(detail);
      } else {
        setError(detail || "Error procesando el turno.");
      }
    } finally {
      setLoading(false);
    }
  };

  const titles = {
    start: { btn: "Iniciar Turno", color: "bg-amber-600 hover:bg-amber-500" },
    change: { btn: "Cambiar Dealer", color: "bg-amber-600 hover:bg-amber-500" },
    end: { btn: "Terminar Turno", color: "bg-gray-600 hover:bg-gray-500" },
    declare: { btn: "Guardar rake", color: "bg-emerald-600 hover:bg-emerald-500" },
  };

  return (
    <div className="space-y-5">
      {error && (
        <div className="bg-red-500/10 border border-red-500/50 text-red-200 p-4 rounded-xl text-sm flex items-center gap-3">
          <ExclamationTriangleIcon className="w-5 h-5 text-red-500 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Confirmación force: dealer con turno abierto en otra mesa */}
      {forceConfirm && (
        <div className="bg-amber-500/10 border border-amber-500/50 text-amber-200 p-4 rounded-xl text-sm space-y-3">
          <div className="flex items-center gap-3">
            <ExclamationTriangleIcon className="w-5 h-5 text-amber-500 shrink-0" />
            <span>{forceConfirm}</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => submit(true)}
              disabled={loading}
              className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-bold py-2 rounded-lg text-xs uppercase"
            >
              Asignar igual
            </button>
            <button
              type="button"
              onClick={() => setForceConfirm(null)}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold py-2 rounded-lg text-xs uppercase"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Rake contado del turno que termina */}
      {needsRake && currentShift && (
        <div className="space-y-2">
          <label className="text-gray-400 text-xs font-bold uppercase tracking-wider px-1">
            {mode === 'declare' ? 'Rake contado hasta ahora — turno de ' : 'Rake contado del turno de '}{currentShift.dealer_name}
            <span className="text-gray-600 normal-case font-normal"> · {formatElapsed(currentShift.elapsed_minutes)} en mesa</span>
          </label>
          {mode === 'declare' && (
            <p className="text-[11px] text-gray-500 px-1">
              Es el total del turno hasta este momento (pisa lo declarado antes). Con esto el pago estimado del dealer incluye su % del rake al instante.
            </p>
          )}
          <div className="relative">
            <CurrencyDollarIcon className="absolute left-4 top-4 w-5 h-5 text-gray-500" />
            <input
              type="number"
              inputMode="numeric"
              min="0"
              value={declaredRake}
              onChange={(e) => setDeclaredRake(e.target.value)}
              className="w-full bg-gray-800/80 text-white border border-gray-600 rounded-2xl py-3.5 pl-12 pr-4 focus:outline-none focus:border-amber-500 transition-all text-lg font-mono placeholder-gray-600"
              placeholder="0"
              autoFocus
            />
          </div>
        </div>
      )}

      {/* Selector / creación de dealer */}
      {needsDealer && (
        <div className="space-y-2" ref={wrapperRef}>
          <div className="flex justify-between items-center px-1">
            <label className="text-gray-400 text-xs font-bold uppercase tracking-wider">
              {isCreatingNew ? "Nuevo Dealer" : (mode === 'change' ? "Dealer entrante" : "Buscar Dealer")}
            </label>
            <button
              type="button"
              onClick={() => {
                setIsCreatingNew(!isCreatingNew);
                setDealerId("");
                setSearchTerm("");
                setError(null);
              }}
              className="text-[10px] font-bold text-amber-400 hover:text-white hover:bg-amber-500 transition-all bg-amber-500/10 px-3 py-1.5 rounded-full border border-amber-500/30 flex items-center gap-1"
            >
              {isCreatingNew ? <><MagnifyingGlassIcon className="w-3 h-3"/> Volver a Buscar</> : <><UserPlusIcon className="w-3 h-3"/> Crear Nuevo</>}
            </button>
          </div>

          {isCreatingNew ? (
            <div className="bg-gray-800/50 p-4 rounded-2xl border border-gray-700 space-y-3 shadow-inner">
              <div className="relative">
                <UserIcon className="absolute left-3 top-3.5 w-5 h-5 text-gray-500" />
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-gray-900/50 text-white border border-gray-600 rounded-xl py-3 pl-10 pr-4 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition-all placeholder-gray-600"
                  placeholder="Nombre del dealer"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-500 text-[10px] font-bold uppercase px-1">$ / hora</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    value={newRate}
                    onChange={(e) => setNewRate(e.target.value)}
                    className="w-full bg-gray-900/50 text-white border border-gray-600 rounded-xl py-2.5 px-3 focus:border-amber-500 outline-none font-mono"
                    placeholder="20000"
                  />
                </div>
                <div>
                  <label className="text-gray-500 text-[10px] font-bold uppercase px-1">% del rake</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="100"
                    value={newPct}
                    onChange={(e) => setNewPct(e.target.value)}
                    className="w-full bg-gray-900/50 text-white border border-gray-600 rounded-xl py-2.5 px-3 focus:border-amber-500 outline-none font-mono"
                    placeholder="10"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="relative">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-4 top-4 w-5 h-5 text-gray-500" />
                <input
                  type="text"
                  value={searchTerm}
                  onClick={() => setShowDropdown(true)}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setDealerId("");
                    setShowDropdown(true);
                  }}
                  className={`w-full bg-gray-800/80 text-white border ${dealerId ? 'border-amber-500/50 bg-amber-900/10' : 'border-gray-600'} rounded-2xl py-3.5 pl-12 pr-4 focus:outline-none focus:border-amber-500 transition-all text-lg font-medium placeholder-gray-600 shadow-lg`}
                  placeholder={loadingDealers ? "Cargando dealers..." : "Buscar dealer..."}
                  disabled={loadingDealers}
                />
                {dealerId && <CheckBadgeIcon className="absolute right-4 top-4 w-6 h-6 text-amber-500" />}
              </div>

              {showDropdown && !loadingDealers && (
                <div className="absolute z-50 w-full mt-2 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl max-h-60 overflow-y-auto custom-scrollbar">
                  {filteredDealers.length > 0 ? (
                    filteredDealers.map((d) => (
                      <div
                        key={d.id}
                        onClick={() => handleSelectDealer(d)}
                        className="p-3.5 hover:bg-amber-600/20 hover:border-l-4 hover:border-amber-500 cursor-pointer border-b border-gray-800 transition-all flex items-center justify-between group"
                      >
                        <p className="font-bold text-gray-200 group-hover:text-white">{d.name}</p>
                        <p className="text-xs text-gray-500 font-mono">
                          ${(d.hourly_rate_cop || 0).toLocaleString('es-CO')}/h · {d.rake_pct || 0}%
                        </p>
                      </div>
                    ))
                  ) : (
                    <div className="p-6 text-gray-500 text-center text-sm flex flex-col items-center gap-2">
                      <UserIcon className="w-8 h-8 opacity-50" />
                      {dealers.length === 0 ? "No hay dealers. Crea el primero con \"Crear Nuevo\"." : "No encontrado"}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Submit */}
      <button
        type="button"
        onClick={() => submit(false)}
        disabled={loading || !!forceConfirm}
        className={`w-full ${titles[mode].color} disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl text-sm uppercase tracking-wider transition-all active:scale-[0.98] shadow-lg`}
      >
        {loading ? "Procesando..." : titles[mode].btn}
      </button>
    </div>
  );
}
