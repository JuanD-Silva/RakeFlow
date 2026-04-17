import { useState, useEffect, useRef } from 'react';
import {
    UserPlusIcon, BanknotesIcon, CheckBadgeIcon, XCircleIcon,
    BoltIcon, ArrowPathIcon, PlusCircleIcon, ChartBarIcon,
    TrophyIcon, UserIcon, HeartIcon, ExclamationTriangleIcon, CheckCircleIcon,
    GiftIcon, MagnifyingGlassIcon, PhoneIcon
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
    const totalTipsCount = playersWithStats.reduce((acc, p) => acc + (p.tips_count || 0), 0);
    const playersWithTip = playersWithStats.filter(p => (p.tips_count || 0) > 0).length;
    const totalTipsCollected = totalTipsCount * prices.tip;

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

    const handleTogglePaid = async (pid) => {
        try {
            await tournamentService.toggleBuyinPaid(tournament.id, pid);
            onUpdate();
        } catch (e) {
            console.error(e);
            showToast(e.response?.data?.detail || "Error al cambiar estado", "error");
        }
    };

    const handleEliminate = (pid, name) => {
        setConfirmModal({ isOpen: true, title: "Eliminar", message: `¿Eliminar a ${name}?`, type: "danger", onConfirm: async () => {
            setLoading(true); // Activar loader
            try { await tournamentService.eliminatePlayer(tournament.id, pid); onUpdate(); showToast("Eliminado"); } catch(e){ console.error("Error eliminando jugador:", e.response?.data || e.message || e); showToast(e.response?.data?.detail || "Error al eliminar","error"); } finally { setLoading(false); setConfirmModal(prev=>({...prev,isOpen:false})); }
        }});
    };
    
    const handlePayTip = (pid) => { setConfirmModal({ isOpen: true, title: "Cobrar Tip", message: "¿Cobrar tip?", subMessage: formatCurrency(prices.tip), type: "success", onConfirm: async () => {
        setLoading(true);
        try { await tournamentService.payLateTip(tournament.id, pid); setActionPlayer(null); onUpdate(); showToast("Tip cobrado"); } catch(e){ showToast(e.response?.data?.detail || "Error","error"); } finally { setLoading(false); setConfirmModal(prev=>({...prev,isOpen:false})); }
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
                <StatCard icon={<HeartIcon className="w-10 h-10 text-pink-500" />} label="Staff Bonus" value={formatCurrency(totalTipsCollected)} sub={`${totalTipsCount} tips (${playersWithTip}/${playersWithStats.length} jugadores)`} color="pink" />
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
                                <th className="px-4 py-3 text-center text-amber-400">Pago</th>
                                <th className="px-4 py-3 text-center">Rebuys</th>
                                <th className="px-4 py-3 text-center">Addons</th>
                                <th className="px-4 py-3 text-center text-pink-400">Tip</th>
                                <th className="px-4 py-3 text-right text-green-400">Inversion</th>
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
                                            {p.status === 'WINNER' && <span className="bg-yellow-500 text-black text-[10px] font-black px-1.5 rounded">#{p.rank}</span>}
                                            {p.status === 'ELIMINATED' && <span className="text-red-500 text-[10px] font-black">OUT</span>}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <button
                                            onClick={() => handleTogglePaid(p.player_id)}
                                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-all active:scale-95 ${
                                                p.is_buyin_paid === false
                                                    ? 'bg-red-500/10 border-red-500/40 text-red-400 hover:bg-red-500/20'
                                                    : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                                            }`}
                                            title={p.is_buyin_paid === false ? "Click para marcar como pagado" : "Click para marcar como pendiente"}
                                        >
                                            {p.is_buyin_paid === false ? '⏳ Debe' : '✓ Pagó'}
                                        </button>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                         <div className="flex flex-col items-center justify-center gap-1.5">
                                            {p.singleRebuys > 0 && <span className="inline-flex items-center justify-center w-16 py-0.5 rounded bg-blue-900/20 border border-blue-500/30 text-[10px] font-bold text-blue-300 uppercase tracking-wide">Sgl: {p.singleRebuys}</span>}
                                            {p.doubleRebuys > 0 && <span className="inline-flex items-center justify-center w-16 py-0.5 rounded bg-blue-600/20 border border-blue-400 text-[10px] font-black text-blue-200 uppercase tracking-wide">Dbl: {p.doubleRebuys}</span>}
                                            {p.rebuys_count === 0 && <span className="text-gray-700 text-xs">-</span>}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <div className="flex flex-col items-center justify-center gap-1.5">
                                            {p.singleAddons > 0 && <span className="inline-flex items-center justify-center w-16 py-0.5 rounded bg-orange-900/20 border border-orange-500/30 text-[10px] font-bold text-orange-300 uppercase tracking-wide">Sgl: {p.singleAddons}</span>}
                                            {p.doubleAddons > 0 && <span className="inline-flex items-center justify-center w-16 py-0.5 rounded bg-orange-600/20 border border-orange-400 text-[10px] font-black text-orange-200 uppercase tracking-wide">Dbl: {p.doubleAddons}</span>}
                                            {p.addons_count === 0 && <span className="text-gray-700 text-xs">-</span>}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        {(p.tips_count || 0) > 0 ? (
                                            <span className="inline-flex items-center gap-1 bg-pink-500/10 border border-pink-500/30 text-pink-400 text-[10px] font-black px-2 py-1 rounded-lg uppercase">
                                                <CheckBadgeIcon className="w-3.5 h-3.5" /> {p.tips_count}x
                                            </span>
                                        ) : prices.tip > 0 ? (
                                            <span className="text-gray-600 text-[10px] font-bold uppercase">No</span>
                                        ) : (
                                            <span className="text-gray-700 text-xs">-</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono font-bold text-green-400">{formatCurrency(p.moneyInvested)}</td>
                                    <td className="px-4 py-3 text-center">
                                        {p.status === 'ACTIVE' && tournament.status !== 'COMPLETED' && (
                                            <button onClick={() => setActionPlayer(p)} className="bg-violet-600 hover:bg-violet-500 text-white px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 mx-auto transition-colors active:scale-95">
                                                <PlusCircleIcon className="w-4 h-4" />
                                                Gestionar
                                            </button>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                         {p.status === 'ACTIVE' && tournament.status !== 'COMPLETED' && <button onClick={() => handleEliminate(p.player_id, getPlayerName(p.player_id))}><XCircleIcon className="w-5 h-5 text-gray-600 hover:text-red-500"/></button>}
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
            {actionPlayer && <ActionModal player={actionPlayer} playerName={getPlayerName(actionPlayer.player_id)} onClose={() => setActionPlayer(null)} onRebuy={(t) => handleTransaction("Rebuy", t)} onAddon={(t) => handleTransaction("Addon", t)} onUndo={(action, type) => { setConfirmModal({ isOpen: true, title: "Deshacer", message: `¿Deshacer ${action} ${type}?`, type: "danger", onConfirm: async () => { setLoading(true); try { await tournamentService.undoAction(tournament.id, actionPlayer.player_id, action, type); setActionPlayer(null); onUpdate(); showToast("Deshecho"); } catch(e) { showToast(e.response?.data?.detail || "Error", "error"); } finally { setLoading(false); setConfirmModal(prev => ({...prev, isOpen: false})); } } }); }} onPayTip={() => { handlePayTip(actionPlayer.player_id); }} prices={prices} loading={loading} />}
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
    const [openDropdown, setOpenDropdown] = useState(null);
    const [searchTerms, setSearchTerms] = useState({});

    const eligiblePlayers = [...players].sort((a, b) => {
        const nameA = getPlayerName(a.player_id).toUpperCase();
        const nameB = getPlayerName(b.player_id).toUpperCase();
        return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
    });

    const rankMedals = ['🥇', '🥈', '🥉'];
    const rankColors = [
        { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', text: 'text-yellow-400', prize: 'text-yellow-300', highlight: 'bg-yellow-900/20' },
        { bg: 'bg-gray-400/10', border: 'border-gray-400/30', text: 'text-gray-300', prize: 'text-gray-200', highlight: 'bg-gray-700/30' },
        { bg: 'bg-amber-600/10', border: 'border-amber-600/30', text: 'text-amber-500', prize: 'text-amber-300', highlight: 'bg-amber-900/20' },
    ];

    // Limitar puestos al número de jugadores
    const maxRanks = Math.min(tournament.payout_structure.length, eligiblePlayers.length);
    const effectiveStructure = tournament.payout_structure.slice(0, maxRanks);

    const getAlreadySelected = (currentRank) => {
        return Object.entries(selectedWinners)
            .filter(([r]) => Number(r) !== currentRank)
            .map(([, pid]) => Number(pid));
    };

    const handleSubmit = () => {
        const winnersList = [];
        for (let i = 0; i < maxRanks; i++) {
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
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[80] backdrop-blur-sm p-4 animate-fade-in" onClick={() => setOpenDropdown(null)}>
            <div className="bg-gray-800 rounded-2xl border border-yellow-600/30 shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>

                {/* HEADER */}
                <div className="bg-gray-900 p-5 border-b border-gray-700 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-yellow-500/10 rounded-xl flex items-center justify-center border border-yellow-500/20">
                            <TrophyIcon className="w-7 h-7 text-yellow-500" />
                        </div>
                        <div>
                            <h3 className="text-white font-black text-lg uppercase tracking-tight">Premiacion</h3>
                            <p className="text-yellow-500/70 text-[10px] font-bold uppercase tracking-widest">Asignar ganadores</p>
                        </div>
                    </div>
                    <div className="text-right">
                        <p className="text-[10px] text-gray-500 font-bold uppercase">Pozo Neto</p>
                        <p className="text-yellow-400 font-mono font-black text-xl">{formatCurrency(netPot)}</p>
                    </div>
                </div>

                {/* LISTA DE POSICIONES */}
                <div className="overflow-y-auto flex-1 p-5 space-y-3">
                    {maxRanks < tournament.payout_structure.length && (
                        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-amber-400 text-xs font-bold flex items-center gap-2">
                            <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0" />
                            Solo hay {eligiblePlayers.length} jugador{eligiblePlayers.length !== 1 ? 'es' : ''}, se premian {maxRanks} de {tournament.payout_structure.length} puestos.
                        </div>
                    )}
                    {effectiveStructure.map((percent, index) => {
                        const rank = index + 1;
                        const prize = netPot * (percent / 100);
                        const colors = rankColors[index] || { bg: 'bg-violet-500/10', border: 'border-violet-500/30', text: 'text-violet-400', prize: 'text-violet-300', highlight: 'bg-violet-900/20' };
                        const medal = rankMedals[index] || `#${rank}`;
                        const selectedPid = selectedWinners[rank];
                        const selectedName = selectedPid ? getPlayerName(Number(selectedPid)) : null;
                        const alreadySelected = getAlreadySelected(rank);
                        const search = searchTerms[rank] || '';
                        const availableForRank = eligiblePlayers.filter(p => !alreadySelected.includes(p.player_id) && getPlayerName(p.player_id).toLowerCase().includes(search.toLowerCase()));

                        return (
                            <div key={rank} className={`rounded-2xl border relative ${colors.border} ${selectedName ? colors.highlight : 'bg-gray-900/50'}`} style={{ zIndex: openDropdown === rank ? 50 : (tournament.payout_structure.length - index) }}>
                                {/* Rank header + Selector en una sola fila compacta */}
                                <div className="flex items-center justify-between px-4 py-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xl">{medal}</span>
                                        <span className={`text-sm font-black uppercase ${colors.text}`}>#{rank}</span>
                                        <span className="text-gray-500 text-xs">({percent}%)</span>
                                    </div>
                                    <span className={`font-mono font-black text-lg ${colors.prize}`}>{formatCurrency(prize)}</span>
                                </div>

                                <div className="px-4 pb-3 relative">
                                    {selectedName ? (
                                        <div className={`flex items-center justify-between ${colors.bg} border ${colors.border} rounded-xl p-3.5`}>
                                            <div className="flex items-center gap-3">
                                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors.bg} border ${colors.border}`}>
                                                    <UserIcon className="w-4 h-4 text-white" />
                                                </div>
                                                <span className="text-white font-bold text-base">{selectedName}</span>
                                            </div>
                                            <button onClick={() => setSelectedWinners({...selectedWinners, [rank]: ''})} className="p-2 rounded-lg hover:bg-red-400/10 text-gray-500 hover:text-red-400 transition-colors">
                                                <XCircleIcon className="w-5 h-5" />
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="relative">
                                            <MagnifyingGlassIcon className="absolute left-3 top-3.5 w-5 h-5 text-gray-500" />
                                            <input
                                                type="text"
                                                value={search}
                                                onClick={() => setOpenDropdown(openDropdown === rank ? null : rank)}
                                                onChange={(e) => { setSearchTerms({...searchTerms, [rank]: e.target.value}); setOpenDropdown(rank); }}
                                                onBlur={() => setTimeout(() => setOpenDropdown(null), 200)}
                                                placeholder="Buscar jugador..."
                                                className="w-full bg-gray-900 border border-gray-600 rounded-xl py-3 pl-10 pr-4 text-white text-base font-medium placeholder-gray-600 outline-none focus:border-yellow-500/50 transition-colors"
                                            />
                                            {openDropdown === rank && (
                                                <div className="absolute z-50 w-full mt-2 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl max-h-40 overflow-y-auto">
                                                    {availableForRank.length > 0 ? availableForRank.map((p) => (
                                                        <div key={p.id} onClick={() => { setSelectedWinners({...selectedWinners, [rank]: p.player_id}); setOpenDropdown(null); setSearchTerms({...searchTerms, [rank]: ''}); }} className="p-3.5 hover:bg-yellow-600/20 hover:border-l-4 hover:border-yellow-500 cursor-pointer border-b border-gray-800 transition-all">
                                                            <p className="font-bold text-gray-200">{getPlayerName(p.player_id)}</p>
                                                        </div>
                                                    )) : (
                                                        <div className="p-4 text-gray-500 text-center text-sm">No disponible</div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* BOTONES */}
                <div className="p-5 border-t border-gray-700 bg-gray-900/50 flex gap-3">
                    <button onClick={onClose} className="flex-1 py-4 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-bold uppercase tracking-wider transition-colors active:scale-[0.98]">
                        Cancelar
                    </button>
                    <button onClick={handleSubmit} className="flex-[2] py-4 bg-gradient-to-r from-yellow-600 to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 text-black rounded-xl font-bold uppercase tracking-wider transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-lg shadow-yellow-900/30">
                        <TrophyIcon className="w-5 h-5" />
                        Confirmar Premios
                    </button>
                </div>
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
    const [searchTerm, setSearchTerm] = useState("");
    const [showDropdown, setShowDropdown] = useState(false);
    const wrapperRef = useRef(null);

    const filtered = availablePlayers.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));
    const selectedName = availablePlayers.find(p => String(p.id) === String(selectedPlayerId))?.name || "";

    useEffect(() => {
        const handleClick = (e) => { if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setShowDropdown(false); };
        document.addEventListener("mousedown", handleClick);
        document.addEventListener("touchstart", handleClick);
        return () => { document.removeEventListener("mousedown", handleClick); document.removeEventListener("touchstart", handleClick); };
    }, []);

    const handleSelect = (p) => { setSelectedPlayerId(p.id); setSearchTerm(p.name); setShowDropdown(false); };

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm p-4">
             <div className="bg-gray-800 rounded-2xl border border-gray-700 shadow-2xl w-full max-w-md animate-fade-in-up overflow-hidden">
                 {/* Header */}
                 <div className="bg-gray-900 p-5 border-b border-gray-700 flex justify-between items-center">
                     <div className="flex items-center gap-3">
                         <div className="w-10 h-10 bg-violet-500/10 rounded-xl flex items-center justify-center border border-violet-500/20">
                             <UserPlusIcon className="w-5 h-5 text-violet-400" />
                         </div>
                         <div>
                             <h3 className="text-white font-black text-lg uppercase tracking-tight">Inscribir Jugador</h3>
                             <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest">Torneo</p>
                         </div>
                     </div>
                     <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-700 transition-colors">
                         <XCircleIcon className="w-6 h-6 text-gray-500 hover:text-white" />
                     </button>
                 </div>

                 <div className="p-5 space-y-5">
                     {/* Tabs */}
                     <div className="flex gap-2 bg-gray-900 p-1.5 rounded-xl">
                        <button onClick={() => { setActiveTab("search"); setSearchTerm(""); setSelectedPlayerId(""); }} className={`flex-1 py-2.5 text-sm font-bold uppercase tracking-wider rounded-lg flex items-center justify-center gap-2 transition-all ${activeTab==="search" ? "bg-gray-700 text-white shadow-lg" : "text-gray-400 hover:text-white"}`}>
                            <MagnifyingGlassIcon className="w-4 h-4" /> Buscar
                        </button>
                        <button onClick={() => setActiveTab("create")} className={`flex-1 py-2.5 text-sm font-bold uppercase tracking-wider rounded-lg flex items-center justify-center gap-2 transition-all ${activeTab==="create" ? "bg-violet-600 text-white shadow-lg" : "text-gray-400 hover:text-white"}`}>
                            <UserPlusIcon className="w-4 h-4" /> Nuevo
                        </button>
                     </div>

                     {/* Contenido tabs */}
                     {activeTab === "search" ? (
                         <div className="relative" ref={wrapperRef}>
                             <div className="relative">
                                 <MagnifyingGlassIcon className="absolute left-4 top-4 w-5 h-5 text-gray-500" />
                                 <input
                                     type="text"
                                     value={searchTerm}
                                     onClick={() => setShowDropdown(true)}
                                     onChange={(e) => { setSearchTerm(e.target.value); setSelectedPlayerId(""); setShowDropdown(true); }}
                                     className={`w-full bg-gray-900 text-white border ${selectedPlayerId ? 'border-emerald-500/50 bg-emerald-900/10' : 'border-gray-600'} rounded-2xl py-3.5 pl-12 pr-4 focus:outline-none focus:border-violet-500 transition-all text-lg font-medium placeholder-gray-600 shadow-lg`}
                                     placeholder="Buscar por nombre..."
                                 />
                                 {selectedPlayerId && <CheckBadgeIcon className="absolute right-4 top-4 w-6 h-6 text-emerald-500" />}
                             </div>
                             {showDropdown && (
                                 <div className="absolute z-50 w-full mt-2 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl max-h-48 overflow-y-auto">
                                     {filtered.length > 0 ? filtered.map((p) => (
                                         <div key={p.id} onClick={() => handleSelect(p)} className="p-3.5 hover:bg-violet-600/20 hover:border-l-4 hover:border-violet-500 cursor-pointer border-b border-gray-800 transition-all flex items-center justify-between group">
                                             <div>
                                                 <p className="font-bold text-gray-200 group-hover:text-white">{p.name}</p>
                                                 {p.phone && <p className="text-xs text-gray-500">{p.phone}</p>}
                                             </div>
                                         </div>
                                     )) : (
                                         <div className="p-6 text-gray-500 text-center text-sm flex flex-col items-center gap-2">
                                             <UserIcon className="w-8 h-8 opacity-50" />
                                             No encontrado
                                         </div>
                                     )}
                                 </div>
                             )}
                         </div>
                     ) : (
                         <div className="bg-gray-800/50 p-4 rounded-2xl border border-gray-700 space-y-3 shadow-inner">
                             <div className="relative">
                                 <UserIcon className="absolute left-3 top-3.5 w-5 h-5 text-gray-500" />
                                 <input type="text" value={newPlayerName} onChange={(e) => setNewPlayerName(e.target.value)} className="w-full bg-gray-900/50 text-white border border-gray-600 rounded-xl py-3 pl-10 pr-4 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none transition-all placeholder-gray-600" placeholder="Nombre completo" autoFocus />
                             </div>
                             <div className="relative">
                                 <PhoneIcon className="absolute left-3 top-3.5 w-5 h-5 text-gray-500" />
                                 <input type="text" value={newPlayerPhone} onChange={(e) => setNewPlayerPhone(e.target.value)} className="w-full bg-gray-900/50 text-white border border-gray-600 rounded-xl py-3 pl-10 pr-4 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none transition-all placeholder-gray-600" placeholder="Telefono (Opcional)" />
                             </div>
                         </div>
                     )}

                     {/* Opciones de pago */}
                     <div className="space-y-3">
                         <label className="text-gray-400 text-xs font-bold uppercase tracking-wider px-1">Cobros al inscribir</label>
                         <label className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 cursor-not-allowed">
                             <input type="checkbox" checked={true} disabled className="w-5 h-5 accent-emerald-500" />
                             <div className="flex-1">
                                 <span className="text-white font-bold">Entrada (Buyin)</span>
                             </div>
                             <span className="text-emerald-400 font-mono font-bold text-lg">{prices.buyin > 0 ? `$${prices.buyin.toLocaleString()}` : 'Gratis'}</span>
                         </label>
                         {prices.tip > 0 && (
                             <label className="flex items-center gap-3 bg-gray-800/50 border border-gray-600 rounded-xl p-4 cursor-pointer hover:border-pink-500/30 transition-colors active:bg-gray-700">
                                 <input type="checkbox" checked={regOptions.payTip} onChange={e=>setRegOptions({...regOptions, payTip:e.target.checked})} className="w-5 h-5 accent-pink-500" />
                                 <div className="flex-1">
                                     <span className="text-white font-bold">Staff Bonus (Tip)</span>
                                 </div>
                                 <span className="text-pink-400 font-mono font-bold text-lg">${prices.tip.toLocaleString()}</span>
                             </label>
                         )}
                     </div>

                     {/* Botones */}
                     <div className="flex gap-3 pt-2">
                         <button onClick={onClose} className="flex-1 bg-gray-700 hover:bg-gray-600 py-4 rounded-xl text-white font-bold uppercase tracking-wider transition-colors active:scale-[0.98]">
                             Cancelar
                         </button>
                         <button onClick={onConfirm} disabled={loading || (activeTab === "search" && !selectedPlayerId)} className="flex-[2] bg-violet-600 hover:bg-violet-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed py-4 rounded-xl text-white font-bold uppercase tracking-wider transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-lg shadow-violet-900/20">
                             {loading ? (
                                 <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> Inscribiendo...</>
                             ) : (
                                 <><CheckBadgeIcon className="w-5 h-5" /> Inscribir</>
                             )}
                         </button>
                     </div>
                 </div>
             </div>
        </div>
    );
}

function ActionModal({ player, playerName, onClose, onRebuy, onAddon, onUndo, onPayTip, prices, loading }) {
    const singleRebuys = (player.rebuys_count || 0) - (player.double_rebuys_count || 0);
    const singleAddons = (player.addons_count || 0) - (player.double_addons_count || 0);

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm p-4">
            <div className="bg-gray-800 rounded-2xl border border-gray-700 shadow-2xl w-full max-w-md animate-fade-in-up overflow-hidden max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="bg-gray-900 p-5 border-b border-gray-700 flex justify-between items-center sticky top-0 z-10">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center border border-blue-500/20">
                            <BoltIcon className="w-5 h-5 text-blue-400" />
                        </div>
                        <div>
                            <h3 className="text-white font-black text-lg uppercase tracking-tight">{playerName}</h3>
                            <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest">Gestionar Jugador</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-700 transition-colors">
                        <XCircleIcon className="w-6 h-6 text-gray-500 hover:text-white" />
                    </button>
                </div>

                <div className="p-5 space-y-5">

                    {/* DEALER TIP */}
                    {prices.tip > 0 && (
                        <div>
                            <label className="text-pink-400 text-xs font-bold uppercase tracking-widest mb-3 block px-1 flex items-center gap-2">
                                <HeartIcon className="w-4 h-4" /> Staff Bonus (Tip)
                                {(player.tips_count || 0) > 0 && <span className="bg-pink-500/20 text-pink-300 px-2 py-0.5 rounded text-[10px]">{player.tips_count} pagado{player.tips_count !== 1 ? 's' : ''}</span>}
                            </label>
                            {(player.tips_count || 0) > 0 && (
                                <div className="bg-pink-500/10 border border-pink-500/20 rounded-xl p-3 flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                        <CheckBadgeIcon className="w-4 h-4 text-pink-400" />
                                        <span className="text-pink-300 text-sm font-bold">{player.tips_count} tip{player.tips_count !== 1 ? 's' : ''} = {formatMoney(prices.tip * player.tips_count)}</span>
                                    </div>
                                </div>
                            )}
                            <button onClick={onPayTip} disabled={loading} className="w-full bg-pink-900/20 border border-pink-500/30 hover:border-pink-400 hover:bg-pink-900/40 text-white p-4 rounded-xl text-center transition-all active:scale-[0.97] disabled:opacity-30">
                                <div className="text-xs font-bold uppercase tracking-wider text-pink-300 mb-1">+ Cobrar Tip</div>
                                <div className="text-xl font-black font-mono">{formatMoney(prices.tip)}</div>
                            </button>
                        </div>
                    )}

                    {/* Recompras */}
                    <div>
                        <label className="text-blue-400 text-xs font-bold uppercase tracking-widest mb-3 block px-1 flex items-center gap-2">
                            <ArrowPathIcon className="w-4 h-4" /> Recompras (Rebuy)
                            {player.rebuys_count > 0 && <span className="bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded text-[10px]">{player.rebuys_count} total</span>}
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <button onClick={()=>onRebuy("SINGLE")} disabled={loading || prices.rebuyS <= 0} className="w-full bg-blue-900/20 border border-blue-500/30 hover:border-blue-400 hover:bg-blue-900/40 text-white p-4 rounded-xl text-center transition-all active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed">
                                    <div className="text-xs font-bold uppercase tracking-wider text-blue-300 mb-1">+ Sencillo</div>
                                    <div className="text-xl font-black font-mono">{formatMoney(prices.rebuyS)}</div>
                                </button>
                                {singleRebuys > 0 && (
                                    <button onClick={()=>onUndo("rebuy","SINGLE")} disabled={loading} className="w-full text-red-400 hover:text-red-300 hover:bg-red-900/20 border border-gray-700 hover:border-red-500/30 py-2 rounded-lg text-[10px] font-bold uppercase transition-colors">
                                        Deshacer ({singleRebuys})
                                    </button>
                                )}
                            </div>
                            <div className="space-y-2">
                                <button onClick={()=>onRebuy("DOUBLE")} disabled={loading || prices.rebuyD <= 0} className="w-full bg-blue-900/20 border border-blue-500/30 hover:border-blue-400 hover:bg-blue-900/40 text-white p-4 rounded-xl text-center transition-all active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed">
                                    <div className="text-xs font-bold uppercase tracking-wider text-blue-300 mb-1">+ Doble</div>
                                    <div className="text-xl font-black font-mono">{formatMoney(prices.rebuyD)}</div>
                                </button>
                                {(player.double_rebuys_count || 0) > 0 && (
                                    <button onClick={()=>onUndo("rebuy","DOUBLE")} disabled={loading} className="w-full text-red-400 hover:text-red-300 hover:bg-red-900/20 border border-gray-700 hover:border-red-500/30 py-2 rounded-lg text-[10px] font-bold uppercase transition-colors">
                                        Deshacer ({player.double_rebuys_count})
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Add-ons */}
                    <div>
                        <label className="text-orange-400 text-xs font-bold uppercase tracking-widest mb-3 block px-1 flex items-center gap-2">
                            <PlusCircleIcon className="w-4 h-4" /> Add-ons
                            {player.addons_count > 0 && <span className="bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded text-[10px]">{player.addons_count} total</span>}
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <button onClick={()=>onAddon("SINGLE")} disabled={loading || prices.addonS <= 0} className="w-full bg-orange-900/20 border border-orange-500/30 hover:border-orange-400 hover:bg-orange-900/40 text-white p-4 rounded-xl text-center transition-all active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed">
                                    <div className="text-xs font-bold uppercase tracking-wider text-orange-300 mb-1">+ Sencillo</div>
                                    <div className="text-xl font-black font-mono">{formatMoney(prices.addonS)}</div>
                                </button>
                                {singleAddons > 0 && (
                                    <button onClick={()=>onUndo("addon","SINGLE")} disabled={loading} className="w-full text-red-400 hover:text-red-300 hover:bg-red-900/20 border border-gray-700 hover:border-red-500/30 py-2 rounded-lg text-[10px] font-bold uppercase transition-colors">
                                        Deshacer ({singleAddons})
                                    </button>
                                )}
                            </div>
                            <div className="space-y-2">
                                <button onClick={()=>onAddon("DOUBLE")} disabled={loading || prices.addonD <= 0} className="w-full bg-orange-900/20 border border-orange-500/30 hover:border-orange-400 hover:bg-orange-900/40 text-white p-4 rounded-xl text-center transition-all active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed">
                                    <div className="text-xs font-bold uppercase tracking-wider text-orange-300 mb-1">+ Doble</div>
                                    <div className="text-xl font-black font-mono">{formatMoney(prices.addonD)}</div>
                                </button>
                                {(player.double_addons_count || 0) > 0 && (
                                    <button onClick={()=>onUndo("addon","DOUBLE")} disabled={loading} className="w-full text-red-400 hover:text-red-300 hover:bg-red-900/20 border border-gray-700 hover:border-red-500/30 py-2 rounded-lg text-[10px] font-bold uppercase transition-colors">
                                        Deshacer ({player.double_addons_count})
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Cerrar */}
                    <button onClick={onClose} className="w-full bg-gray-700 hover:bg-gray-600 py-4 rounded-xl text-white font-bold uppercase tracking-wider transition-colors active:scale-[0.98]">
                        Cerrar
                    </button>
                </div>
            </div>
        </div>
    );
}