import { useState, useEffect, useRef } from 'react';
// 👇 MANTENEMOS TUS IMPORTS ORIGINALES QUE SÍ FUNCIONAN
import { transactionService, playerService, sessionService, dealerService } from '../api/services';
import { 
  UserIcon, 
  MagnifyingGlassIcon, 
  PhoneIcon, 
  CurrencyDollarIcon, 
  BanknotesIcon, 
  DevicePhoneMobileIcon, 
  ExclamationTriangleIcon,
  UserPlusIcon,
  CheckBadgeIcon
} from '@heroicons/react/24/outline';

export default function TransactionForm({ type, onSuccess, sessionId, createSessionFirst = false, pendingTableName = null }) {
  // --- ESTADOS DE DATOS ---
  const [players, setPlayers] = useState([]);
  const [playerId, setPlayerId] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [bonusAll, setBonusAll] = useState(false); // bono para toda la mesa

  // --- ESTADOS DEL BUSCADOR ---
  const [searchTerm, setSearchTerm] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [filteredPlayers, setFilteredPlayers] = useState([]); // Agregamos estado para filtrar
  
  // --- ESTADOS CREACIÓN JUGADOR ---
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState("");
  const [newPlayerPhone, setNewPlayerPhone] = useState("");

  const [loading, setLoading] = useState(false);
  const [loadingPlayers, setLoadingPlayers] = useState(true);
  const [error, setError] = useState(null);

  // --- PROPINA: a qué dealer se le dio ---
  const [tipDealers, setTipDealers] = useState([]);
  const [tipDealerId, setTipDealerId] = useState(null);     // null = sin asignar
  const [onShiftDealerId, setOnShiftDealerId] = useState(null);

  const wrapperRef = useRef(null);

  // 1. CARGA INICIAL
  useEffect(() => {
    setPlayerId("");
    setSearchTerm("");
    setIsCreatingNew(false);
    setAmount("");
    setPaymentMethod("CASH");
    setBonusAll(false);

    if (type === 'tip') {
      setLoadingPlayers(false);
    } else {
      loadPlayers();
    }
  }, [type]);

  // 1b. PROPINA: solo dealers que tuvieron turno en ESTA sesión (en turno
  // activo o en pausa), igual que cashout solo lista jugadores de la mesa.
  // NO mostramos todos los dealers del club. Preselecciona al que está en turno.
  useEffect(() => {
    if (type !== 'tip') return;
    let cancelled = false;
    (async () => {
      try {
        const shifts = sessionId
          ? await dealerService.getShifts(sessionId).catch(() => [])
          : [];
        if (cancelled) return;
        const open = shifts.find(s => !s.end_time);
        // Dealers únicos que dealearon en esta sesión (el de turno abierto primero)
        const seen = new Map();
        for (const s of shifts) {
          if (!seen.has(s.dealer_id)) {
            seen.set(s.dealer_id, { id: s.dealer_id, name: s.dealer_name });
          }
        }
        const list = [...seen.values()].sort(
          (a, b) => (b.id === open?.dealer_id) - (a.id === open?.dealer_id)
        );
        setTipDealers(list);
        if (open) {
          setOnShiftDealerId(open.dealer_id);
          setTipDealerId(open.dealer_id); // preselecciona al dealer en turno
        }
      } catch (err) {
        console.error("Error cargando dealers de la sesión para propina", err);
      }
    })();
    return () => { cancelled = true; };
  }, [type, sessionId]);

  // 2. FILTRADO DE JUGADORES
  useEffect(() => {
    if (players.length > 0) {
      const filtered = players.filter(player =>
        player.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredPlayers(filtered);
    }
  }, [searchTerm, players]);

  // 3. CLICK OUTSIDE
  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef]);

  const loadPlayers = async () => {
    setLoadingPlayers(true);
    try {
      let data = [];
      if (type === 'buyin') {
        data = await playerService.getAll();
      } else {
        // Para cashout/spend/jackpot/bonus: jugadores que estan en la mesa actual
        const stats = await sessionService.getActiveSession(sessionId);
        if (stats) {
          data = stats.map(s => ({
            id: s.player_id,
            name: s.name,
            phone: s.phone
          }));
        }
      }
      const sorted = data.sort((a, b) => a.name.localeCompare(b.name));
      setPlayers(sorted);
      setFilteredPlayers(sorted);
    } catch (err) {
      console.error("Error cargando jugadores", err);
      setError("No se pudo cargar la lista.");
    } finally {
      setLoadingPlayers(false);
    }
  };

  // --- CONFIGURACIÓN VISUAL MEJORADA ---
  const getConfig = () => {
    switch (type) {
      case 'buyin': return { label: 'Entrada / Recompra', color: 'bg-emerald-600', hover: 'hover:bg-emerald-500', ring: 'focus:ring-emerald-500', icon: '💰', theme: 'emerald' };
      case 'cashout': return { label: 'Retiro (Cashout)', color: 'bg-rose-600', hover: 'hover:bg-rose-500', ring: 'focus:ring-rose-500', icon: '💸', theme: 'rose' };
      case 'spend': return { label: 'Gasto / Bebida', color: 'bg-blue-600', hover: 'hover:bg-blue-500', ring: 'focus:ring-blue-500', icon: '🍺', theme: 'blue' };
      case 'jackpot-payout': return { label: 'Pago de Jackpot', color: 'bg-purple-600', hover: 'hover:bg-purple-500', ring: 'focus:ring-purple-500', icon: '🎁', theme: 'purple' };
      case 'tip': return { label: 'Propina Dealer', color: 'bg-yellow-600', hover: 'hover:bg-yellow-500', ring: 'focus:ring-yellow-500', icon: '🤝', theme: 'yellow' };
      case 'bonus': return { label: 'Bono / Regalo', color: 'bg-pink-600', hover: 'hover:bg-pink-500', ring: 'focus:ring-pink-500', icon: '✨', theme: 'pink' };
      default: return { label: 'Transacción', color: 'bg-gray-600', hover: 'hover:bg-gray-500', ring: 'focus:ring-gray-500', icon: '📝', theme: 'gray' };
    }
  };
  const config = getConfig();

  const handleSelectPlayer = (player) => {
    setPlayerId(player.id);
    setSearchTerm(player.name);
    setShowDropdown(false);
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    // Bono para toda la mesa: no requiere jugador; aplica a todos los activos.
    if (type === 'bonus' && bonusAll) {
      if (!amount || amount <= 0) return setError("El monto debe ser mayor a 0.");
      setLoading(true);
      try {
        await transactionService.bonusAll(parseFloat(amount), sessionId);
        onSuccess();
      } catch (err) {
        setError(err.response?.data?.detail || err.message || "Error al procesar.");
      } finally {
        setLoading(false);
      }
      return;
    }

    if (type !== 'tip') {
      if (!isCreatingNew && !playerId) return setError("Selecciona un jugador de la lista.");
      if (isCreatingNew && !newPlayerName.trim()) return setError("El nombre es obligatorio.");
    }
    if (!amount || amount <= 0) return setError("El monto debe ser mayor a 0.");

    setLoading(true);

    try {
      let finalPlayerId = playerId;
      const amt = parseFloat(amount);
      let activeSessionId = sessionId;

      // Si es apertura de mesa, crear la sesión primero (con nombre opcional)
      let createdSessionId = null;
      if (createSessionFirst && !sessionId) {
        const newSession = await sessionService.createSession(pendingTableName || null);
        activeSessionId = newSession.id;
        createdSessionId = newSession.id;
      }

      if (isCreatingNew && type === 'buyin') {
        const phoneToSend = newPlayerPhone.trim() === "" ? null : newPlayerPhone;
        const newPlayer = await playerService.create(newPlayerName, phoneToSend);
        finalPlayerId = newPlayer.id;
      }

      const pId = type === 'tip' ? null : parseInt(finalPlayerId);

      switch (type) {
        case 'buyin':
            await transactionService.buyin(pId, amt, paymentMethod, activeSessionId);
            break;
        case 'cashout':
            await transactionService.cashout(pId, amt, activeSessionId);
            break;
        case 'spend':
            await transactionService.spend(pId, amt, activeSessionId);
            break;
        case 'bonus':
            await transactionService.bonus(pId, amt, activeSessionId);
            break;
        case 'jackpot-payout':
            await transactionService.jackpotPayout(pId, amt, activeSessionId);
            break;
        case 'tip':
            await transactionService.tip(pId, amt, activeSessionId, tipDealerId);
            break;
        default: throw new Error("Tipo desconocido");
      }
      onSuccess(createdSessionId ? { newSessionId: createdSessionId } : undefined);

    } catch (err) {
      console.error(err);
      setError(err.response?.data?.detail || err.message || "Error al procesar.");
    } finally {
      setLoading(false);
    }
  };

  const shortcuts = (type === 'tip' || type === 'spend') 
    ? [2000, 5000, 10000, 20000] 
    : [50000, 100000, 200000, 500000];

  return (
    <form onSubmit={handleSubmit} className="space-y-6 animate-fade-in relative">
      
      {/* MENSAJE DE ERROR */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/50 text-red-200 p-4 rounded-xl text-sm flex items-center gap-3 animate-pulse">
          <ExclamationTriangleIcon className="w-5 h-5 text-red-500" />
          <span>{error}</span>
        </div>
      )}

      {/* --- BONO PARA TODA LA MESA (toggle) --- */}
      {type === 'bonus' && (
        <div className="flex items-center justify-between bg-pink-900/15 border border-pink-500/30 rounded-xl px-4 py-3">
          <div className="min-w-0">
            <p className="text-pink-200 font-bold text-sm">🎉 Bono para toda la mesa</p>
            <p className="text-pink-300/60 text-[11px]">
              {bonusAll ? 'Gasto único de la mesa (ej: pizza). El monto es el total, no por jugador.' : 'Sin asignar a un jugador'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setBonusAll(!bonusAll); setError(null); }}
            aria-pressed={bonusAll}
            className={`relative w-12 h-6 rounded-full transition-colors shrink-0 ${bonusAll ? 'bg-pink-600' : 'bg-gray-700'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${bonusAll ? 'translate-x-6' : ''}`} />
          </button>
        </div>
      )}

      {/* --- SECCIÓN 1: JUGADOR (Si no es propina ni bono a toda la mesa) --- */}
      {type !== 'tip' && !(type === 'bonus' && bonusAll) && (
        <div className="space-y-2" ref={wrapperRef}>
          <div className="flex justify-between items-center px-1 min-h-[34px]">
            <label className="text-gray-400 text-xs font-bold uppercase tracking-wider">
              {isCreatingNew ? "Registrar Nuevo Jugador" : "Buscar Jugador"}
            </label>
            
            {type === 'buyin' && (
              <button
                type="button"
                onClick={() => {
                  setIsCreatingNew(!isCreatingNew);
                  setPlayerId(""); 
                  setSearchTerm("");
                  setError(null);
                }}
                className="text-[10px] font-bold text-blue-400 hover:text-white hover:bg-blue-500 transition-all bg-blue-500/10 px-3 py-1.5 rounded-full border border-blue-500/30 flex items-center gap-1"
              >
                {isCreatingNew ? <><MagnifyingGlassIcon className="w-3 h-3"/> Volver a Buscar</> : <><UserPlusIcon className="w-3 h-3"/> Crear Nuevo</>}
              </button>
            )}
          </div>

          {isCreatingNew ? (
            // FORMULARIO NUEVO JUGADOR
            <div className="bg-gray-800/50 p-4 rounded-2xl border border-gray-700 space-y-3 shadow-inner">
              <div className="relative">
                <UserIcon className="absolute left-3 top-3.5 w-5 h-5 text-gray-500" />
                <input
                  type="text"
                  autoComplete="name"
                  value={newPlayerName}
                  onChange={(e) => setNewPlayerName(e.target.value)}
                  className="w-full bg-gray-900/50 text-white border border-gray-600 rounded-xl py-3 pl-10 pr-4 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all placeholder-gray-600"
                  placeholder="Nombre completo"
                  autoFocus
                />
              </div>
              <div className="relative">
                <PhoneIcon className="absolute left-3 top-3.5 w-5 h-5 text-gray-500" />
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={newPlayerPhone}
                  onChange={(e) => setNewPlayerPhone(e.target.value)}
                  className="w-full bg-gray-900/50 text-white border border-gray-600 rounded-xl py-3 pl-10 pr-4 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all placeholder-gray-600"
                  placeholder="Teléfono (Opcional)"
                />
              </div>
            </div>
          ) : (
            // BUSCADOR DE JUGADOR
            <div className="relative">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-4 top-4 w-5 h-5 text-gray-500" />
                <input
                  type="text"
                  value={searchTerm}
                  onClick={() => setShowDropdown(true)}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setPlayerId("");
                    setShowDropdown(true);
                  }}
                  className={`w-full bg-gray-800/80 text-white border ${playerId ? 'border-emerald-500/50 bg-emerald-900/10' : 'border-gray-600'} rounded-2xl py-3.5 pl-12 pr-4 focus:outline-none focus:border-blue-500 transition-all text-lg font-medium placeholder-gray-600 shadow-lg`}
                  placeholder={loadingPlayers ? "Cargando base de datos..." : "Buscar por nombre..."}
                  disabled={loadingPlayers}
                />
                {playerId && <CheckBadgeIcon className="absolute right-4 top-4 w-6 h-6 text-emerald-500 animate-bounce" />}
              </div>

              {/* DROPDOWN FLOTANTE */}
              {showDropdown && !loadingPlayers && (
                <div className="absolute z-50 w-full mt-2 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl max-h-60 overflow-y-auto custom-scrollbar">
                  {filteredPlayers.length > 0 ? (
                    filteredPlayers.map((p) => (
                      <div
                        key={p.id}
                        onClick={() => handleSelectPlayer(p)}
                        className="p-3.5 hover:bg-blue-600/20 hover:border-l-4 hover:border-blue-500 cursor-pointer border-b border-gray-800 transition-all flex items-center justify-between group"
                      >
                        <div>
                            <p className="font-bold text-gray-200 group-hover:text-white">{p.name}</p>
                            {p.phone && <p className="text-xs text-gray-500 flex items-center gap-1"><PhoneIcon className="w-3 h-3"/> {p.phone}</p>}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-6 text-gray-500 text-center text-sm flex flex-col items-center gap-2">
                        <UserIcon className="w-8 h-8 opacity-50" />
                        No encontrado
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* --- PROPINA: ¿PARA QUÉ DEALER? --- */}
      {type === 'tip' && tipDealers.length > 0 && (
        <div className="space-y-2">
          <label className="text-gray-400 text-xs font-bold uppercase tracking-wider px-1">
            ¿Para qué dealer?
          </label>
          <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
            <button
              type="button"
              onClick={() => setTipDealerId(null)}
              className={`shrink-0 px-4 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                tipDealerId === null
                  ? 'bg-gray-700 border-gray-500 text-white'
                  : 'bg-gray-800/60 border-gray-700 text-gray-500 hover:text-gray-300'
              }`}
            >
              Sin asignar
            </button>
            {tipDealers.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setTipDealerId(d.id)}
                className={`shrink-0 px-4 py-2.5 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 ${
                  tipDealerId === d.id
                    ? 'bg-amber-600/20 border-amber-500 text-amber-300 shadow-lg shadow-amber-900/20'
                    : 'bg-gray-800/60 border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-500'
                }`}
              >
                🃏 {d.name}
                {d.id === onShiftDealerId && (
                  <span className="text-[8px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full uppercase">En mesa</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* --- SECCIÓN 2: MÉTODO DE PAGO (Solo Buyin) --- */}
      {type === 'buyin' && (
        <div>
          <label className="block text-gray-400 text-xs font-bold uppercase tracking-wider mb-2 px-1">
            Método de Pago
          </label>
          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => setPaymentMethod("CASH")}
              className={`py-3 px-4 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all relative overflow-hidden ${
                paymentMethod === "CASH"
                  ? "bg-emerald-600/20 border-emerald-500 text-emerald-400 shadow-lg shadow-emerald-900/20"
                  : "bg-gray-800/50 border-gray-700 text-gray-400 hover:bg-gray-800 hover:border-gray-500"
              }`}
            >
              <BanknotesIcon className="w-6 h-6" />
              <span className="text-xs font-black uppercase">Efectivo</span>
              {paymentMethod === "CASH" && <div className="absolute inset-0 border-2 border-emerald-500 rounded-xl"></div>}
            </button>

            <button
              type="button"
              onClick={() => setPaymentMethod("DIGITAL")}
              className={`py-3 px-4 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all relative overflow-hidden ${
                paymentMethod === "DIGITAL"
                  ? "bg-blue-600/20 border-blue-500 text-blue-400 shadow-lg shadow-blue-900/20"
                  : "bg-gray-800/50 border-gray-700 text-gray-400 hover:bg-gray-800 hover:border-gray-500"
              }`}
            >
              <DevicePhoneMobileIcon className="w-6 h-6" />
              <span className="text-xs font-black uppercase">Transferencia</span>
              {paymentMethod === "DIGITAL" && <div className="absolute inset-0 border-2 border-blue-500 rounded-xl"></div>}
            </button>
          </div>
        </div>
      )}

      {/* --- SECCIÓN 3: MONTO --- */}
      <div className="bg-black/20 p-5 rounded-2xl border border-gray-700/50">
        <label className="flex justify-between text-gray-400 text-xs font-bold uppercase tracking-wider mb-3">
          <span>Monto ({config.label})</span>
          <CurrencyDollarIcon className={`w-4 h-4 ${config.theme === 'rose' ? 'text-red-400' : 'text-emerald-400'}`} />
        </label>
        
        <div className="relative mb-4">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-2xl font-light">$</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
            className={`w-full bg-gray-900 text-white border border-gray-600 rounded-xl py-4 pl-10 pr-4 focus:ring-2 ${config.ring} focus:border-transparent outline-none font-mono text-3xl font-bold placeholder-gray-700 shadow-inner`}
            placeholder="0"
            required
            autoFocus={type === 'tip'}
          />
        </div>

        {/* Atajos (Chips) */}
        <div className="flex flex-wrap gap-2 justify-center">
          {shortcuts.map((val) => (
            <button
              key={val}
              type="button"
              onClick={() => setAmount(val)}
              className="bg-gray-700/50 hover:bg-gray-600 text-gray-300 hover:text-white text-xs font-mono py-1.5 px-4 rounded-full border border-gray-600 hover:border-gray-500 transition-all"
            >
              +{(val >= 1000 ? (val / 1000) + 'k' : val)}
            </button>
          ))}
        </div>
      </div>

      {/* --- BOTÓN CONFIRMAR --- */}
      <div className="pt-2">
        <button
            type="submit"
            disabled={loading || (loadingPlayers && type !== 'tip')}
            className={`w-full py-4 rounded-xl shadow-xl transform transition-all active:scale-[0.98] font-bold text-lg uppercase tracking-wider flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed ${config.color} ${config.hover} text-white`}
        >
            {loading ? (
                <>
                   <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                   Procesando...
                </>
            ) : (
                <>
                   <span className="text-2xl">{config.icon}</span> 
                   <span>Confirmar</span>
                </>
            )}
        </button>
      </div>

    </form>
  );
}