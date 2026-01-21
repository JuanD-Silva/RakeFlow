import { useState, useEffect, useRef } from 'react';
import { transactionService, playerService, sessionService } from '../api/services';

export default function TransactionForm({ type, onSuccess, sessionId, }) {
  // --- ESTADOS DE DATOS ---
  const [players, setPlayers] = useState([]);
  const [playerId, setPlayerId] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");

  // --- ESTADOS DEL BUSCADOR ---
  const [searchTerm, setSearchTerm] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  
  // --- ESTADOS CREACIÓN JUGADOR ---
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState("");
  const [newPlayerPhone, setNewPlayerPhone] = useState("");

  const [loading, setLoading] = useState(false);
  const [loadingPlayers, setLoadingPlayers] = useState(true);
  const [error, setError] = useState(null);

  const wrapperRef = useRef(null);

  // 1. CARGA INICIAL
  useEffect(() => {
    setPlayerId("");
    setSearchTerm("");
    setIsCreatingNew(false);
    setAmount("");
    setPaymentMethod("CASH");
    
    if (type === 'tip') {
      setLoadingPlayers(false);
    } else {
      loadPlayers();
    }
  }, [type]);

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
        const stats = await sessionService.getActiveSession();
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
    } catch (err) {
      console.error("Error cargando jugadores", err);
      setError("No se pudo cargar la lista.");
    } finally {
      setLoadingPlayers(false);
    }
  };

  const getConfig = () => {
    switch (type) {
      case 'buyin': return { label: 'Entrada / Recompra', color: 'bg-green-600', hover: 'hover:bg-green-500', icon: '💰' };
      case 'cashout': return { label: 'Retiro (Cashout)', color: 'bg-red-600', hover: 'hover:bg-red-500', icon: '💸' };
      case 'spend': return { label: 'Gasto / Bebida', color: 'bg-blue-600', hover: 'hover:bg-blue-500', icon: '🍺' };
      case 'jackpot-payout': return { label: 'Pago de Jackpot', color: 'bg-purple-600', hover: 'hover:bg-purple-500', icon: '🎁' };
      case 'tip': return { label: 'Propina Dealer', color: 'bg-yellow-600', hover: 'hover:bg-yellow-500', icon: '🤝' };
      default: return { label: 'Transacción', color: 'bg-gray-600', hover: 'hover:bg-gray-500', icon: '📝' };
    }
  };
  const config = getConfig();

  const filteredPlayers = players.filter(player =>
    player.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelectPlayer = (player) => {
    setPlayerId(player.id);
    setSearchTerm(player.name);
    setShowDropdown(false);
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (type !== 'tip') {
      if (!isCreatingNew && !playerId) return setError("Selecciona un jugador de la lista.");
      if (isCreatingNew && !newPlayerName.trim()) return setError("El nombre es obligatorio.");
    }
    if (!amount || amount <= 0) return setError("El monto debe ser mayor a 0.");

    setLoading(true);

    try {
      let finalPlayerId = playerId;
      const amt = parseFloat(amount);

      if (isCreatingNew && type === 'buyin') {
        const newPlayer = await playerService.create(newPlayerName, newPlayerPhone);
        finalPlayerId = newPlayer.id;
      }

      const pId = type === 'tip' ? null : parseInt(finalPlayerId);

switch (type) {
        // 👇 Agregamos sessionId como último parámetro en TODAS las llamadas
        case 'buyin': 
            await transactionService.buyin(pId, amt, paymentMethod, sessionId); 
            break;
            
        case 'cashout': 
            await transactionService.cashout(pId, amt, sessionId); 
            break;
            
        case 'spend': 
            await transactionService.spend(pId, amt, sessionId); 
            break;
        
        case 'bonus': 
            await transactionService.bonus(pId, amt, sessionId); 
            break;

        case 'jackpot-payout': 
            await transactionService.jackpotPayout(pId, amt, sessionId); 
            break;
            
        case 'tip':
            if (transactionService.tip) {
                await transactionService.tip(pId, amt, sessionId);
            } else {
                // Si usabas spend como fallback
                await transactionService.spend(pId, amt, sessionId); 
            }
            break;
            
        default: throw new Error("Tipo desconocido");
      }
      onSuccess(); 

    } catch (err) {
      console.error(err);
      setError(err.message || "Error al procesar.");
    } finally {
      setLoading(false);
      
    }
  };

  const shortcuts = (type === 'tip' || type === 'spend') 
    ? [2000, 5000, 10000, 20000] 
    : [50000, 100000, 200000, 500000];

  return (
    <form onSubmit={handleSubmit} className="space-y-6 animate-fade-in" onClick={() => {}}>
      
      {error && (
        <div className="bg-red-900/50 border border-red-500 text-red-200 p-3 rounded text-sm text-center animate-pulse">
          ⚠️ {error}
        </div>
      )}

      {type !== 'tip' && (
        <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700" ref={wrapperRef}>
          <div className="flex justify-between items-center mb-2">
            <label className="text-gray-400 text-sm font-bold">
              {isCreatingNew ? "Datos del Nuevo Jugador" : "Buscar Jugador"}
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
                className="text-xs font-bold text-blue-400 hover:text-blue-300 transition-colors bg-blue-900/30 px-2 py-1 rounded border border-blue-800 cursor-pointer"
              >
                {isCreatingNew ? "↺ Volver a Buscar" : "➕ Crear Nuevo"}
              </button>
            )}
          </div>

          {isCreatingNew ? (
            <div className="space-y-3 animate-fade-in">
              <input
                type="text"
                value={newPlayerName}
                onChange={(e) => setNewPlayerName(e.target.value)}
                className="w-full bg-gray-900 text-white border border-blue-500 rounded-lg p-3 focus:outline-none"
                placeholder="Nombre completo"
                autoFocus
              />
              <input
                type="text"
                value={newPlayerPhone}
                onChange={(e) => setNewPlayerPhone(e.target.value)}
                className="w-full bg-gray-900 text-white border border-gray-600 rounded-lg p-3 text-sm"
                placeholder="Teléfono (Opcional)"
              />
            </div>
          ) : (
            <div className="relative">
              <span className="absolute left-3 top-3 text-gray-500">🔍</span>
              <input
                type="text"
                value={searchTerm}
                onClick={() => setShowDropdown(true)}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setPlayerId("");
                  setShowDropdown(true);
                }}
                className={`w-full bg-gray-900 text-white border ${playerId ? 'border-green-500' : 'border-gray-600'} rounded-lg p-3 pl-10 focus:outline-none focus:border-blue-500 transition-colors`}
                placeholder={loadingPlayers ? "Cargando..." : "Escribe para buscar..."}
                disabled={loadingPlayers}
              />
              {playerId && <span className="absolute right-3 top-3 text-green-500">✔</span>}

              {showDropdown && !loadingPlayers && (
                <div className="absolute z-50 w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                  {filteredPlayers.length > 0 ? (
                    filteredPlayers.map((p) => (
                      <div
                        key={p.id}
                        onClick={() => handleSelectPlayer(p)}
                        className="p-3 hover:bg-gray-700 cursor-pointer text-white border-b border-gray-700 flex justify-between items-center"
                      >
                        <div className="flex flex-col">
                            <span className="font-bold text-white text-base">{p.name}</span>
                            {p.phone && (
                                <span className="text-sm font-bold text-gray-300">📞 {p.phone}</span>
                            )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-4 text-gray-500 text-center text-sm">No se encontraron jugadores.</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {type === 'buyin' && (
        <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
          <label className="block text-gray-400 text-sm font-bold mb-3">
            Método de Pago
          </label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setPaymentMethod("CASH")}
              className={`flex-1 py-3 rounded-lg border flex justify-center items-center gap-2 transition-all ${
                paymentMethod === "CASH"
                  ? "bg-green-600 border-green-500 text-white shadow-lg ring-2 ring-green-500/30"
                  : "bg-gray-700 border-gray-600 text-gray-400 hover:bg-gray-600"
              }`}
            >
              <span className="text-xl">💵</span> 
              <span className="font-bold">Efectivo</span>
            </button>

            <button
              type="button"
              onClick={() => setPaymentMethod("DIGITAL")}
              className={`flex-1 py-3 rounded-lg border flex justify-center items-center gap-2 transition-all ${
                paymentMethod === "DIGITAL"
                  ? "bg-blue-600 border-blue-500 text-white shadow-lg ring-2 ring-blue-500/30"
                  : "bg-gray-700 border-gray-600 text-gray-400 hover:bg-gray-600"
              }`}
            >
              <span className="text-xl">📱</span>
              <span className="font-bold">Transferencia</span>
            </button>
          </div>
        </div>
      )}

      <div>
        <label className="block text-gray-400 text-sm font-bold mb-2">
          Monto ({config.label})
        </label>
        <div className="relative mb-3">
          <span className="absolute left-3 top-3 text-gray-500">$</span>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full bg-gray-800 text-white border border-gray-600 rounded-lg p-3 pl-8 focus:outline-none focus:border-blue-500 font-mono text-lg"
            placeholder="0"
            min="1"
            required
            autoFocus={type === 'tip'} 
          />
        </div>

        <div className="grid grid-cols-4 gap-2">
          {shortcuts.map((val) => (
            <button
              key={val}
              type="button"
              onClick={() => setAmount(val)}
              className="bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs font-bold py-2 rounded transition-colors border border-gray-600"
            >
              {val >= 1000 ? (val / 1000) + 'k' : val}
            </button>
          ))}
        </div>
      </div>

      <button
        type="submit"
        disabled={loading || (loadingPlayers && type !== 'tip')}
        className={`w-full ${config.color} ${config.hover} text-white font-bold py-4 rounded-lg shadow-lg transform transition-all active:scale-95 disabled:opacity-50 flex justify-center items-center gap-2`}
      >
        {loading ? "Procesando..." : (
          <><span>{config.icon}</span> Confirmar {config.label}</>
        )}
      </button>
    </form>
  );
}