import { useState, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import TransactionManager from './TransactionManager';
import { sessionService, tournamentService } from '../api/services';
import CreateTournamentForm from './CreateTournamentForm';

import Modal from './Modal';
import TransactionForm from './TransactionForm';
import CloseSessionForm from './CloseSessionForm';
import StatsPanel from './StatsPanel';
import DealerPanel from './DealerPanel';
import PlayerTable from './PlayerTable';
import api from '../api/axios';
import ConfirmModal from './ConfirmModal';
import { useToast, Toast } from './Toast';
import { shareCardImage } from '../utils/shareImage';
import TournamentPlayerTable from './TournamentPlayerTable';
import TournamentClock from './TournamentClock';
import TournamentTables from './TournamentTables';
import { useAuth } from '../context/AuthContext';
import { formatMoney } from '../utils/formatters';
import { useEscape } from '../hooks/useEscape';

// Formatea una duracion en mins -> "1h 30m", "45m", "2h"
function formatDuration(startIso) {
  if (!startIso) return null;
  const start = new Date(startIso).getTime();
  if (isNaN(start)) return null;
  const minutes = Math.floor((Date.now() - start) / 60000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

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
  ShareIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ExclamationTriangleIcon,
  ArrowRightOnRectangleIcon
} from '@heroicons/react/24/solid';

export default function GameControl() {
  const { logout } = useAuth();
  const [tables, setTables] = useState([]); // Sessions OPEN del club
  const [currentTableId, setCurrentTableId] = useState(null);
  // Espejo en ref (mismo patrón que selectTournament): checkSystemState corre
  // con closures de renders viejos y podía deseleccionar la mesa recién creada.
  const currentTableIdRef = useRef(null);
  const selectTable = (id) => { reqSeqRef.current++; currentTableIdRef.current = id; setCurrentTableId(id); };
  const activeSession = tables.find(t => t.id === currentTableId) || null;

  // Multi-torneo: lista de torneos en juego + id seleccionado (mismo patrón que
  // las mesas cash). activeTournament es DERIVADO (no estado): un poll en vuelo
  // con closure viejo no puede pisarlo. El ref refleja la selección actual para
  // que checkSystemState (que corre con closures de renders viejos) no la pise.
  const [liveTournaments, setLiveTournaments] = useState([]);
  const [currentTournamentId, setCurrentTournamentId] = useState(null);
  const currentTournamentIdRef = useRef(null);
  // Secuencia de polls: una mutación optimista (abrir/crear torneo, mesa nueva)
  // la incrementa para DESCARTAR respuestas de polls que ya estaban en vuelo —
  // si no, un poll viejo borra el append optimista y rebota al menú.
  const reqSeqRef = useRef(0);
  const selectTournament = (id) => {
    reqSeqRef.current++;
    currentTournamentIdRef.current = id;
    setCurrentTournamentId(id);
  };
  const [scheduledTournaments, setScheduledTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedPlayerForHistory, setSelectedPlayerForHistory] = useState(null);
  const [viewMode, setViewMode] = useState("menu"); // "menu", "cash" o "tournament"
  const isFirstLoad = useRef(true);

  // Modal "Nueva mesa": en este flujo, la sesion se crea junto con el
  // primer buy-in (no antes). Solo capturamos el nombre opcional.
  const [showNewTableModal, setShowNewTableModal] = useState(false);
  const [newTableName, setNewTableName] = useState("");
  const [newTableMaxPlayers, setNewTableMaxPlayers] = useState(9);
  const [pendingMaxPlayers, setPendingMaxPlayers] = useState(9);
  const [pendingTableName, setPendingTableName] = useState(null);
  

  // ESTADOS DEL MODAL
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState("buyin"); 
  const [modalTitle, setModalTitle] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showEndTournamentModal, setShowEndTournamentModal] = useState(false);
  // Doble confirmación al terminar con activos sin premiar (se resetea al abrir)
  const [endAck, setEndAck] = useState(false);
  // Ceremonia de premios: vive AQUÍ (no en TournamentPlayerTable) para
  // sobrevivir a que el torneo salga de la lista de vivos tras finalizar.
  const [ceremony, setCeremony] = useState(null);
  // Toast compartido de la app (Toast.jsx); showNotice conserva la firma
  // vieja (default error) para no tocar los call-sites.
  const { toast, showToast: showAppToast, dismissToast } = useToast();
  const showNotice = (message, type = "error") => showAppToast(message, type);
  // Confirmación propia para borrar un torneo programado (era window.confirm)
  const [scheduledToDelete, setScheduledToDelete] = useState(null); // objeto torneo
  const [isDeletingScheduled, setIsDeletingScheduled] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  // ESTADOS DE AUDITORÍA
  const [auditData, setAuditData] = useState(null);
  const [showAuditModal, setShowAuditModal] = useState(false);
  // Escape en los modales propios (tras las declaraciones: el enabled se
  // evalúa en cada render y leer un const antes de su línea es TDZ = crash).
  useEscape(() => setShowEndTournamentModal(false), showEndTournamentModal && !isLoading);
  useEscape(() => setShowAuditModal(false), showAuditModal);
  useEscape(() => setShowNewTableModal(false), showNewTableModal);

  // 1. CARGAR SESIÓN Y TORNEO ACTIVO
useEffect(() => {
    const checkSystemState = async () => {
      try {
        const myReq = ++reqSeqRef.current;
        const [openTables, liveTs, scheduled] = await Promise.all([
            sessionService.findOpenSessions(),
            tournamentService.findLive(),
            tournamentService.getScheduled()
        ]);
        // Respuesta vieja (hubo una mutación optimista o un poll más nuevo
        // mientras esperábamos): descartarla entera.
        if (myReq !== reqSeqRef.current) return;

        setTables(openTables);
        setLiveTournaments(liveTs);
        setScheduledTournaments(scheduled || []);

        // En el primer load: decidir vista por defecto y mesa/torneo actual
        if (isFirstLoad.current) {
            isFirstLoad.current = false;
            if (openTables.length > 0 && liveTs.length > 0) {
                setViewMode("menu");
            } else if (liveTs.length === 1) {
                selectTournament(liveTs[0].id);
                setViewMode("tournament");
            } else if (liveTs.length > 1) {
                setViewMode("menu");
            } else if (openTables.length === 1) {
                selectTable(openTables[0].id);
                setViewMode("cash");
            } else if (openTables.length > 1) {
                setViewMode("menu");
            } else {
                setViewMode("menu");
            }
        } else {
            // Refresh posterior: si el torneo seleccionado ya no está en juego
            // (lo terminaron), deseleccionar y volver a menú. Se lee el REF, no
            // el closure: este callback puede venir de un render viejo.
            const selId = currentTournamentIdRef.current;
            if (selId && !liveTs.some(t => t.id === selId)) {
                selectTournament(null);
                setViewMode((v) => (v === "tournament" ? "menu" : v));
                // Bajar el confirm de Terminar si estaba abierto: sin esto la
                // bandera queda en true y el modal reaparecería solo al entrar
                // a OTRO torneo (el guard de activeTournament solo lo esconde).
                setShowEndTournamentModal(false);
                setEndAck(false);
            }
            // Si la mesa cash actual ya no esta abierta, ir a menu
            const tblId = currentTableIdRef.current;
            if (tblId && !openTables.some(t => t.id === tblId)) {
                selectTable(null);
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

  // Auto-refresh: el dealer puede sacar jugadores desde su link público; el
  // panel central debe reflejarlo sin recargar a mano. Pausa mientras hay un
  // modal abierto para no interrumpir una transacción en curso.
  useEffect(() => {
    if (isModalOpen) return;
    const id = setInterval(() => setRefreshKey(prev => prev + 1), 15000);
    return () => clearInterval(id);
  }, [isModalOpen]);

  // Al volver a la pestaña/ventana (tras dejarla quieta mucho rato, el navegador
  // suspende los timers), recargar de inmediato: equivale a refrescar la página
  // a mano, pero automático. Evita quedarse pegado en "Error al cargar ...".
  useEffect(() => {
    const onWake = () => { if (document.visibilityState === 'visible') setRefreshKey(prev => prev + 1); };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    return () => {
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, []);

  // 2. INICIAR MESA DE CASH (multi-mesa: pide nombre opcional y crea inmediatamente)
  const [pendingSessionOpen, setPendingSessionOpen] = useState(false);

  const handleStartSession = () => {
    setNewTableName("");
    setNewTableMaxPlayers(9);
    setShowNewTableModal(true);
  };

  // El usuario confirma el nombre y pasamos al modal de primer buy-in.
  // La mesa NO se crea hasta que se confirme el primer jugador.
  const handleConfirmTableName = () => {
    setPendingTableName(newTableName.trim() || null);
    setPendingMaxPlayers(newTableMaxPlayers);
    setShowNewTableModal(false);
    setPendingSessionOpen(true);
    setModalType("buyin");
    const label = newTableName.trim() ? newTableName.trim() : "Apertura de Mesa";
    setModalTitle(`Primer Jugador (${label})`);
    setIsModalOpen(true);
  };

  const handleSwitchTable = (tableId) => {
    selectTable(tableId);
    setViewMode("cash");
  };

  const handleSwitchTournament = (tournamentId) => {
    selectTournament(tournamentId);
    setViewMode("tournament");
  };

  // Objeto del torneo seleccionado, siempre fresco desde la lista (derivado).
  const activeTournament = liveTournaments.find(t => t.id === currentTournamentId) || null;

  // 3. INICIAR TORNEO
const handleCreateTournament = async (formData) => {
      try {
          // 1. Enviar al Backend
          const newTournament = await tournamentService.create(formData);

          // 2a. Programado: NO entra a la vista de torneo (no está en juego);
          // se suma a la lista de programados del menú.
          if (newTournament.status === "SCHEDULED") {
              setScheduledTournaments((prev) => [...prev, newTournament]);
          } else {
              // 2b. En juego: entrar directo al panel de control
              setLiveTournaments((prev) => [...prev, newTournament]);
              selectTournament(newTournament.id);
              setViewMode("tournament");
          }

          // 3. Cerrar Modal
          setIsModalOpen(false);
      } catch (error) {
          showNotice(error.response?.data?.detail || "No se pudo crear el torneo. Revisa los datos e inténtalo de nuevo.");
          console.error(error);
      }
  };

  const handleOpenScheduled = async (id) => {
      try {
          const opened = await tournamentService.openScheduled(id);
          setScheduledTournaments((prev) => prev.filter((t) => t.id !== id));
          setLiveTournaments((prev) => [...prev, opened]);
          selectTournament(opened.id);
          setViewMode("tournament");
      } catch (error) {
          showNotice(error.response?.data?.detail || "No se pudo abrir el torneo programado. Inténtalo de nuevo.");
      }
  };

  const confirmDeleteScheduled = async () => {
      const t = scheduledToDelete;
      if (!t || isDeletingScheduled) return;
      setIsDeletingScheduled(true);
      try {
          await tournamentService.deleteTournament(t.id);
          setScheduledTournaments((prev) => prev.filter((x) => x.id !== t.id));
          showNotice(`"${t.name}" eliminado de la agenda.`, "success");
      } catch (error) {
          showNotice(error.response?.data?.detail || "No se pudo eliminar el torneo programado.");
      } finally {
          setScheduledToDelete(null);
          setIsDeletingScheduled(false);
      }
  };

  // HANDLERS MODALES
  // Preselección desde la fila del jugador (atajo "actuar sobre Pedro"):
  // el form abre con el jugador ya elegido y el foco en el monto.
  const [modalPreselect, setModalPreselect] = useState(null);
  const handleOpenModal = (type, title, preselect = null) => {
    setModalPreselect(preselect);
    setModalType(type);
    setModalTitle(title);
    setIsModalOpen(true);
  };

  const handleTransactionSuccess = (info) => {
    setIsModalOpen(false);
    setPendingSessionOpen(false);
    setPendingTableName(null);
    // Si fue apertura de mesa nueva, entrar a esa mesa directamente (y
    // descartar polls en vuelo que aún no conocen la mesa recién creada)
    if (info && info.newSessionId) {
      selectTable(info.newSessionId);
      setViewMode("cash");
    }
    // Deshacer de un toque para el cobro recién hecho (patrón de torneo):
    // borra el tx por id — la corrección deja de ser "editar el historial".
    if (info && info.undo) {
      const { txId, label } = info.undo;
      showAppToast(label, "success", {
        label: "Deshacer",
        onClick: async () => {
          try {
            await api.delete(`/transactions/${txId}`);
            refresh();
            showAppToast("Movimiento deshecho");
          } catch (e) {
            showNotice(e.response?.data?.detail || "No se pudo deshacer. Un manager puede corregirlo desde el nombre del jugador.");
          }
        },
      });
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
      showNotice("No se pudo cargar la auditoría. Revisa la conexión e inténtalo de nuevo.");
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
          selectTable(null);
          setViewMode("menu");
        } else {
          selectTable(remaining[0].id);
        }
        setShowDeleteConfirm(false);
     } catch (error) {
        console.error(error);
        showNotice(error.response?.data?.detail || "No se pudo eliminar la mesa. Inténtalo de nuevo.");
     } finally {
        setIsDeletingSession(false);
     }
  };

  const handleEndTournament = async () => {
    setEndAck(false);
    setShowEndTournamentModal(true);
  };

  const confirmEndTournament = async () => {
    // Otro staff pudo terminar este torneo con el modal abierto (el polling
    // sigue vivo y lo deselecciona): sin esta guarda, TypeError.
    if (!activeTournament) { setShowEndTournamentModal(false); return; }
    setIsLoading(true);
    try {
      await tournamentService.endTournament(activeTournament.id);
      setLiveTournaments((prev) => prev.filter((t) => t.id !== activeTournament.id));
      selectTournament(null);
      setViewMode("menu");  // volver al dashboard principal, no a la mesa cash
      setShowEndTournamentModal(false);
      refresh();
    } catch (error) {
      console.error(error);
      showNotice("No se pudo terminar el torneo. Inténtalo de nuevo.");
    }finally {
            setIsLoading(false); // 🔓 2. Desactivar bloqueo
            setShowEndTournamentModal(false); // 3. Cerrar modal
        }
};

  if (loading) return <div className="text-white text-center p-10 animate-pulse">📡 Conectando con el sistema...</div>;

  return (
  <div className="max-w-4xl mx-auto p-4">
      {isLoading && <GlobalLoader />}

      {/* STRIP DE TORNEOS (multi-torneo, solo en torneo con >= 2 en juego) */}
      {viewMode === "tournament" && liveTournaments.length >= 2 && (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
          {liveTournaments.map(t => {
            const isActive = t.id === currentTournamentId;
            return (
              <button
                key={t.id}
                onClick={() => handleSwitchTournament(t.id)}
                className={`shrink-0 px-4 py-2 rounded-lg font-bold border transition-all text-left ${
                  isActive
                    ? 'bg-violet-600 text-white border-violet-500 shadow-lg shadow-violet-900/30'
                    : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700 hover:border-gray-600'
                }`}
              >
                <div className="flex items-center gap-2 text-sm uppercase tracking-wider">
                  <TrophyIcon className="w-4 h-4 shrink-0" />
                  <span>{t.name}</span>
                </div>
                <div className={`flex items-center gap-2 text-[10px] font-mono mt-1 ${isActive ? 'text-violet-100' : 'text-gray-500'}`}>
                  <span>{t.players?.length ?? 0} jug</span>
                  <span>· {t.status === 'RUNNING' ? 'en juego' : 'inscribiendo'}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* STRIP DE MESAS (multi-mesa, solo en cash con >= 2 mesas) */}
      {viewMode === "cash" && tables.length >= 2 && (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
          {tables.map(t => {
            const isActive = t.id === currentTableId;
            const duration = formatDuration(t.start_time);
            return (
              <button
                key={t.id}
                onClick={() => handleSwitchTable(t.id)}
                className={`shrink-0 px-4 py-2 rounded-lg font-bold border transition-all text-left ${
                  isActive
                    ? 'bg-emerald-600 text-white border-emerald-500 shadow-lg shadow-emerald-900/30'
                    : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700 hover:border-gray-600'
                }`}
              >
                <div className="flex items-center gap-2 text-sm uppercase tracking-wider">
                  <TableCellsIcon className="w-4 h-4 shrink-0" />
                  <span>{t.name || `Mesa #${t.id}`}</span>
                </div>
                <div className={`flex items-center gap-2 text-[10px] font-mono mt-1 ${isActive ? 'text-emerald-100' : 'text-gray-500'}`}>
                  <span>{t.players_count ?? 0} jug</span>
                  {duration && <><span>·</span><span>{duration}</span></>}
                </div>
              </button>
            );
          })}
          <button
            onClick={handleStartSession}
            className="shrink-0 px-4 py-3 rounded-lg font-bold text-sm uppercase tracking-wider border border-dashed border-gray-600 text-gray-400 hover:border-emerald-500/60 hover:text-emerald-400 hover:bg-emerald-500/5 transition-all"
          >
            + Nueva mesa
          </button>
        </div>
      )}

      {/* HEADER: BARRA DE ESTADO PRO (Dinámica según el modo) — compacto en movil */}
      <header className={`border-b-4 rounded-t-lg shadow-xl p-3 md:p-5 flex flex-col md:flex-row justify-between items-start md:items-center mb-4 md:mb-8 gap-3 md:gap-4 ${viewMode === 'tournament' ? 'bg-gray-900 border-violet-600' : 'bg-gray-800 border-emerald-600'}`}>
        
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
                   <div className="flex items-center gap-3 mt-1.5">
                       <div className="flex items-center gap-2">
                         <span className="relative flex h-2.5 w-2.5">
                           <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                           <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-violet-500"></span>
                         </span>
                         <span className="text-violet-500 text-xs font-bold uppercase tracking-[0.15em]">Torneo en Curso</span>
                       </div>
                       <span className="text-gray-600">·</span>
                       <span className="text-violet-300 text-xs font-bold tracking-wider">
                         {activeTournament.players?.length || 0} jugador{(activeTournament.players?.length || 0) === 1 ? '' : 'es'}
                       </span>
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
                <p className="text-gray-500 text-xs font-bold uppercase tracking-[0.15em] mt-1.5">Elige una opción</p>
              </div>
            </div>
          )}
        </div>

        {/* Reloj Digital — oculto en movil (el sistema ya muestra hora y ocupa mucho viewport) */}
        <div className="hidden md:flex items-center gap-3 bg-gray-900/60 px-6 py-3 rounded-lg border border-gray-700 shadow-inner md:w-auto md:justify-end">
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
            
            {/* VOLVER: fila mínima. El header de arriba ya muestra trofeo, nombre,
                estado y conteo del torneo — repetirlos aquí costaba media pantalla
                de celular antes de llegar al reloj. */}
            <div className="mb-4">
                <button
                    onClick={() => setViewMode("menu")}
                    className="flex items-center gap-2 px-4 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-all border border-gray-700 hover:border-gray-500 shadow-sm group"
                >
                    <ArrowLeftIcon className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                    <span className="text-xs font-bold uppercase tracking-wider">Menú</span>
                </button>
            </div>

            {/* RELOJ / NIVELES (T3). key: al cambiar de torneo (multi-torneo) el
                componente se remonta desde cero — sin key arrastraría el reloj,
                las mesas o los modales del torneo anterior. */}
            <TournamentClock key={activeTournament.id} tournament={activeTournament} />

            {/* MESAS DEL TORNEO (Fase 1a) */}
            <TournamentTables
                key={`tables-${activeTournament.id}`}
                tournament={activeTournament}
                refreshTrigger={refreshKey}
                onUpdate={refresh}
            />

            {/* TABLA DE JUGADORES */}
            <TournamentPlayerTable
                key={`players-${activeTournament.id}`}
                tournament={activeTournament}
                onUpdate={refresh}
                onFinalized={(data) => { setCeremony(data); refresh(); }}
            />

            {/* TERMINAR (destructivo): al FONDO, como "Cerrar Sesión" en cash.
                Terminar ≠ premiar — el paso feliz es "Repartir el pozo" arriba. */}
            <button
                onClick={handleEndTournament}
                className="w-full mt-6 bg-gray-800 hover:bg-red-900/60 text-red-300 font-bold py-3 rounded-xl border border-red-900/50 transition-colors text-xs uppercase tracking-widest flex items-center justify-center gap-2"
            >
                <TrashIcon className="w-4 h-4" />
                Terminar torneo (archivar sin repartir)
            </button>
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

           <div className="col-span-2 md:col-span-3 mt-2">
              <DealerPanel sessionId={activeSession?.id} publicToken={activeSession?.public_token} refreshTrigger={refreshKey} />
           </div>

           <div className="col-span-2 md:col-span-3 mt-2">
              <StatsPanel refreshTrigger={refreshKey} sessionId={activeSession?.id} />
              <PlayerTable
                onQuickAction={(t, pl) => handleOpenModal(t, t === 'buyin' ? `Entrada — ${pl.name}` : `Cobrar — ${pl.name}`, { id: pl.player_id, name: pl.name })}
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
                onClick={() => setShowCloseConfirm(true)}
              >
                🔒 Cerrar la mesa y repartir
              </button>
              
              <div className="pt-4 flex justify-center gap-6">
                 <button onClick={() => setViewMode("menu")} className="text-gray-600 hover:text-emerald-400 text-xs font-bold uppercase tracking-widest flex items-center gap-2 transition-colors">
                    <ArrowLeftIcon className="w-4 h-4" />
                    Volver al Menu
                 </button>
                 <button onClick={() => setShowLogoutConfirm(true)} className="text-gray-600 hover:text-red-400 text-xs font-bold uppercase tracking-widest flex items-center gap-2 transition-colors">
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
                   {tables.map(t => {
                     const duration = formatDuration(t.start_time);
                     const players = t.players_count ?? 0;
                     const buyin = t.total_buyin ?? 0;
                     return (
                       <button
                         key={t.id}
                         onClick={() => handleSwitchTable(t.id)}
                         className="group relative overflow-hidden w-full bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold py-3.5 px-6 rounded-xl shadow-[0_0_20px_rgba(16,185,129,0.3)] border-b-4 border-emerald-900 active:border-b-0 active:translate-y-1 transition-all duration-150 flex items-center justify-between gap-3 uppercase tracking-wider"
                       >
                         <div className="flex items-center gap-3 min-w-0">
                           <div className="bg-white/20 p-2 rounded-lg shrink-0"><TableCellsIcon className="w-5 h-5 text-white" /></div>
                           <div className="text-left min-w-0">
                             {t.name ? (
                               <>
                                 <span className="block text-[10px] text-emerald-100 font-medium tracking-widest">Mesa #{t.id}</span>
                                 <span className="block leading-none text-base truncate">{t.name}</span>
                               </>
                             ) : (
                               <span className="block leading-none text-base">Mesa #{t.id}</span>
                             )}
                             <div className="flex items-center gap-2 mt-1.5 text-[10px] font-mono text-emerald-100/80 normal-case tracking-normal">
                               <span>{players} jug</span>
                               {duration && <><span>·</span><span>{duration}</span></>}
                               {buyin > 0 && <><span>·</span><span>{formatMoney(buyin)}</span></>}
                             </div>
                           </div>
                         </div>
                         <ArrowRightIcon className="w-5 h-5 text-white/70 group-hover:text-white shrink-0" />
                       </button>
                     );
                   })}
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

               {/* Opción TORNEO (multi-torneo: un botón "Continuar" por torneo en juego) */}
               {liveTournaments.map((t) => (
                   <button
                     key={t.id}
                     onClick={() => handleSwitchTournament(t.id)}
                     className="group relative overflow-hidden w-full bg-violet-600 hover:bg-violet-500 text-white font-bold text-lg py-4 px-8 rounded-xl shadow-[0_0_20px_rgba(124,58,237,0.4)] border-b-4 border-violet-900 active:border-b-0 active:translate-y-1 transition-all duration-150 flex items-center justify-between gap-4 uppercase tracking-wider animate-pulse-slow"
                   >
                     <div className="flex items-center gap-4 min-w-0">
                       <div className="bg-white/20 p-2 rounded-lg shrink-0"><TrophyIcon className="w-6 h-6 text-white" /></div>
                       <div className="text-left min-w-0">
                          <span className="block text-xs text-violet-200 font-medium truncate">{t.name}</span>
                          <span className="block leading-none">Continuar Torneo</span>
                       </div>
                     </div>
                     <div className="flex items-center gap-1.5 bg-white/10 px-3 py-1.5 rounded-lg border border-white/20 shrink-0">
                       <UserGroupIcon className="w-4 h-4 text-white shrink-0" />
                       <span className="text-sm font-black font-mono">{t.players?.length || 0}</span>
                     </div>
                   </button>
               ))}
               {/* Crear torneo: siempre disponible (puede haber varios a la vez) */}
               <button
                 onClick={() => handleOpenModal("create-tournament", "")}
                 className={liveTournaments.length > 0
                   ? "w-full flex items-center justify-center gap-2 text-violet-300 hover:text-white py-3 rounded-xl border border-violet-500/30 hover:bg-violet-600/20 transition-all text-sm font-bold uppercase tracking-widest"
                   : "group relative overflow-hidden w-full bg-violet-700 hover:bg-violet-600 text-white font-bold text-lg py-4 px-8 rounded-xl shadow-[0_0_20px_rgba(124,58,237,0.3)] border-b-4 border-violet-900 active:border-b-0 active:translate-y-1 transition-all duration-150 flex items-center justify-center gap-4 uppercase tracking-wider"}
               >
                 {liveTournaments.length > 0 ? (
                   <><TrophyIcon className="w-4 h-4" /> Organizar otro torneo</>
                 ) : (
                   <>
                     <div className="bg-violet-900/30 p-2 rounded-lg"><TrophyIcon className="w-6 h-6 text-violet-200" /></div>
                     <div className="text-left"><span className="block text-xs text-violet-300 font-medium">Evento Especial</span><span className="block leading-none">Organizar Torneo</span></div>
                   </>
                 )}
               </button>

               {/* Torneos PROGRAMADOS (status SCHEDULED) */}
               {scheduledTournaments.length > 0 && (
                 <div className="w-full space-y-2 pt-1">
                   <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest px-1">📅 Programados</p>
                   {scheduledTournaments.map((t) => (
                     <div key={t.id} className="bg-gray-800/40 border border-violet-500/20 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
                       <div className="min-w-0">
                         <p className="text-white font-bold text-sm truncate">{t.name}</p>
                         <p className="text-violet-300/70 text-[11px]">
                           {t.scheduled_start ? new Date(t.scheduled_start).toLocaleString('es-CO', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Sin fecha'}
                         </p>
                       </div>
                       <div className="flex gap-1.5 shrink-0">
                         <button onClick={() => handleOpenScheduled(t.id)} className="text-[10px] font-bold uppercase px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors">Abrir</button>
                         <button onClick={() => setScheduledToDelete(t)} aria-label={`Eliminar ${t.name}`} className="text-xs font-bold uppercase px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors">Eliminar</button>
                       </div>
                     </div>
                   ))}
                 </div>
               )}

               <div className="h-px bg-gray-700 w-full my-2"></div>

               <button onClick={() => setShowLogoutConfirm(true)} className="w-full flex items-center justify-center gap-2 text-gray-500 hover:text-red-400 py-2 rounded-xl hover:bg-red-900/10 transition-all text-sm font-bold uppercase tracking-widest">
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
            preselectedPlayer={modalPreselect}
            onSuccess={handleTransactionSuccess}
            sessionId={pendingSessionOpen ? null : activeSession?.id}
            createSessionFirst={pendingSessionOpen}
            pendingTableName={pendingTableName}
            pendingMaxPlayers={pendingMaxPlayers}
          />
        )}
      </Modal>

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={executeDeleteSession}
        isDeleting={isDeletingSession}
        title="¿Eliminar Mesa Activa?"
        message={`${activeSession?.name || `Mesa #${activeSession?.id}`}: ${activeSession?.players_count ?? '?'} jugador${(activeSession?.players_count ?? 0) === 1 ? '' : 'es'} y ${formatMoney(activeSession?.total_buyin || 0)} en entradas.\nSe borra TODO su movimiento. Esto es irreversible.`}
      />

      <ConfirmModal
        isOpen={showCloseConfirm}
        onClose={() => setShowCloseConfirm(false)}
        onConfirm={() => {
          setShowCloseConfirm(false);
          handleOpenModal("close", "Cierre de Caja y Auditoría");
        }}
        title="¿Cerrar caja definitivamente?"
        message={`Vas a cerrar la ${activeSession?.name ? `"${activeSession.name}"` : `Sesión #${activeSession?.id}`} y aplicar la distribución de utilidades.\n\nAsegúrate de haber registrado todos los buy-ins, cashouts y propinas. Una vez cerrada no se puede modificar.`}
        confirmText="Sí, cerrar caja"
        loadingText="Cerrando..."
      />

      <ConfirmModal
        isOpen={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        onConfirm={() => {
          setShowLogoutConfirm(false);
          logout();
        }}
        title="¿Cerrar sesión del sistema?"
        message={`Vas a salir de RakeFlow. Las mesas y torneos abiertos seguirán activos para la próxima vez que entres.\n\n¿Confirmas?`}
        confirmText="Sí, salir"
        loadingText="Saliendo..."
      />

      {/* MODAL NUEVA MESA */}
      {showNewTableModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] backdrop-blur-md p-4 animate-fade-in" role="dialog" aria-modal="true" aria-label="Nueva mesa">
          <div className="bg-gray-900 rounded-2xl border border-emerald-500/30 shadow-2xl w-full max-w-sm max-h-[90vh] overflow-y-auto">
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
                <p className="text-xs text-gray-500 mt-2">Si lo dejas vacío se mostrará como "Mesa #ID". El siguiente paso registra el primer jugador.</p>
              </div>
              <div>
                <label className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-2 block">
                  Asientos de la mesa
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={2}
                    max={12}
                    value={newTableMaxPlayers}
                    onChange={(e) => setNewTableMaxPlayers(Math.max(2, Math.min(12, parseInt(e.target.value) || 9)))}
                    className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white text-center focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 focus:outline-none"
                  />
                  <span className="text-xs text-gray-500">Cupos para el link público (default 9).</span>
                </div>
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
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60] p-4 backdrop-blur-md animate-fade-in" role="dialog" aria-modal="true" aria-label="Auditoría rápida">
           {/* ... Contenido igual al que ya tenías ... */}
           <div className="bg-gray-900 rounded-xl max-w-sm w-full max-h-[90vh] overflow-y-auto border border-gray-700 shadow-2xl">
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
      {showEndTournamentModal && activeTournament && (() => {
        // Datos duros en el momento de más riesgo: el director debe VER qué
        // está a punto de archivar (activos + pozo sin repartir) antes del sí.
        const endActivos = (activeTournament.players || []).filter(p => p.status === 'ACTIVE').length;
        const endSinPremiar = !(activeTournament.players || []).some(p => (p.prize_collected || 0) > 0);
        const needsAck = endActivos > 0 && endSinPremiar;
        return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[70] backdrop-blur-sm p-4 animate-fade-in" role="dialog" aria-modal="true" aria-label="Terminar torneo">
         <div className="bg-gray-800 rounded-2xl border border-red-500/50 shadow-2xl w-full max-w-sm max-h-[90vh] overflow-y-auto p-6 text-center">
             <div className="bg-red-500/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                 <ExclamationTriangleIcon className="w-8 h-8 text-red-500" />
             </div>
             <h3 className="text-xl font-bold text-white mb-2">¿Terminar "{activeTournament.name}"?</h3>
             <p className="text-gray-400 mb-3 text-sm">
                 El torneo se archiva permanentemente. No se puede deshacer.
             </p>
             {endActivos > 0 && (
                 <p className="text-amber-300 text-sm font-bold mb-2">
                     Quedan {endActivos} jugador{endActivos === 1 ? '' : 'es'} activo{endActivos === 1 ? '' : 's'}.
                 </p>
             )}
             {endSinPremiar && (
                 <p className="text-red-300 text-sm mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                     El pozo <strong>no se ha repartido</strong>: se archiva sin premios.
                     Para premiar, usa "Repartir el pozo".
                 </p>
             )}
             {needsAck && (
                 <label className="flex items-start gap-2 text-left text-sm text-gray-300 mb-4 cursor-pointer select-none">
                     <input type="checkbox" checked={endAck} onChange={(e) => setEndAck(e.target.checked)}
                         className="mt-0.5 w-4 h-4 accent-red-500" />
                     Entiendo: se archiva sin repartir premios.
                 </label>
             )}
             <div className="flex gap-3">
                 <button
                     onClick={() => setShowEndTournamentModal(false)}
                     className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-bold"
                 >
                     Cancelar
                 </button>
                 <button
                     onClick={confirmEndTournament}
                     disabled={isLoading || (needsAck && !endAck)}
                     className="flex-1 py-3 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl font-bold shadow-lg shadow-red-900/30"
                 >
                     Sí, terminar
                 </button>
             </div>
         </div>
    </div>
        );
      })()}

      {ceremony && (
        <TournamentCeremony ceremony={ceremony} onClose={() => { setCeremony(null); refresh(); }} />
      )}

      <Toast toast={toast} onDismiss={dismissToast} />

      <ConfirmModal
        isOpen={!!scheduledToDelete}
        onClose={() => setScheduledToDelete(null)}
        onConfirm={confirmDeleteScheduled}
        title="Eliminar torneo programado"
        message={scheduledToDelete ? `"${scheduledToDelete.name}" se eliminará de la agenda. Esta acción no se puede deshacer.` : ''}
        confirmText="Sí, eliminar"
        isDeleting={isDeletingScheduled}
      />

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
// CEREMONIA DE PREMIOS: el clímax de la noche merece más que un toast de 3s.
// Vive en GameControl (no en TournamentPlayerTable) para sobrevivir a que el
// torneo finalizado salga de la lista de vivos. Un solo momento de motion:
// la ráfaga de confetti al montar (mismo lenguaje que los logros del panel).
function TournamentCeremony({ ceremony, onClose }) {
  // Compartir el podio como IMAGEN (mismo mecanismo que las tarjetas-trofeo del
  // panel del jugador): Web Share nativo → WhatsApp; fallback descarga el PNG.
  const podiumRef = useRef(null);
  const [shareState, setShareState] = useState(null); // null|'sharing'|'shared'|'downloaded'|'error'
  // Escape apagado mientras se genera la imagen: cerrar a mitad de captura
  // descargaba el PNG "fantasma" con la ceremonia ya cerrada (y la ceremonia
  // es de un solo tiro). Convención del propio useEscape.
  useEscape(onClose, shareState !== 'sharing');
  const shareText = `🏆 ${ceremony.tournamentName}: así quedó el podio. ¡Nos vemos en el próximo torneo!`;
  const fileSlug = (ceremony.tournamentName || 'torneo').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'torneo';
  const sharePodium = async () => {
    if (shareState === 'sharing') return;
    setShareState('sharing');
    try {
      const result = await shareCardImage(podiumRef.current, {
        shareText,
        fileName: `podio-${fileSlug}.png`,
      });
      setShareState(result);
    } catch (e) {
      if (e?.name === 'AbortError') { setShareState(null); return; }
      console.error(e);
      setShareState('error');
    }
  };
  useEffect(() => {
    const bursts = [
      setTimeout(() => confetti({ particleCount: 120, spread: 75, origin: { y: 0.7 } }), 150),
      setTimeout(() => confetti({ particleCount: 60, angle: 60, spread: 55, origin: { x: 0, y: 0.8 } }), 500),
      setTimeout(() => confetti({ particleCount: 60, angle: 120, spread: 55, origin: { x: 1, y: 0.8 } }), 700),
    ];
    return () => bursts.forEach(clearTimeout);
  }, []);

  // Badges de rango dibujados (nada de emoji): oro/plata/bronce por borde+texto.
  const rankStyle = (rank) => rank === 1
    ? 'border-yellow-400/70 text-yellow-300 bg-yellow-500/10'
    : rank === 2
    ? 'border-gray-300/50 text-gray-200 bg-gray-400/10'
    : rank === 3
    ? 'border-orange-400/50 text-orange-300 bg-orange-500/10'
    : 'border-violet-500/40 text-violet-300 bg-violet-500/10';
  return (
    <div className="fixed inset-0 z-[120] bg-gray-950/95 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in" role="dialog" aria-modal="true" aria-label="Ceremonia de premios">
      <div className="w-full max-w-sm border border-yellow-500/30 rounded-3xl shadow-2xl shadow-violet-900/40 max-h-[90vh] overflow-y-auto overflow-x-hidden">
        {/* Lo que viaja en la imagen: el ref envuelve SOLO el podio (los botones
            quedan fuera del PNG). Fondo sólido propio para la captura. */}
        <div ref={podiumRef} className="bg-gradient-to-b from-violet-950 to-gray-900 p-6 text-center">
          <div className="bg-yellow-500/15 border border-yellow-500/30 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
            <TrophyIcon className="w-11 h-11 text-yellow-400" />
          </div>
          <h2 className="text-white text-2xl font-black uppercase leading-tight">{ceremony.tournamentName}</h2>
          <p className="text-violet-200 text-sm mt-1 mb-5">Pozo repartido: <span className="font-mono font-bold text-yellow-300">{ceremony.potLabel}</span></p>

          <div className="space-y-2">
            {ceremony.winners.map((w) => (
              <div key={w.rank}
                className={`flex items-center justify-between gap-3 rounded-xl px-4 ${w.rank === 1
                  ? 'bg-yellow-500/15 border border-yellow-500/40 py-4'
                  : 'bg-gray-800/70 border border-gray-700 py-2.5'}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`shrink-0 w-8 h-8 rounded-full border-2 flex items-center justify-center font-black font-mono ${w.rank === 1 ? 'text-base' : 'text-sm'} ${rankStyle(w.rank)}`}>{w.rank}</span>
                  <span className={`truncate font-bold ${w.rank === 1 ? 'text-yellow-100 text-lg' : 'text-gray-200 text-sm'}`}>{w.name}</span>
                </div>
                <span className={`font-mono font-black shrink-0 ${w.rank === 1 ? 'text-yellow-300 text-lg' : 'text-violet-200 text-sm'}`}>{w.prizeLabel}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[10px] font-bold uppercase tracking-widest text-violet-300/70">rakeflow.site</p>
        </div>

        <div className="bg-gray-900 p-6 pt-4 space-y-2.5">
          <button onClick={sharePodium} disabled={shareState === 'sharing'}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-black uppercase tracking-wider py-3.5 rounded-xl shadow-lg shadow-emerald-900/30 transition-colors flex items-center justify-center gap-2">
            <ShareIcon className="w-4 h-4" />
            {shareState === 'sharing' ? 'Generando imagen…'
              : shareState === 'shared' ? '✓ Compartido'
              : shareState === 'downloaded' ? 'Imagen descargada'
              : shareState === 'error' ? 'No se pudo — reintentar'
              : 'Compartir podio'}
          </button>
          {shareState === 'downloaded' && (
            <p className="text-xs text-gray-400 text-center">
              Imagen descargada — adjúntala en tu chat.{' '}
              <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer" className="text-emerald-400 font-bold underline">Abrir WhatsApp</a>
            </p>
          )}
          <button onClick={onClose}
            className="w-full bg-violet-600 hover:bg-violet-500 text-white font-black uppercase tracking-wider py-3.5 rounded-xl shadow-lg shadow-violet-900/40 transition-colors">
            Cerrar la noche
          </button>
        </div>
      </div>
    </div>
  );
}
