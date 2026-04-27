import { useState, useEffect, useRef } from 'react';
import TransactionManager from './TransactionManager';
import { sessionService, tournamentService } from '../api/services';
import CreateTournamentForm from './CreateTournamentForm';

import Modal from './Modal';
import TransactionForm from './TransactionForm';
import CloseSessionForm from './CloseSessionForm';
import StatsPanel from './StatsPanel';
import PlayerTable from './PlayerTable';
import api from '../api/axios';
import ConfirmModal from './ConfirmModal';
import TournamentPlayerTable from './TournamentPlayerTable';
import { useAuth } from '../context/AuthContext';

import {
  PlayIcon,
  TrashIcon,
  BanknotesIcon,
  ArrowDownTrayIcon,
  SparklesIcon,
  BeakerIcon,
  HandThumbUpIcon,
  LockClosedIcon,
  ClipboardDocumentCheckIcon,
  ClockIcon,
  TableCellsIcon,
  UserGroupIcon,
  TrophyIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ExclamationTriangleIcon,
  ArrowRightOnRectangleIcon
} from '@heroicons/react/24/solid';

export default function GameControl() {
  const { logout } = useAuth();
  const [tables, setTables] = useState([]); // Sessions OPEN del club
  const [currentTableId, setCurrentTableId] = useState(null);
  const activeSession = tables.find(t => t.id === currentTableId) || null;

  const [activeTournament, setActiveTournament] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedPlayerForHistory, setSelectedPlayerForHistory] = useState(null);
  const [viewMode, setViewMode] = useState("menu"); // "menu", "cash" o "tournament"
  const isFirstLoad = useRef(true);
  const [newTournamentName, setNewTournamentName] = useState("");
  const [tournamentCost, setTournamentCost] = useState({
      buyin: 0,
      tip: 0,
      rebuy: 0,
      doubleRebuy: 0,
      addon: 0,
      doubleAddon: 0
  });

  // Modal "Nueva mesa": en este flujo, la sesion se crea junto con el
  // primer buy-in (no antes). Solo capturamos el nombre opcional.
  const [showNewTableModal, setShowNewTableModal] = useState(false);
  const [newTableName, setNewTableName] = useState("");
  const [pendingTableName, setPendingTableName] = useState(null);
  

  // ESTADOS DEL MODAL
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState("buyin"); 
  const [modalTitle, setModalTitle] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  const [showEndTournamentModal, setShowEndTournamentModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  // ESTADOS DE AUDITORÍA
  const [auditData, setAuditData] = useState(null);
  const [showAuditModal, setShowAuditModal] = useState(false);

  // 1. CARGAR SESIÓN Y TORNEO ACTIVO
useEffect(() => {
    const checkSystemState = async () => {
      try {
        const [openTables, tournament] = await Promise.all([
            sessionService.findOpenSessions(),
            tournamentService.findActive()
        ]);

        setTables(openTables);
        setActiveTournament(tournament);

        // En el primer load: decidir vista por defecto y mesa actual
        if (isFirstLoad.current) {
            isFirstLoad.current = false;
            if (openTables.length > 0 && tournament) {
                setViewMode("menu");
            } else if (tournament) {
                setViewMode("tournament");
            } else if (openTables.length === 1) {
                setCurrentTableId(openTables[0].id);
                setViewMode("cash");
            } else if (openTables.length > 1) {
                setViewMode("menu");
            } else {
                setViewMode("menu");
            }
        } else {
            // Refresh posterior: si la mesa actual ya no esta abierta, ir a menu
            if (currentTableId && !openTables.some(t => t.id === currentTableId)) {
                setCurrentTableId(null);
                if (openTables.length === 0) setViewMode("menu");
            }
        }
      } catch (error) {
        console.error("Error conectando:", error);
      } finally {
        setLoading(false);
      }
    };
    checkSystemState();
}, [refreshKey]);

  const refresh = () => setRefreshKey(prev => prev + 1);

  // 2. INICIAR MESA DE CASH (multi-mesa: pide nombre opcional y crea inmediatamente)
  const [pendingSessionOpen, setPendingSessionOpen] = useState(false);

  const handleStartSession = () => {
    setNewTableName("");
    setShowNewTableModal(true);
  };

  // El usuario confirma el nombre y pasamos al modal de primer buy-in.
  // La mesa NO se crea hasta que se confirme el primer jugador.
  const handleConfirmTableName = () => {
    setPendingTableName(newTableName.trim() || null);
    setShowNewTableModal(false);
    setPendingSessionOpen(true);
    setModalType("buyin");
    const label = newTableName.trim() ? newTableName.trim() : "Apertura de Mesa";
    setModalTitle(`Primer Jugador (${label})`);
    setIsModalOpen(true);
  };

  const handleSwitchTable = (tableId) => {
    setCurrentTableId(tableId);
    setViewMode("cash");
  };

  // 3. INICIAR TORNEO
const handleCreateTournament = async (formData) => {
      try {
          // 1. Enviar al Backend
          const newTournament = await tournamentService.create(formData);
          
          // 2. Actualizar Estado Visual Inmediato
          setActiveTournament(newTournament);
          setViewMode("tournament"); 
          
          // 3. Cerrar Modal
          setIsModalOpen(false);  
      } catch (error) {
          alert("Error al crear el torneo");
          console.error(error);
      }
  };

  // HANDLERS MODALES
  const handleOpenModal = (type, title) => {
    setModalType(type);
    setModalTitle(title);
    setIsModalOpen(true);
  };

  const handleTransactionSuccess = (info) => {
    setIsModalOpen(false);
    setPendingSessionOpen(false);
    setPendingTableName(null);
    // Si fue apertura de mesa nueva, entrar a esa mesa directamente
    if (info && info.newSessionId) {
      setCurrentTableId(info.newSessionId);
      setViewMode("cash");
    }
    refresh();
  };

  const handleAudit = async () => {
    if (!activeSession) return;
    try {
      const data = await sessionService.getAuditDataForTable(activeSession.id);
      setAuditData(data);
      setShowAuditModal(true);
    } catch (error) {
      console.error("Error auditar:", error);
      alert("No se pudo auditar.");
    }
  };

  // BORRAR SESIÓN CASH
  const requestDeleteSession = () => {
     if (!activeSession) return;
     setShowDeleteConfirm(true);
  };

  const executeDeleteSession = async () => {
     if (!activeSession) return;
     setIsDeletingSession(true);
     const deletedId = activeSession.id;
     try {
        await api.delete(`/sessions/${deletedId}`);
        const remaining = tables.filter(t => t.id !== deletedId);
        setTables(remaining);
        if (remaining.length === 0) {
          setCurrentTableId(null);
          setViewMode("menu");
        } else {
          setCurrentTableId(remaining[0].id);
        }
        setShowDeleteConfirm(false);
     } catch (error) {
        console.error(error);
        alert(error.response?.data?.detail || "Error al eliminar");
     } finally {
        setIsDeletingSession(false);
     }
  };

  const handleEndTournament = async () => {
    setShowEndTournamentModal(true);
  };

  const confirmEndTournament = async () => {
    setIsLoading(true);
    try {
      await tournamentService.endTournament(activeTournament.id);
      setActiveTournament(null);
      setViewMode("cash"); 
      setShowEndTournamentModal(false);
      refresh();
    } catch (error) {
      console.error(error);
      alert("Error al terminar torneo");
    }finally {
            setIsLoading(false); // 🔓 2. Desactivar bloqueo
            setShowEndTournamentModal(false); // 3. Cerrar modal
        }
};

  if (loading) return <div className="text-white text-center p-10 animate-pulse">📡 Conectando con el sistema...</div>;

  return (
  <div className="max-w-4xl mx-auto p-4">
      {isLoading && <GlobalLoader />}

      {/* STRIP DE MESAS (multi-mesa, solo en cash con >= 2 mesas) */}
      {viewMode === "cash" && tables.length >= 2 && (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
          {tables.map(t => (
            <button
              key={t.id}
              onClick={() => handleSwitchTable(t.id)}
              className={`shrink-0 px-4 py-2 rounded-lg font-bold text-sm uppercase tracking-wider border transition-all ${
                t.id === currentTableId
                  ? 'bg-emerald-600 text-white border-emerald-500 shadow-lg shadow-emerald-900/30'
                  : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700 hover:border-gray-600'
              }`}
            >
              <TableCellsIcon className="w-4 h-4 inline mr-2" />
              {t.name || `Mesa #${t.id}`}
            </button>
          ))}
          <button
            onClick={handleStartSession}
            className="shrink-0 px-4 py-2 rounded-lg font-bold text-sm uppercase tracking-wider border border-dashed border-gray-600 text-gray-400 hover:border-emerald-500/60 hover:text-emerald-400 hover:bg-emerald-500/5 transition-all"
          >
            + Nueva mesa
          </button>
        </div>
      )}

      {/* HEADER: BARRA DE ESTADO PRO (Dinámica según el modo) */}
      <header className={`border-b-4 rounded-t-lg shadow-xl p-5 flex flex-col md:flex-row justify-between items-center mb-8 gap-4 ${viewMode === 'tournament' ? 'bg-gray-900 border-violet-600' : 'bg-gray-800 border-emerald-600'}`}>
        
        <div className="flex items-center gap-4 w-full md:w-auto">
          {/* CASO 1: TORNEO ACTIVO */}
          {viewMode === "tournament" && activeTournament ? (
             <div className="flex items-center gap-4">
                <div className="bg-violet-900/30 p-3 rounded-xl border border-violet-500/30 shadow-[0_0_15px_rgba(124,58,237,0.1)]">
                   <TrophyIcon className="w-8 h-8 text-violet-400" />
                </div>
                <div>
                   <h1 className="text-white font-black text-xl tracking-tight uppercase leading-none">
                     {activeTournament.name}
                   </h1>
                   <div className="flex items-center gap-2 mt-1.5">
                       <span className="relative flex h-2.5 w-2.5">
                         <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                         <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-violet-500"></span>
                       </span>
                       <span className="text-violet-500 text-xs font-bold uppercase tracking-[0.15em]">Torneo en Curso</span>
                   </div>
                </div>
             </div>
          ) : viewMode === "cash" && activeSession ? (
             /* CASO 2: CASH GAME ACTIVO */
            <div className="flex items-center gap-4">
              <button
                onClick={() => setViewMode("menu")}
                className="p-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-all border border-gray-700 hover:border-emerald-500/50 shadow-sm group"
                title="Volver al Menu Principal"
              >
                <ArrowLeftIcon className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
              </button>
              <div className="bg-emerald-900/30 p-3 rounded-xl border border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                  <TableCellsIcon className="w-8 h-8 text-emerald-400" />
              </div>

              <div>
                  <h1 className="text-white font-black text-xl tracking-tight uppercase leading-none">
                    {activeSession.name || 'Mesa'} <span className="text-gray-500 font-medium text-lg">#{activeSession.id}</span>
                  </h1>
                  <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-emerald-500 text-xs font-bold uppercase tracking-[0.15em]">Sistema Online</span>
                  </div>
                  {/* Botón Borrar (Solo en Cash) */}
                  <div className="ml-4 pl-4 border-l border-gray-700 inline-block">
                    <button
                      onClick={requestDeleteSession}
                      className="group flex flex-col items-center justify-center p-1 rounded-lg hover:bg-red-500/20 transition-all border border-transparent hover:border-red-500/50"
                      title="ELIMINAR ESTA SESIÓN"
                    >
                      <TrashIcon className="w-5 h-5 text-gray-600 group-hover:text-red-500 transition-colors" />
                    </button>
                  </div>
              </div>
            </div>
          ) : (
             /* CASO 3: NADA ACTIVO */
            <div className="flex items-center gap-4 opacity-60">
              <div className="bg-gray-700/30 p-3 rounded-xl border border-gray-600">
                  <LockClosedIcon className="w-8 h-8 text-gray-400" />
              </div>
              <div>
                <h1 className="text-gray-300 font-black text-xl tracking-tight uppercase leading-none">Sistema en Espera</h1>
                <p className="text-gray-500 text-xs font-bold uppercase tracking-[0.15em] mt-1.5">Seleccione una opción</p>
              </div>
            </div>
          )}
        </div>

        {/* Reloj Digital */}
        <div className="flex items-center gap-3 bg-gray-900/60 px-6 py-3 rounded-lg border border-gray-700 shadow-inner w-full md:w-auto justify-center md:justify-end">
          <ClockIcon className="w-5 h-5 text-gray-400" />
          <span className="text-2xl font-mono text-white font-bold tracking-widest">
            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </header>

        {/* --- ZONA PRINCIPAL --- */}
        
        {/* ESCENARIO 1: TORNEO ACTIVO (Dashboard de Torneo) */}
{viewMode === "tournament" && activeTournament ? (
        <div className="animate-fade-in-up bg-gray-900/50 p-6 rounded-2xl border border-violet-500/30">
            
            {/* HEADER: TÍTULO Y BOTONES DE CONTROL (DISEÑO MEJORADO) */}
            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-6 gap-4 border-b border-gray-700/50 pb-6">
                
                {/* LADO IZQUIERDO: VOLVER + TÍTULO */}
                <div className="flex items-center gap-4 w-full xl:w-auto">
                    {/* Botón Volver (Flecha) */}
                    <button
                        onClick={() => setViewMode("menu")}
                        className="p-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-all border border-gray-700 hover:border-gray-500 shadow-sm group"
                        title="Volver al Menu Principal"
                    >
                        <ArrowLeftIcon className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                    </button>

                    {/* Icono y Título */}
                    <div className="flex items-center gap-3 overflow-hidden">
                        <div className="bg-yellow-500/10 p-2 rounded-lg border border-yellow-500/20 shrink-0">
                           <TrophyIcon className="w-8 h-8 text-yellow-400" />
                        </div>
                        <div className="min-w-0">
                           <h2 className="text-xl md:text-2xl font-black text-white uppercase leading-none truncate md:whitespace-normal">
                             {activeTournament.name}
                           </h2>
                           <span className="text-[10px] text-violet-400 font-mono font-medium tracking-wider block mt-1">
                             PANEL DE CONTROL
                           </span>
                        </div>
                    </div>
                </div>
                
                {/* LADO DERECHO: ACCIÓN DESTRUCTIVA (Terminar) */}
                <div className="w-full xl:w-auto flex justify-end">
                    <button 
                        onClick={handleEndTournament}
                        className="bg-red-600/90 hover:bg-red-500 text-white px-5 py-2.5 rounded-lg font-bold text-xs uppercase tracking-widest shadow-lg shadow-red-900/20 transition-all border border-red-500/50 flex items-center gap-2"
                    >
                        <TrashIcon className="w-4 h-4" />
                        Terminar Torneo
                    </button>
                </div>
            </div>

            {/* TABLA DE JUGADORES */}
            <TournamentPlayerTable 
                tournament={activeTournament} 
                onUpdate={refresh} 
            />
        </div>

  ) : viewMode === "cash" && activeSession ? (
        /* ESCENARIO 2: CASH GAME ACTIVO */
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 animate-fade-in-up">
           <ActionButton color="green" label="💰 Buy-in / Rebuy" onClick={() => handleOpenModal("buyin", "Registrar Entrada")} />
           <ActionButton color="red" label="💸 Cashout" onClick={() => handleOpenModal("cashout", "Registrar Salida")} />
           <ActionButton color="orange" label="🎁 Bono / Promo" onClick={() => handleOpenModal("bonus", "Otorgar Bono")} />
           <ActionButton color="blue" label="🍺 Bebida/Gasto" onClick={() => handleOpenModal("spend", "Registrar Gasto")} />
           <ActionButton color="purple" label="🎁 Jackpot Payout" onClick={() => handleOpenModal("jackpot-payout", "Pagar Premio Jackpot")} />
           <ActionButton color="yellow" label="🤝 Propina Dealer" onClick={() => handleOpenModal("tip", "Registrar Propina")} />    

           <div className="col-span-2 md:col-span-3 mt-4">
              <StatsPanel refreshTrigger={refreshKey} sessionId={activeSession?.id} />
              <PlayerTable
                refreshTrigger={refreshKey}
                sessionId={activeSession?.id}
                onPlayerSelect={setSelectedPlayerForHistory}
                onRefresh={refresh}
              />
           </div>

           <div className="col-span-2 md:col-span-3 mt-6 border-t border-gray-700 pt-6 space-y-4">
              <button 
                className="w-full bg-yellow-600/90 hover:bg-yellow-500 text-white font-bold py-3 rounded-lg border border-yellow-700 transition-colors cursor-pointer flex justify-center items-center gap-2 shadow-lg"
                onClick={handleAudit}
              >
                🕵️‍♂️ Auditar Caja (Pre-Cierre)
              </button>

              <button 
                className="w-full bg-gray-700 hover:bg-red-900/80 text-red-200 font-bold py-3 rounded-lg border border-red-900/50 transition-colors cursor-pointer"
                onClick={() => handleOpenModal("close", "Cierre de Caja y Auditoría")}
              >
                🔒 Cerrar Sesión Definitivamente
              </button>
              
              <div className="pt-4 flex justify-center gap-6">
                 <button onClick={() => setViewMode("menu")} className="text-gray-600 hover:text-emerald-400 text-xs font-bold uppercase tracking-widest flex items-center gap-2 transition-colors">
                    <ArrowLeftIcon className="w-4 h-4" />
                    Volver al Menu
                 </button>
                 <button onClick={logout} className="text-gray-600 hover:text-red-400 text-xs font-bold uppercase tracking-widest flex items-center gap-2 transition-colors">
                    <ArrowRightOnRectangleIcon className="w-4 h-4" />
                    Salir del Sistema
                 </button>
             </div>
           </div>
        </div>

      ) : (
        /* ESCENARIO 3: MENÚ PRINCIPAL (Sin nada activo) */
        <div className="flex flex-col items-center justify-center py-10 bg-gray-800/30 rounded-2xl border-2 border-dashed border-gray-700/50 backdrop-blur-sm">
           
           <div className="group relative mb-6">
              <div className="absolute inset-0 bg-indigo-500/20 rounded-full blur-xl group-hover:bg-indigo-500/30 transition-all duration-500"></div>
              <div className="relative w-20 h-20 bg-gray-900 rounded-full flex items-center justify-center shadow-2xl border border-gray-700 group-hover:border-indigo-500/50 transition-colors">
                 <span className="text-4xl">♠️</span>
              </div>
           </div>

           <h2 className="text-3xl text-white font-bold uppercase tracking-widest mb-2 text-center">RakeFlow Control</h2>
           <p className="text-gray-500 mb-8 text-center max-w-md font-medium text-sm">Selecciona el tipo de juego para comenzar</p>

           <div className="flex flex-col gap-5 w-full max-w-md px-4">
               {/* Opcion CASH: lista de mesas activas + boton nueva */}
               {tables.length > 0 ? (
                 <div className="space-y-3">
                   <div className="flex items-center justify-between px-2">
                     <span className="text-emerald-400 text-xs font-bold uppercase tracking-widest">
                       Mesas activas ({tables.length})
                     </span>
                   </div>
                   {tables.map(t => (
                     <button
                       key={t.id}
                       onClick={() => handleSwitchTable(t.id)}
                       className="group relative overflow-hidden w-full bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold py-3.5 px-6 rounded-xl shadow-[0_0_20px_rgba(16,185,129,0.3)] border-b-4 border-emerald-900 active:border-b-0 active:translate-y-1 transition-all duration-150 flex items-center justify-between gap-3 uppercase tracking-wider"
                     >
                       <div className="flex items-center gap-3">
                         <div className="bg-white/20 p-2 rounded-lg shrink-0"><TableCellsIcon className="w-5 h-5 text-white" /></div>
                         <div className="text-left">
                           {t.name ? (
                             <>
                               <span className="block text-[10px] text-emerald-100 font-medium tracking-widest">Mesa #{t.id}</span>
                               <span className="block leading-none text-base">{t.name}</span>
                             </>
                           ) : (
                             <span className="block leading-none text-base">Mesa #{t.id}</span>
                           )}
                         </div>
                       </div>
                       <ArrowRightIcon className="w-5 h-5 text-white/70 group-hover:text-white" />
                     </button>
                   ))}
                   <button
                     onClick={handleStartSession}
                     className="w-full bg-gray-800/60 hover:bg-emerald-500/10 text-gray-400 hover:text-emerald-400 border-2 border-dashed border-gray-700 hover:border-emerald-500/50 rounded-xl py-3 font-bold text-sm uppercase tracking-widest transition-all"
                   >
                     + Nueva mesa
                   </button>
                 </div>
               ) : (
                 <button
                   onClick={handleStartSession}
                   className="group relative overflow-hidden w-full bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-lg py-4 px-8 rounded-xl shadow-[0_0_20px_rgba(16,185,129,0.3)] border-b-4 border-emerald-900 active:border-b-0 active:translate-y-1 transition-all duration-150 flex items-center justify-center gap-4 uppercase tracking-wider"
                 >
                   <div className="bg-emerald-900/30 p-2 rounded-lg"><PlayIcon className="w-6 h-6 text-emerald-200" /></div>
                   <div className="text-left"><span className="block text-xs text-emerald-300 font-medium">Partida Regular</span><span className="block leading-none">Iniciar Cash Game</span></div>
                 </button>
               )}

               {/* Opción TORNEO */}
{activeTournament ? (
                   // CASO A: YA HAY TORNEO -> Botón "CONTINUAR"
                   <button 
                     onClick={() => setViewMode("tournament")} 
                     className="group relative overflow-hidden w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white font-bold text-lg py-4 px-8 rounded-xl shadow-[0_0_20px_rgba(124,58,237,0.4)] border-b-4 border-violet-900 active:border-b-0 active:translate-y-1 transition-all duration-150 flex items-center justify-center gap-4 uppercase tracking-wider animate-pulse-slow"
                   >
                     <div className="bg-white/20 p-2 rounded-lg"><TrophyIcon className="w-6 h-6 text-white" /></div>
                     <div className="text-left">
                        <span className="block text-xs text-violet-200 font-medium">Torneo en Curso</span>
                        <span className="block leading-none">Continuar Torneo</span>
                     </div>
                   </button>
               ) : (
                   // CASO B: NO HAY TORNEO -> Botón "CREAR" (El que tenías antes)
                   <button 
                     onClick={() => handleOpenModal("create-tournament", "")} 
                     className="group relative overflow-hidden w-full bg-violet-700 hover:bg-violet-600 text-white font-bold text-lg py-4 px-8 rounded-xl shadow-[0_0_20px_rgba(124,58,237,0.3)] border-b-4 border-violet-900 active:border-b-0 active:translate-y-1 transition-all duration-150 flex items-center justify-center gap-4 uppercase tracking-wider"
                   >
                     <div className="bg-violet-900/30 p-2 rounded-lg"><TrophyIcon className="w-6 h-6 text-violet-200" /></div>
                     <div className="text-left"><span className="block text-xs text-violet-300 font-medium">Evento Especial</span><span className="block leading-none">Organizar Torneo</span></div>
                   </button>
               )}

               <div className="h-px bg-gray-700 w-full my-2"></div>

               <button onClick={logout} className="w-full flex items-center justify-center gap-2 text-gray-500 hover:text-red-400 py-2 rounded-xl hover:bg-red-900/10 transition-all text-sm font-bold uppercase tracking-widest">
                  <ArrowRightOnRectangleIcon className="w-4 h-4" /> Cerrar Sistema
               </button>
           </div>           
        </div>
        
      )}

      {/* MODALES */}
      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setPendingSessionOpen(false); setPendingTableName(null); }} title={modalTitle}>
        {modalType === "close" ? (
          <CloseSessionForm sessionId={activeSession?.id} onSuccess={handleTransactionSuccess} />
        ) : modalType === "create-tournament" ? (
          <CreateTournamentForm onSuccess={handleCreateTournament} onCancel={() => setIsModalOpen(false)} />
        ) : (
          <TransactionForm
            type={modalType}
            onSuccess={handleTransactionSuccess}
            sessionId={pendingSessionOpen ? null : activeSession?.id}
            createSessionFirst={pendingSessionOpen}
            pendingTableName={pendingTableName}
          />
        )}
      </Modal>

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={executeDeleteSession}
        isDeleting={isDeletingSession}
        title="¿Eliminar Mesa Activa?"
        message={`Estás a punto de borrar la Sesión #${activeSession?.id}.\n\n⚠️ ESTO ES IRREVERSIBLE.`}
      />

      {/* MODAL NUEVA MESA */}
      {showNewTableModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] backdrop-blur-md p-4 animate-fade-in">
          <div className="bg-gray-900 rounded-2xl border border-emerald-500/30 shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="bg-gray-800 p-4 border-b border-gray-700 flex items-center gap-3">
              <TableCellsIcon className="w-6 h-6 text-emerald-400" />
              <h3 className="text-lg font-bold text-white">Nueva mesa</h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-2 block">
                  Nombre de la mesa <span className="text-gray-600 normal-case font-normal">(opcional)</span>
                </label>
                <input
                  type="text"
                  value={newTableName}
                  onChange={(e) => setNewTableName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmTableName(); }}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 focus:outline-none"
                  placeholder="Mesa VIP, Mesa Principal, ..."
                  maxLength={100}
                  autoFocus
                />
                <p className="text-xs text-gray-500 mt-2">Si lo dejas vacio se mostrara como "Mesa #ID". El siguiente paso registra el primer jugador.</p>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowNewTableModal(false)}
                  className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-bold text-sm uppercase tracking-wider"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleConfirmTableName}
                  className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-sm uppercase tracking-wider shadow-lg shadow-emerald-900/30"
                >
                  Continuar →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE AUDITORÍA */}
      {showAuditModal && auditData && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60] p-4 backdrop-blur-md animate-fade-in">
           {/* ... Contenido igual al que ya tenías ... */}
           <div className="bg-gray-900 rounded-xl max-w-sm w-full border border-gray-700 shadow-2xl overflow-hidden">
             <div className="bg-gray-800 p-4 border-b border-gray-700 flex justify-between items-center">
               <h3 className="text-lg font-bold text-white flex items-center gap-2">📑 Auditoría Rápida</h3>
               <button onClick={() => setShowAuditModal(false)} className="text-gray-400 hover:text-white">&times;</button>
             </div>
             <div className="p-6 space-y-4">
                <div className="space-y-3 text-sm">
                   <div className="flex justify-between text-green-400"><span>(+) Buy-ins:</span><span className="font-bold">${auditData.total_buyins.toLocaleString()}</span></div>
                   <div className="flex justify-between text-red-400"><span>(-) Cashouts:</span><span className="font-bold">${auditData.total_cashouts.toLocaleString()}</span></div>
                   <div className="flex justify-between text-purple-400"><span>(-) Jackpots:</span><span className="font-bold">${auditData.total_jackpot_payouts.toLocaleString()}</span></div>
                   <div className="flex justify-between text-yellow-500"><span>(-) Propinas:</span><span className="font-bold">${auditData.total_tips.toLocaleString()}</span></div>
                   <div className="flex justify-between text-orange-400"><span>(-) Gastos:</span><span className="font-bold">${auditData.total_expenses.toLocaleString()}</span></div>
                </div>
                <hr className="border-gray-700" />
                <div className="bg-gray-800 p-4 rounded-lg text-center border border-gray-600">
                  <p className="text-gray-400 text-xs mb-1 uppercase tracking-wider">Dinero Físico Esperado</p>
                  <p className="text-3xl font-mono font-bold text-white">${auditData.expected_cash_in_box.toLocaleString()}</p>
                </div>
                <button onClick={() => setShowAuditModal(false)} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg mt-2">Entendido</button>
             </div>
           </div>
        </div>
      )}
      {showEndTournamentModal && (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[70] backdrop-blur-sm p-4 animate-fade-in">
         <div className="bg-gray-800 rounded-2xl border border-red-500/50 shadow-2xl w-full max-w-sm p-6 text-center">
             <div className="bg-red-500/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                 <ExclamationTriangleIcon className="w-8 h-8 text-red-500" />
             </div>
             <h3 className="text-xl font-bold text-white mb-2">¿Terminar Torneo?</h3>
             <p className="text-gray-400 mb-6 text-sm">
                 Esta acción cerrará el torneo permanentemente y archivará los resultados. No se puede deshacer.
             </p>
             <div className="flex gap-3">
                 <button 
                     onClick={() => setShowEndTournamentModal(false)}
                     className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-bold"
                 >
                     Cancelar
                 </button>
                 <button 
                     onClick={confirmEndTournament}
                     className="flex-1 py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold shadow-lg shadow-red-900/30"
                 >
                     Sí, Terminar
                 </button>
             </div>
         </div>
    </div>
    )}

      {selectedPlayerForHistory && (
        <TransactionManager player={selectedPlayerForHistory} onClose={() => setSelectedPlayerForHistory(null)} onUpdate={refresh} />
      )}
      
  </div>
  );
}
function GlobalLoader() {
    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[150] flex flex-col items-center justify-center animate-fade-in">
            <div className="bg-gray-900/90 p-6 rounded-2xl border border-red-500/30 flex flex-col items-center shadow-2xl">
                <div className="relative w-16 h-16 mb-4">
                    <div className="absolute inset-0 border-4 border-gray-700 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-red-500 rounded-full border-t-transparent animate-spin"></div>
                </div>
                <p className="text-red-200 font-bold text-lg animate-pulse">Terminando Torneo...</p>
                <p className="text-gray-500 text-xs mt-2">Guardando resultados finales</p>
            </div>
        </div>
    );
}

function ActionButton({ color, label, onClick }) {
  const colors = {
    green: "bg-green-600 hover:bg-green-500 border-green-800",
    red: "bg-red-600 hover:bg-red-500 border-red-800",
    blue: "bg-blue-600 hover:bg-blue-500 border-blue-800",
    purple: "bg-purple-600 hover:bg-purple-500 border-purple-800",
    yellow: "bg-yellow-600 hover:bg-yellow-500 border-yellow-800 text-black",
    orange: "bg-orange-600 hover:bg-orange-500 border-orange-800",
  };



  return (
    <button onClick={onClick} className={`${colors[color]} text-white font-bold py-6 px-4 rounded-xl shadow-lg border-b-4 active:border-b-0 active:translate-y-1 active:shadow-none transition-all cursor-pointer text-lg flex flex-col items-center justify-center gap-1`}>
      {label}
    </button>
  );
}