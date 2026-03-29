import { useState, useEffect } from 'react';
import { ChartPieIcon, CalculatorIcon } from '@heroicons/react/24/solid';

export default function CreateTournamentForm({ onSuccess, onCancel }) {
    const [name, setName] = useState("");
    const [loading, setLoading] = useState(false); // <--- NUEVO ESTADO DE CARGA
    
    // Costos
    const [costs, setCosts] = useState({
        buyin: 0,
        tip: 0,
        rebuy: 0,
        doubleRebuy: 0,
        addon: 0,
        doubleAddon: 0
    });

    // Configuración del Torneo
    const [rake, setRake] = useState(10);
    const [placesPaid, setPlacesPaid] = useState(3);
    const [payouts, setPayouts] = useState([50, 30, 20]);
    const [payoutError, setPayoutError] = useState("");

    // Actualizar inputs de porcentajes cuando cambia el número de puestos
    useEffect(() => {
        const newPayouts = [...payouts];
        if (placesPaid > newPayouts.length) {
            for (let i = newPayouts.length; i < placesPaid; i++) newPayouts.push(0);
        } else if (placesPaid < newPayouts.length) {
            newPayouts.length = placesPaid;
        }
        setPayouts(newPayouts);
    }, [placesPaid]);

    // Validar suma del 100%
    useEffect(() => {
        const total = payouts.reduce((a, b) => Number(a) + Number(b), 0);
        if (total !== 100) {
            setPayoutError(`La suma es ${total}% (Debe ser 100%)`);
        } else {
            setPayoutError("");
        }
    }, [payouts]);

    const handlePayoutChange = (index, value) => {
        const newArr = [...payouts];
        newArr[index] = Number(value);
        setPayouts(newArr);
    };

    const handleSubmit = async (e) => { // <--- AHORA ES ASYNC
        e.preventDefault();
        if (!name.trim()) return alert("Nombre obligatorio");
        if (payoutError) return alert("Corrige los porcentajes de premios");

        setLoading(true); // <--- ACTIVAR LOADER

        const formData = {
            name: name,
            buyin_amount: Number(costs.buyin),
            dealer_tip_amount: Number(costs.tip),
            rebuy_price: Number(costs.rebuy),
            double_rebuy_price: Number(costs.doubleRebuy),
            addon_price: Number(costs.addon),
            double_addon_price: Number(costs.doubleAddon),
            rake_percentage: Number(rake),
            payout_structure: payouts,
            bounty_amount: 0
        };

        try {
            // Esperamos a que el padre complete la creación (API Call)
            await onSuccess(formData);
        } catch (error) {
            console.error(error);
            setLoading(false); // Solo desactivamos si hubo error (si es éxito, el componente se desmonta)
        }
    };

    return (
        <div className="relative">
            {/* 🔥 LOADER GLOBAL (BLOQUEA EL FORMULARIO) */}
            {loading && <GlobalLoader />}

            <form onSubmit={handleSubmit} className="space-y-4 max-h-[80vh] overflow-y-auto pr-2">
                
                {/* 1. INFORMACIÓN BÁSICA */}
                <div>
                    <label className="block text-gray-400 text-sm font-bold mb-1">Nombre del Evento</label>
                    <input type="text" autoFocus className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:border-violet-500 outline-none" placeholder="Ej: Torneo Jueves Express" value={name} onChange={(e) => setName(e.target.value)} />
                </div>

                {/* 2. COSTOS BÁSICOS & RAKE */}
                <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-1">
                        <label className="block text-green-400 text-[10px] font-bold uppercase mb-1">Buy-in</label>
                        <input type="number" className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white" value={costs.buyin} onChange={(e) => setCosts({...costs, buyin: e.target.value})} />
                    </div>
                    <div className="col-span-1">
                        <label className="block text-yellow-500 text-[10px] font-bold uppercase mb-1">Tip (Staff)</label>
                        <input type="number" className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white" value={costs.tip} onChange={(e) => setCosts({...costs, tip: e.target.value})} />
                    </div>
                    <div className="col-span-1">
                        <label className="block text-violet-400 text-[10px] font-bold uppercase mb-1">Rake Club (%)</label>
                        <div className="relative">
                            <input type="number" className="w-full bg-gray-900 border border-violet-500/50 rounded p-2 text-white font-bold" value={rake} onChange={(e) => setRake(e.target.value)} />
                            <span className="absolute right-3 top-2 text-gray-500">%</span>
                        </div>
                    </div>
                </div>

                <div className="h-px bg-gray-700 my-2"></div>

                {/* 3. REBUYS & ADDONS (Diseño Amplio - Filas separadas) */}
                <div className="bg-gray-900/30 p-4 rounded-lg border border-gray-700/50 space-y-4">
                    
                    {/* FILA 1: REBUYS (AZUL) */}
                    <div>
                        <div className="flex items-center gap-2 mb-2 border-b border-blue-500/20 pb-1">
                            <label className="text-blue-400 text-xs font-bold uppercase tracking-wider">
                                Recompras (Rebuys)
                            </label>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                            {/* Sencillo */}
                            <div>
                                <span className="block text-[10px] text-blue-300/80 font-bold mb-1 ml-1 uppercase">Sencillo</span>
                                <div className="relative">
                                    <span className="absolute left-3 top-2.5 text-gray-500 text-sm">$</span>
                                    <input 
                                        type="number" 
                                        className="w-full bg-gray-800 border border-gray-600 focus:border-blue-500 rounded-lg p-2.5 pl-7 text-white text-base font-mono outline-none transition-colors"
                                        placeholder="0" 
                                        value={costs.rebuy} 
                                        onChange={(e) => setCosts({...costs, rebuy: e.target.value})} 
                                    />
                                </div>
                            </div>
                            {/* Doble */}
                            <div>
                                <span className="block text-[10px] text-blue-100 font-black mb-1 ml-1 uppercase tracking-wide">Doble</span>
                                <div className="relative">
                                    <span className="absolute left-3 top-2.5 text-blue-300/50 text-sm">$</span>
                                    <input 
                                        type="number" 
                                        className="w-full bg-blue-900/20 border border-blue-500/50 focus:border-blue-400 rounded-lg p-2.5 pl-7 text-white text-base font-mono outline-none transition-colors"
                                        placeholder="0" 
                                        value={costs.doubleRebuy} 
                                        onChange={(e) => setCosts({...costs, doubleRebuy: e.target.value})} 
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* FILA 2: ADD-ONS (NARANJA) */}
                    <div>
                        <div className="flex items-center gap-2 mb-2 border-b border-orange-500/20 pb-1">
                            <label className="text-orange-400 text-xs font-bold uppercase tracking-wider">
                                Add-ons
                            </label>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                            {/* Sencillo */}
                            <div>
                                <span className="block text-[10px] text-orange-300/80 font-bold mb-1 ml-1 uppercase">Sencillo</span>
                                <div className="relative">
                                    <span className="absolute left-3 top-2.5 text-gray-500 text-sm">$</span>
                                    <input 
                                        type="number" 
                                        className="w-full bg-gray-800 border border-gray-600 focus:border-orange-500 rounded-lg p-2.5 pl-7 text-white text-base font-mono outline-none transition-colors"
                                        placeholder="0" 
                                        value={costs.addon} 
                                        onChange={(e) => setCosts({...costs, addon: e.target.value})} 
                                    />
                                </div>
                            </div>
                            {/* Doble */}
                            <div>
                                <span className="block text-[10px] text-orange-100 font-black mb-1 ml-1 uppercase tracking-wide">Doble</span>
                                <div className="relative">
                                    <span className="absolute left-3 top-2.5 text-orange-300/50 text-sm">$</span>
                                    <input 
                                        type="number" 
                                        className="w-full bg-orange-900/20 border border-orange-500/50 focus:border-orange-400 rounded-lg p-2.5 pl-7 text-white text-base font-mono outline-none transition-colors"
                                        placeholder="0" 
                                        value={costs.doubleAddon} 
                                        onChange={(e) => setCosts({...costs, doubleAddon: e.target.value})} 
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="h-px bg-gray-700 my-2"></div>

                {/* 4. ESTRUCTURA DE PREMIOS (PAYOUTS) */}
                <div className="bg-gray-800 p-3 rounded-lg border border-gray-600">
                    <div className="flex justify-between items-center mb-3">
                        <h4 className="text-white text-xs font-bold uppercase flex items-center gap-2">
                            <ChartPieIcon className="w-4 h-4 text-pink-500" /> Distribución de Premios
                        </h4>
                        <div className="flex items-center gap-2">
                            <label className="text-[10px] text-gray-400 uppercase">Puestos Pagos:</label>
                            <input type="number" min="1" max="20" className="w-12 bg-gray-900 border border-gray-600 rounded p-1 text-center text-white text-xs font-bold" value={placesPaid} onChange={(e) => setPlacesPaid(Number(e.target.value))} />
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                        {payouts.map((percent, index) => (
                            <div key={index} className="relative">
                                <span className="absolute left-2 top-1.5 text-[10px] text-gray-500 font-bold">#{index + 1}</span>
                                <input 
                                    type="number" 
                                    className={`w-full bg-gray-900 border rounded p-1.5 pl-6 text-white text-sm font-mono text-center outline-none focus:border-pink-500 ${payoutError ? 'border-red-500' : 'border-gray-600'}`}
                                    value={percent}
                                    onChange={(e) => handlePayoutChange(index, e.target.value)}
                                />
                                <span className="absolute right-2 top-1.5 text-[10px] text-gray-500">%</span>
                            </div>
                        ))}
                    </div>
                    
                    {payoutError && (
                        <p className="text-red-400 text-xs mt-2 font-bold text-center animate-pulse">{payoutError}</p>
                    )}
                    {!payoutError && (
                        <p className="text-green-500 text-[10px] mt-2 text-center">✅ Distribución correcta (100%)</p>
                    )}
                </div>

                {/* BOTONES */}
                <div className="flex gap-3 pt-2">
                    <button type="button" onClick={onCancel} className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-bold">Cancelar</button>
                    <button type="submit" className="flex-1 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-lg font-bold shadow-lg shadow-violet-900/20">Crear Torneo</button>
                </div>
            </form>
        </div>
    );
}

// --- GLOBAL LOADER (Componente Interno) ---
function GlobalLoader() {
    return (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-[150] flex flex-col items-center justify-center animate-fade-in rounded-lg">
            <div className="bg-gray-900/90 p-6 rounded-2xl border border-violet-500/30 flex flex-col items-center shadow-2xl">
                <div className="relative w-12 h-12 mb-3">
                    <div className="absolute inset-0 border-4 border-gray-700 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-violet-500 rounded-full border-t-transparent animate-spin"></div>
                </div>
                <p className="text-violet-200 font-bold text-sm animate-pulse">Creando Torneo...</p>
            </div>
        </div>
    );
}