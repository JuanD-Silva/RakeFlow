import { useState, useEffect } from 'react';
import { 
    UserPlusIcon, BanknotesIcon, CheckBadgeIcon, XCircleIcon, 
    BoltIcon, ArrowPathIcon, PlusCircleIcon, ChartBarIcon, 
    TrophyIcon, UserIcon, HeartIcon, ExclamationTriangleIcon, CheckCircleIcon,
    GiftIcon
} from '@heroicons/react/24/solid';
import { tournamentService, playerService } from '../api/services';
import { formatMoney } from '../utils/formatters';

export default function TournamentPlayerTable({ tournament, onUpdate }) {
    const [allPlayers, setAllPlayers] = useState([]);
    
    // --- ESTADOS DE MODALES ---
    const [isRegisterOpen, setIsRegisterOpen] = useState(false);
    const [isPayoutOpen, setIsPayoutOpen] = useState(false); 
    const [actionPlayer, setActionPlayer] = useState(null); 
    
    const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: "", message: "", type: "info", onConfirm: null });
    const [notification, setNotification] = useState({ show: false, message: "", type: "success" });

    // Estados Formulario Registro
    const [activeTab, setActiveTab] = useState("search");
    const [loading, setLoading] = useState(false); // <--- ESTE ES EL ESTADO QUE ACTIVA EL LOADER
    const [selectedPlayerId, setSelectedPlayerId] = useState("");
    const [newPlayerName, setNewPlayerName] = useState("");
    const [newPlayerPhone, setNewPlayerPhone] = useState("");
    const [regOptions, setRegOptions] = useState({ payBuyin: true, payTip: false });

    useEffect(() => {
        const fetchPlayers = async () => {
            try { setAllPlayers(await playerService.getAll()); } catch (e) { console.error(e); }
        };
        fetchPlayers();
    }, [isRegisterOpen, isPayoutOpen]); 

    // --- UTILIDADES ---
    const formatCurrency = formatMoney;

    const getPlayerName = (id) => allPlayers.find(p => p.id === id)?.name || `Jugador #${id}`;
    
    const showToast = (msg, type = "success") => { 
        setNotification({ show: true, message: msg, type }); 
        setTimeout(() => setNotification({ show: false, message: "", type: "success" }), 3000); 
    };

    // --- CÁLCULOS FINANCIEROS ---
    const prices = {
        buyin: Number(tournament.buyin_amount) || 0,
        tip: Number(tournament.dealer_tip_amount) || 0,
        rebuyS: Number(tournament.rebuy_price) || 0,
        rebuyD: Number(tournament.double_rebuy_price) || 0,
        addonS: Number(tournament.addon_price) || 0,
        addonD: Number(tournament.double_addon_price) || 0,
        rake: Number(tournament.rake_percentage) || 0
    };

    const playersWithStats = (tournament.players || []).map(p => {
        const totalRebuys = Number(p.rebuys_count) || 0;
        const doubleRebuys = Number(p.double_rebuys_count) || 0;
        const singleRebuys = totalRebuys - doubleRebuys;
        const totalAddons = Number(p.addons_count) || 0;
        const doubleAddons = Number(p.double_addons_count) || 0;
        const singleAddons = totalAddons - doubleAddons;

        const moneyInvested = prices.buyin 
            + (singleRebuys * prices.rebuyS) + (doubleRebuys * prices.rebuyD)
            + (singleAddons * prices.addonS) + (doubleAddons * prices.addonD);

        return { ...p, singleRebuys, doubleRebuys, singleAddons, doubleAddons, moneyInvested };
    });

    const activePlayersCount = playersWithStats.filter(p => p.status === 'ACTIVE').length;
    const totalPotRaw = playersWithStats.reduce((acc, p) => acc + p.moneyInvested, 0);
    const houseRake = totalPotRaw * (prices.rake / 100);
    const netPot = totalPotRaw - houseRake;
    const paidTipsCount = playersWithStats.filter(p => p.is_tip_paid).length;
    const totalTipsCollected = paidTipsCount * prices.tip;

    // --- HANDLERS ---
    const handleRegister = async () => { 
        setLoading(true);
        try {
            let finalId = selectedPlayerId;
            if (activeTab === "create") {
                if(!newPlayerName) {setLoading(false); showToast("Nombre requerido", "error"); return;}
                const res = await playerService.create({ name: newPlayerName, phone: newPlayerPhone, club_id: tournament.club_id });
                finalId = res.id;
            } else if (!finalId) { setLoading(false); showToast("Selecciona un jugador", "error"); return; }
            await tournamentService.registerPlayer(tournament.id, { player_id: Number(finalId), pay_buyin: regOptions.payBuyin, pay_tip: regOptions.payTip });
            setIsRegisterOpen(false); setNewPlayerName(""); setSelectedPlayerId(""); onUpdate(); showToast("Inscrito");
        } catch(e) { showToast("Error", "error"); } finally { setLoading(false); }
    };

    const handleTransaction = (endpoint, type) => {
        if (!actionPlayer) return;
        const isRebuy = endpoint === "Rebuy";
        const price = type === "SINGLE" ? (isRebuy ? prices.rebuyS : prices.addonS) : (isRebuy ? prices.rebuyD : prices.addonD);

        setConfirmModal({
            isOpen: true, title: `Confirmar ${endpoint}`, message: `¿Registrar ${endpoint} ${type}?`, subMessage: `Valor: ${formatCurrency(price)}`, type: "info",
            onConfirm: async () => {
                setLoading(true);
                try {
                    if(isRebuy) await tournamentService.addRebuy(tournament.id, actionPlayer.player_id, type); else await tournamentService.addAddon(tournament.id, actionPlayer.player_id, type);
                    onUpdate(); setActionPlayer(null); showToast("Transacción exitosa");
                } catch(e) { showToast("Error", "error"); } finally { setLoading(false); setConfirmModal(prev=>({...prev, isOpen:false})); }
            }
        });
    };

    const handleRequestFinalize = (winnersList) => {
        setConfirmModal({
            isOpen: true,
            title: "🏆 Finalizar Torneo",
            message: "¿Estás seguro de que la distribución de premios es correcta?",
            subMessage: "Esta acción cerrará el torneo y asignará los ganadores.",
            type: "success",
            onConfirm: async () => {
                setLoading(true);
                try {
                    await tournamentService.finalize(tournament.id, winnersList);
                    setIsPayoutOpen(false); 
                    onUpdate(); 
                    showToast("🏆 ¡Torneo Finalizado!", "success");
                } catch (error) {
                    console.error(error);
                    showToast("Error al finalizar", "error");
                } finally {
                    setLoading(false);
                    setConfirmModal(prev => ({...prev, isOpen: false}));
                }
            }
        });
    };

    const handleEliminate = (pid, name) => {
        setConfirmModal({ isOpen: true, title: "Eliminar", message: `¿Eliminar a ${name}?`, type: "danger", onConfirm: async () => {
            setLoading(true); // Activar loader
            try { await tournamentService.eliminatePlayer(tournament.id, pid); onUpdate(); showToast("Eliminado"); } catch(e){ showToast("Error","error"); } finally { setLoading(false); setConfirmModal(prev=>({...prev,isOpen:false})); }
        }});
    };
    
    const handlePayTip = (pid) => { setConfirmModal({ isOpen: true, title: "Cobrar Tip", message: "¿Cobrar tip?", subMessage: formatCurrency(prices.tip), type: "success", onConfirm: async () => {
        setLoading(true); // Activar loader
        try { await tournamentService.payLateTip(tournament.id, pid); onUpdate(); } catch(e){ showToast("Error","error"); } finally { setLoading(false); setConfirmModal(prev=>({...prev,isOpen:false})); }
    }})};

    return (
        <div className="space-y-6 relative">
            
            {/* 🔥 LOADER GLOBAL (BLOQUEA PANTALLA) */}
            {loading && <GlobalLoader />}

            {/* NOTIFICACIONES (TOASTS) */}
            {notification.show && (
                <div className={`fixed top-5 right-5 z-[100] px-6 py-4 rounded-xl shadow-2xl border flex items-center gap-3 animate-fade-in-up ${notification.type === 'error' ? 'bg-red-900/90 border-red-500 text-white' : 'bg-emerald-900/90 border-emerald-500 text-white'}`}>
                    {notification.type === 'error' ? <XCircleIcon className="w-6 h-6"/> : <CheckCircleIcon className="w-6 h-6"/>}
                    <span className="font-bold">{notification.message}</span>
                </div>
            )}

            {/* HUD */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 animate-fade-in-up">
                <StatCard icon={<UserIcon className="w-10 h-10 text-blue-500" />} label="Jugadores" value={`${activePlayersCount} / ${playersWithStats.length}`} sub="Activos / Total" color="blue" />
                <StatCard icon={<BanknotesIcon className="w-10 h-10 text-green-500" />} label="Pozo Bruto" value={formatCurrency(totalPotRaw)} sub="Total Recaudado" color="green" />
                <StatCard icon={<ChartBarIcon className="w-10 h-10 text-violet-500" />} label="Rake Club" value={formatCurrency(houseRake)} sub={`${prices.rake}%`} color="violet" />
                <StatCard icon={<HeartIcon className="w-10 h-10 text-pink-500" />} label="Staff Bonus" value={formatCurrency(totalTipsCollected)} sub={`${paidTipsCount} Pagados`} color="pink" />
                <StatCard icon={<TrophyIcon className="w-10 h-10 text-yellow-500" />} label="A Repartir" value={formatCurrency(netPot)} sub="Pozo Neto" color="yellow" highlight />
            </div>

            {/* TABLA PREMIOS + BOTÓN DE FINALIZAR */}
            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 shadow-lg animate-fade-in-up flex flex-col md:flex-row gap-4 justify-between items-center">
                <div className="flex-1 w-full">
                    <h4 className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-3 flex items-center gap-2">
                        <TrophyIcon className="w-4 h-4 text-yellow-500" /> Estructura de Premios
                    </h4>
                    <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
                        {(!tournament.payout_structure || tournament.payout_structure.length === 0) ? (
                            <p className="text-gray-500 text-xs italic">Sin estructura.</p>
                        ) : (
                            tournament.payout_structure.map((percent, index) => (
                                <div key={index} className={`flex flex-col items-center p-2 rounded border ${index===0?'bg-yellow-900/20 border-yellow-500/30':'bg-gray-700/30 border-gray-600'}`}>
                                    <span className={`text-[10px] font-bold ${index===0?'text-yellow-400':'text-gray-400'}`}>#{index+1} ({percent}%)</span>
                                    <span className={`text-xs font-black font-mono ${index===0?'text-yellow-200':'text-gray-200'}`}>{formatCurrency(netPot*(percent/100))}</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
                {tournament.status !== 'COMPLETED' && (
                    <button 
                        onClick={() => setIsPayoutOpen(true)}
                        className="w-full md:w-auto bg-gradient-to-r from-yellow-600 to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 text-white shadow-lg shadow-yellow-900/20 px-6 py-4 rounded-xl border-b-4 border-yellow-700 active:border-b-0 active:translate-y-1 transition-all flex items-center justify-center gap-3 group"
                    >
                        <GiftIcon className="w-6 h-6 text-yellow-100 group-hover:rotate-12 transition-transform" />
                        <div className="text-left">
                            <span className="block text-[10px] font-bold text-yellow-100 uppercase tracking-widest">Torneo Finalizado</span>
                            <span className="block text-lg font-black leading-none">ASIGNAR PREMIOS</span>
                        </div>
                    </button>
                )}
            </div>

            {/* TABLA JUGADORES */}
            <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden shadow-xl">
                <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-900/50">
                    <h3 className="text-white font-bold flex items-center gap-2"><UserPlusIcon className="w-5 h-5 text-violet-400" /> Lista de Jugadores</h3>
                    {tournament.status !== 'COMPLETED' && (
                        <button onClick={() => setIsRegisterOpen(true)} className="bg-violet-600 hover:bg-violet-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 shadow-lg"><UserPlusIcon className="w-3 h-3" /> Inscribir</button>
                    )}
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-gray-400">
                        <thead className="bg-gray-700/50 text-xs uppercase font-bold text-gray-300">
                            <tr>
                                <th className="px-4 py-3">Jugador</th>
                                <th className="px-4 py-3 text-center">Rebuys</th>
                                <th className="px-4 py-3 text-center">Addons</th>
                                <th className="px-4 py-3 text-right text-green-400">Inversión</th>
                                <th className="px-4 py-3 text-center">Acciones</th>
                                <th className="px-4 py-3"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700">
                            {playersWithStats.map((p) => (
                                <tr key={p.id} className={`hover:bg-gray-700/30 transition-colors ${p.status === 'ELIMINATED' ? 'opacity-40 grayscale' : p.status === 'WINNER' ? 'bg-yellow-900/10' : ''}`}>
                                    <td className="px-4 py-3">
                                        <div className="font-bold text-white text-base flex items-center gap-2">
                                            {getPlayerName(p.player_id)}
                                            {p.status === 'WINNER' && <span className="bg-yellow-500 text-black text-[10px] font-black px-1.5 rounded">#{p.rank} 🏆</span>}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                         <div className="flex flex-col items-center justify-center gap-1.5">
                                            {p.singleRebuys > 0 && <span className="inline-flex items-center justify-center w-16 py-0.5 rounded bg-blue-900/20 border border-blue-500/30 text-[10px] font-bold text-blue-300 uppercase tracking-wide">Sgl: {p.singleRebuys}</span>}
                                            {p.doubleRebuys > 0 && <span className="inline-flex items-center justify-center w-16 py-0.5 rounded bg-blue-600/20 border border-blue-400 text-[10px] font-black text-blue-200 uppercase tracking-wide shadow-[0_0_8px_rgba(59,130,246,0.3)]">Dbl: {p.doubleRebuys}</span>}
                                            {p.rebuys_count === 0 && <span className="text-gray-700 text-xs">-</span>}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <div className="flex flex-col items-center justify-center gap-1.5">
                                            {p.singleAddons > 0 && <span className="inline-flex items-center justify-center w-16 py-0.5 rounded bg-orange-900/20 border border-orange-500/30 text-[10px] font-bold text-orange-300 uppercase tracking-wide">Sgl: {p.singleAddons}</span>}
                                            {p.doubleAddons > 0 && <span className="inline-flex items-center justify-center w-16 py-0.5 rounded bg-orange-600/20 border border-orange-400 text-[10px] font-black text-orange-200 uppercase tracking-wide shadow-[0_0_8px_rgba(249,115,22,0.3)]">Dbl: {p.doubleAddons}</span>}
                                            {p.addons_count === 0 && <span className="text-gray-700 text-xs">-</span>}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono font-bold text-green-400">{formatCurrency(p.moneyInvested)}</td>
                                    <td className="px-4 py-3 text-center">
                                        {p.status === 'ACTIVE' && (
                                            <button onClick={() => setActionPlayer(p)} className="bg-gray-700 hover:bg-violet-600 text-gray-300 hover:text-white px-2 py-1 rounded text-xs font-bold border border-gray-600">Gest.</button>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                         {p.status === 'ACTIVE' && <button onClick={() => handleEliminate(p.player_id, getPlayerName(p.player_id))}><XCircleIcon className="w-5 h-5 text-gray-600 hover:text-red-500"/></button>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* MODALES */}
            {isPayoutOpen && <PayoutModal tournament={tournament} netPot={netPot} players={playersWithStats} onClose={() => setIsPayoutOpen(false)} onRequestFinalize={handleRequestFinalize} showToast={showToast} formatCurrency={formatCurrency} getPlayerName={getPlayerName} />}
            
            {/* MODAL DE CONFIRMACIÓN */}
            {confirmModal.isOpen && (
                <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[90] backdrop-blur-sm p-4 animate-fade-in">
                    <div className="bg-gray-800 rounded-2xl border border-gray-600 shadow-2xl w-full max-w-sm p-6 text-center transform scale-100 transition-all">
                        <div className={`p-4 rounded-full mb-4 mx-auto w-16 h-16 flex items-center justify-center ${
                            confirmModal.type === 'danger' ? 'bg-red-500/10 text-red-500' : 
                            confirmModal.type === 'success' ? 'bg-yellow-500/10 text-yellow-500' : 
                            'bg-blue-500/10 text-blue-500'
                        }`}>
                            {confirmModal.type === 'success' ? <TrophyIcon className="w-8 h-8" /> : <ExclamationTriangleIcon className="w-8 h-8" />}
                        </div>
                        <h3 className="text-xl font-bold text-white mb-2">{confirmModal.title}</h3>
                        <p className="text-gray-300 mb-2">{confirmModal.message}</p>
                        {confirmModal.subMessage && (
                            <p className="text-sm font-mono font-bold text-white bg-gray-700/50 py-1 px-3 rounded-lg mb-4 inline-block">
                                {confirmModal.subMessage}
                            </p>
                        )}
                        <div className="flex gap-3 w-full mt-4">
                            <button onClick={() => setConfirmModal({...confirmModal, isOpen: false})} className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-bold transition-colors">Cancelar</button>
                            <button onClick={confirmModal.onConfirm} className={`flex-1 py-3 text-white rounded-xl font-bold shadow-lg transition-colors ${
                                confirmModal.type === 'danger' ? 'bg-red-600 hover:bg-red-500' : 
                                confirmModal.type === 'success' ? 'bg-yellow-600 hover:bg-yellow-500 text-black' : 
                                'bg-blue-600 hover:bg-blue-500'
                            }`}>Confirmar</button>
                        </div>
                    </div>
                </div>
            )}
            
            {isRegisterOpen && <RegisterModal onClose={() => setIsRegisterOpen(false)} onConfirm={handleRegister} activeTab={activeTab} setActiveTab={setActiveTab} availablePlayers={allPlayers.filter(ap => !tournament.players?.find(tp => tp.player_id === ap.id))} selectedPlayerId={selectedPlayerId} setSelectedPlayerId={setSelectedPlayerId} newPlayerName={newPlayerName} setNewPlayerName={setNewPlayerName} newPlayerPhone={newPlayerPhone} setNewPlayerPhone={setNewPlayerPhone} regOptions={regOptions} setRegOptions={setRegOptions} prices={prices} loading={loading} />}
            {actionPlayer && <ActionModal player={actionPlayer} playerName={getPlayerName(actionPlayer.player_id)} onClose={() => setActionPlayer(null)} onRebuy={(t) => handleTransaction("Rebuy", t)} onAddon={(t) => handleTransaction("Addon", t)} prices={prices} loading={loading} />}
        </div>
    );
}

// --- NUEVO COMPONENTE: GLOBAL LOADER ---
function GlobalLoader() {
    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[150] flex flex-col items-center justify-center animate-fade-in">
            <div className="bg-gray-900/80 p-6 rounded-2xl border border-violet-500/30 flex flex-col items-center shadow-2xl">
                {/* Spinner Animado */}
                <div className="relative w-16 h-16 mb-4">
                    <div className="absolute inset-0 border-4 border-gray-700 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-violet-500 rounded-full border-t-transparent animate-spin"></div>
                </div>
                <p className="text-violet-200 font-bold text-lg animate-pulse">Procesando...</p>
                <p className="text-gray-500 text-xs mt-2">Por favor espere</p>
            </div>
        </div>
    );
}

// ... Resto de componentes (PayoutModal, StatCard, RegisterModal, ActionModal) se mantienen IGUAL que antes ...
// Asegúrate de copiarlos del archivo anterior o pegarlos aquí si los necesitas.
// --- COPIA AQUÍ PayoutModal, StatCard, RegisterModal, ActionModal ---
function PayoutModal({ tournament, netPot, players, onClose, onRequestFinalize, showToast, formatCurrency, getPlayerName }) {
    const [selectedWinners, setSelectedWinners] = useState({});
    const eligiblePlayers = [...players].sort((a, b) => {
        const nameA = getPlayerName(a.player_id).toUpperCase();
        const nameB = getPlayerName(b.player_id).toUpperCase();
        return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
    });
    const handleSubmit = () => {
        const requiredRanks = tournament.payout_structure.length;
        const winnersList = [];
        for (let i = 0; i < requiredRanks; i++) {
            const rank = i + 1;
            const pid = selectedWinners[rank];
            if (!pid) { showToast(`Falta ganador puesto #${rank}`, "error"); return; }
            winnersList.push({ rank: rank, player_id: Number(pid) });
        }
        const uniqueIds = new Set(winnersList.map(w => w.player_id));
        if (uniqueIds.size !== winnersList.length) { showToast("Un jugador no puede ganar dos premios", "error"); return; }
        onRequestFinalize(winnersList);
    };
    return (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[80] backdrop-blur-sm p-4 animate-fade-in">
            <div className="bg-gray-800 rounded-2xl border border-yellow-600/50 shadow-2xl w-full max-w-lg p-6 flex flex-col max-h-[90vh]">
                <div className="flex items-center gap-3 mb-6 border-b border-gray-700 pb-4">
                    <div className="bg-yellow-500/10 p-3 rounded-full"><TrophyIcon className="w-8 h-8 text-yellow-500" /></div>
                    <div><h3 className="text-xl font-bold text-white uppercase">Premiación</h3><p className="text-xs text-yellow-500/80 font-bold uppercase">Selecciona los ganadores</p></div>
                </div>
                <div className="overflow-y-auto pr-2 space-y-4 flex-1">
                    {tournament.payout_structure.map((percent, index) => {
                        const rank = index + 1;
                        const prize = netPot * (percent / 100);
                        return (
                            <div key={rank} className="bg-gray-900/50 p-4 rounded-xl border border-gray-700">
                                <div className="flex justify-between items-center mb-2"><span className={`text-sm font-bold uppercase ${rank===1 ? 'text-yellow-400' : 'text-gray-300'}`}>#{rank} ({percent}%)</span><span className="text-white font-mono bg-gray-800 px-2 rounded">{formatCurrency(prize)}</span></div>
                                <select className="w-full bg-gray-800 border border-gray-600 text-white p-3 rounded-lg" value={selectedWinners[rank] || ""} onChange={(e) => setSelectedWinners({...selectedWinners, [rank]: e.target.value})}>
                                    <option value="">-- Seleccionar --</option>
                                    {eligiblePlayers.map(p => <option key={p.id} value={p.player_id}>{getPlayerName(p.player_id)}</option>)}
                                </select>
                            </div>
                        );
                    })}
                </div>
                <div className="mt-6 flex gap-3"><button onClick={onClose} className="flex-1 py-3 bg-gray-700 text-white rounded-xl font-bold">Cancelar</button><button onClick={handleSubmit} className="flex-1 py-3 bg-yellow-600 hover:bg-yellow-500 text-black rounded-xl font-bold">Confirmar</button></div>
            </div>
        </div>
    );
}

function StatCard({ icon, label, value, sub, color, highlight }) {
    const colorClasses = { blue: "text-blue-400 border-blue-500/30", green: "text-green-400 border-green-500/30", violet: "text-violet-400 border-violet-500/30", yellow: "text-yellow-400 border-yellow-500/30", pink: "text-pink-400 border-pink-500/30" };
    const classes = colorClasses[color] || "text-gray-400 border-gray-500/30";
    return (
        <div className={`rounded-xl p-4 border shadow-lg relative overflow-hidden bg-gray-800 ${classes} ${highlight ? 'bg-gradient-to-br from-yellow-900/40 to-yellow-600/10' : ''}`}>
            <div className="absolute right-0 top-0 p-3 opacity-10">{icon}</div>
            <p className={`text-xs font-bold uppercase tracking-wider opacity-80 ${classes.split(" ")[0]}`}>{label}</p>
            <p className={`text-2xl font-black mt-1 tracking-tight ${classes.split(" ")[0]}`}>{value}</p>
            <p className="text-[10px] text-gray-500 mt-1">{sub}</p>
        </div>
    );
}

function RegisterModal({ onClose, onConfirm, activeTab, setActiveTab, availablePlayers, selectedPlayerId, setSelectedPlayerId, newPlayerName, setNewPlayerName, newPlayerPhone, setNewPlayerPhone, regOptions, setRegOptions, prices, loading }) {
    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm p-4">
             <div className="bg-gray-800 rounded-xl border border-gray-600 shadow-2xl w-full max-w-md p-6 animate-fade-in-up">
                 <h3 className="text-white font-bold mb-4">Inscribir Jugador</h3>
                 <div className="flex gap-2 mb-4 bg-gray-900 p-1 rounded">
                    <button onClick={() => setActiveTab("search")} className={`flex-1 py-1 text-sm rounded ${activeTab==="search"?"bg-gray-700":""}`}>Buscar</button>
                    <button onClick={() => setActiveTab("create")} className={`flex-1 py-1 text-sm rounded ${activeTab==="create"?"bg-violet-600":""}`}>Nuevo</button>
                 </div>
                 {activeTab === "search" ? (
                     <select className="w-full bg-gray-900 p-2 rounded text-white mb-4" value={selectedPlayerId} onChange={e=>setSelectedPlayerId(e.target.value)}>
                         <option value="">Buscar...</option>
                         {availablePlayers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                     </select>
                 ) : (
                     <div className="mb-4 space-y-2">
                         <input className="w-full bg-gray-900 p-2 rounded text-white" placeholder="Nombre" value={newPlayerName} onChange={e=>setNewPlayerName(e.target.value)} />
                         <input className="w-full bg-gray-900 p-2 rounded text-white" placeholder="Teléfono" value={newPlayerPhone} onChange={e=>setNewPlayerPhone(e.target.value)} />
                     </div>
                 )}
                 <div className="bg-gray-900/50 p-3 rounded mb-4 text-sm text-gray-300 space-y-2">
                     <label className="flex gap-2"><input type="checkbox" checked={regOptions.payBuyin} onChange={e=>setRegOptions({...regOptions, payBuyin:e.target.checked})} /> Buyin ({prices.buyin})</label>
                     <label className="flex gap-2"><input type="checkbox" checked={regOptions.payTip} onChange={e=>setRegOptions({...regOptions, payTip:e.target.checked})} /> Tip ({prices.tip})</label>
                 </div>
                 <div className="flex gap-2">
                     <button onClick={onClose} className="flex-1 bg-gray-700 py-2 rounded text-white">Cancelar</button>
                     <button onClick={onConfirm} disabled={loading} className="flex-1 bg-violet-600 py-2 rounded text-white">Confirmar</button>
                 </div>
             </div>
        </div>
    );
}

function ActionModal({ player, playerName, onClose, onRebuy, onAddon, prices, loading }) {
    const format = formatMoney;
    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm p-4">
            <div className="bg-gray-800 rounded-xl border border-gray-600 shadow-2xl w-full max-w-sm animate-fade-in-up overflow-hidden">
                <div className="bg-gray-900 p-4 border-b border-gray-700 flex justify-between">
                    <h3 className="text-white font-bold">{playerName}</h3>
                    <button onClick={onClose}><XCircleIcon className="w-6 h-6 text-gray-500" /></button>
                </div>
                <div className="p-6 space-y-6">
                    <div>
                        <h4 className="text-blue-400 text-xs font-bold uppercase mb-2">Recompras</h4>
                        <div className="grid grid-cols-2 gap-2">
                            <button onClick={()=>onRebuy("SINGLE")} disabled={loading} className="bg-blue-900/30 border border-blue-800/50 hover:border-blue-500 text-blue-100 p-2 rounded text-center"><div className="text-xs font-bold">SENCILLO</div><div className="text-xs">{format(prices.rebuyS)}</div></button>
                            <button onClick={()=>onRebuy("DOUBLE")} disabled={loading} className="bg-blue-900/30 border border-blue-800/50 hover:border-blue-500 text-blue-100 p-2 rounded text-center"><div className="text-xs font-bold">DOBLE</div><div className="text-xs">{format(prices.rebuyD)}</div></button>
                        </div>
                    </div>
                    <div>
                        <h4 className="text-orange-400 text-xs font-bold uppercase mb-2">Add-ons</h4>
                        <div className="grid grid-cols-2 gap-2">
                            <button onClick={()=>onAddon("SINGLE")} disabled={loading} className="bg-orange-900/30 border border-orange-800/50 hover:border-orange-500 text-orange-100 p-2 rounded text-center"><div className="text-xs font-bold">SENCILLO</div><div className="text-xs">{format(prices.addonS)}</div></button>
                            <button onClick={()=>onAddon("DOUBLE")} disabled={loading} className="bg-orange-900/30 border border-orange-800/50 hover:border-orange-500 text-orange-100 p-2 rounded text-center"><div className="text-xs font-bold">DOBLE</div><div className="text-xs">{format(prices.addonD)}</div></button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}