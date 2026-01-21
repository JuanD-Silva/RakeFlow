import { useState, useEffect } from 'react';
// 👇 1. Importamos solo los servicios, no axios directo
import { sessionService } from '../api/services'; 

import Modal from './Modal';
import TransactionForm from './TransactionForm';
import CloseSessionForm from './CloseSessionForm';
import StatsPanel from './StatsPanel';
import PlayerTable from './PlayerTable';

import { 
  PlayIcon, 
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
  ArrowRightOnRectangleIcon
} from '@heroicons/react/24/solid';

export default function GameControl({ onLogout }) {
  const [activeSession, setActiveSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0); 

  // ESTADOS DEL MODAL
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState("buyin"); 
  const [modalTitle, setModalTitle] = useState("");
  
  // ESTADOS DE AUDITORÍA
  const [auditData, setAuditData] = useState(null);
  const [showAuditModal, setShowAuditModal] = useState(false);

  // 1. CARGAR SESIÓN ACTIVA (Usando el Servicio)
  useEffect(() => {
    const checkSession = async () => {
      try {
        // 👇 Delegamos la lógica de búsqueda al servicio
        const session = await sessionService.findOpenSession();
        setActiveSession(session);
      } catch (error) {
        console.error("Error conectando con el backend:", error);
      } finally {
        setLoading(false);
      }
    };
    checkSession();
  }, [refreshKey]);

  const refresh = () => setRefreshKey(prev => prev + 1);

  // 2. NUEVA FUNCIÓN: ABRIR SESIÓN
  // Esto crea la mesa en el backend antes de permitir buy-ins
const handleStartSession = async () => {
    // A. Mostrar estado de carga (para evitar clicks dobles)
    setLoading(true); 
    
    try {
      // B. Crear la sesión y ESPERAR la respuesta con los datos
      const newSession = await sessionService.createSession();
      
      // C. ACTUALIZACIÓN MANUAL (Evita el parpadeo de recarga)
      // En lugar de llamar a refresh(), seteamos la sesión directamente.
      setActiveSession(newSession);
      
      // D. Abrir Modal de Buy-in INMEDIATAMENTE
      // Al no depender de un useEffect, esto es instantáneo y garantizado.
      setModalType("buyin");
      setModalTitle("🚀 Primer Jugador (Apertura de Mesa)");
      setIsModalOpen(true);

    } catch (error) {
      alert("Error al abrir la mesa. Revisa la consola.");
      console.error(error);
    } finally {
      // E. Quitar carga. Ahora verás la mesa de fondo y el modal encima.
      setLoading(false);
    }
  };

  // HANDLERS MODALES
  const handleOpenModal = (type, title) => {
    setModalType(type);
    setModalTitle(title);
    setIsModalOpen(true);
  };

  const handleTransactionSuccess = () => {
    setIsModalOpen(false);
    refresh(); 
  };

  // 3. FUNCIÓN AUDITAR (Usando Servicio)
  const handleAudit = async () => {
    try {
      const data = await sessionService.getAuditData();
      setAuditData(data);
      setShowAuditModal(true);
    } catch (error) {
      console.error("Error auditar:", error);
      alert("No se pudo auditar. Verifica que la sesión esté activa.");
    }
  };

  if (loading) return <div className="text-white text-center p-10 animate-pulse">📡 Conectando con el sistema...</div>;

  return (
    <div className="max-w-4xl mx-auto p-4">
      
 {/* HEADER: BARRA DE ESTADO PRO */}
      <header className="bg-gray-800 border-b-4 border-emerald-600 rounded-t-lg shadow-xl p-5 flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        
        <div className="flex items-center gap-4 w-full md:w-auto">
          {activeSession ? (
            <div className="flex items-center gap-4">
              {/* Icono de Mesa Activa */}
              <div className="bg-emerald-900/30 p-3 rounded-xl border border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                  <TableCellsIcon className="w-8 h-8 text-emerald-400" />
              </div>
              
              {/* Texto de Estado */}
              <div>
                  <h1 className="text-white font-black text-xl tracking-tight uppercase leading-none">
                    Mesa Principal <span className="text-gray-500 font-medium text-lg">#{activeSession.id}</span>
                  </h1>
                  <div className="flex items-center gap-2 mt-1.5">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                      </span>
                      <span className="text-emerald-500 text-xs font-bold uppercase tracking-[0.15em]">Sistema Online</span>
                  </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4 opacity-60">
              {/* Icono de Mesa Cerrada */}
              <div className="bg-gray-700/30 p-3 rounded-xl border border-gray-600">
                  <LockClosedIcon className="w-8 h-8 text-gray-400" />
              </div>
              
              {/* Texto de Estado */}
              <div>
                <h1 className="text-gray-300 font-black text-xl tracking-tight uppercase leading-none">Mesa Cerrada</h1>
                <p className="text-gray-500 text-xs font-bold uppercase tracking-[0.15em] mt-1.5">Esperando Apertura</p>
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
      {/* ZONA PRINCIPAL */}
{!activeSession ? (
        // --- VISTA MESA CERRADA (Estilo Casino Pro) ---
        <div className="flex flex-col items-center justify-center py-20 bg-gray-800/30 rounded-2xl border-2 border-dashed border-gray-700/50 backdrop-blur-sm">
          
          {/* Icono Central con efecto sutil */}
          <div className="group relative mb-8">
             <div className="absolute inset-0 bg-emerald-500/20 rounded-full blur-xl group-hover:bg-emerald-500/30 transition-all duration-500"></div>
             <div className="relative w-24 h-24 bg-gray-900 rounded-full flex items-center justify-center shadow-2xl border border-gray-700 group-hover:border-emerald-500/50 transition-colors">
                <span className="text-5xl grayscale group-hover:grayscale-0 transition-all duration-300">♠️</span>
             </div>
          </div>

          <h2 className="text-3xl text-white font-bold uppercase tracking-widest mb-3 text-center">
            Sala de Poker Inactiva
          </h2>
          
          <p className="text-gray-500 mb-10 text-center max-w-md font-medium">
            El sistema de control de caja está en espera. <br/>
            Inicie una nueva sesión para habilitar las transacciones.
          </p>

          {/* Botón Principal (Estilo Placa/Ficha) */}
          <button 
            onClick={handleStartSession} 
            className="
              group relative overflow-hidden
              bg-emerald-700 hover:bg-emerald-600 
              text-white font-bold text-lg
              py-5 px-12 rounded-lg 
              shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)]
              border-b-4 border-emerald-900 active:border-b-0 active:translate-y-1
              transition-all duration-150
              flex items-center gap-3 uppercase tracking-wider
            "
          >
            {/* Brillo al pasar el mouse */}
            <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-in-out"></div>
            
            <PlayIcon className="w-6 h-6 text-emerald-200" />
            <span>Iniciar Nueva Sesión</span>
          </button>
          <button 
               onClick={onLogout}
               className="w-full flex items-center justify-center gap-2 text-gray-500 hover:text-red-400 py-3 rounded-xl hover:bg-red-900/10 border border-transparent hover:border-red-900/30 transition-all"
            >
               <ArrowRightOnRectangleIcon className="w-5 h-5" />
               <span className="font-bold text-sm uppercase tracking-widest">Cerrar Sistema</span>
            </button>

        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 animate-fade-in-up">
           {/* BOTONES DE ACCIÓN */}
          <ActionButton color="green" label="💰 Buy-in / Rebuy" onClick={() => handleOpenModal("buyin", "Registrar Entrada")} />
          <ActionButton color="red" label="💸 Cashout" onClick={() => handleOpenModal("cashout", "Registrar Salida")} />
          <ActionButton color="orange" label="🎁 Bono / Promo" onClick={() => handleOpenModal("bonus", "Otorgar Bono")} />
          <ActionButton color="blue" label="🍺 Bebida/Gasto" onClick={() => handleOpenModal("spend", "Registrar Gasto")} />
          <ActionButton color="purple" label="🎁 Jackpot Payout" onClick={() => handleOpenModal("jackpot-payout", "Pagar Premio Jackpot")} />
          <ActionButton color="yellow" label="🤝 Propina Dealer" onClick={() => handleOpenModal("tip", "Registrar Propina")} />     

          {/* TABLAS Y PANELES */}
          <div className="col-span-2 md:col-span-3 mt-4">
             <StatsPanel refreshTrigger={refreshKey} />
             <PlayerTable refreshTrigger={refreshKey} />
          </div>

          {/* ZONA DE CIERRE */}
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
             <div className="pt-4 flex justify-center">
                <button 
                   onClick={onLogout}
                   className="text-gray-600 hover:text-red-400 text-xs font-bold uppercase tracking-widest flex items-center gap-2 transition-colors"
                >
                   <ArrowRightOnRectangleIcon className="w-4 h-4" />
                   Salir del Sistema
                </button>
            </div>
          </div>
        </div>
      )}

      {/* MODALES */}
      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        title={modalTitle}
      >
        {modalType === "close" ? (
          <CloseSessionForm 
            sessionId={activeSession?.id} 
            onSuccess={handleTransactionSuccess} 
          />
        ) : (
          <TransactionForm 
            type={modalType} 
            onSuccess={handleTransactionSuccess}
            sessionId={activeSession?.id} 
          />
        )}
      </Modal>

      {/* MODAL DE AUDITORÍA (Solo lectura) */}
      {showAuditModal && auditData && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60] p-4 backdrop-blur-md animate-fade-in">
          <div className="bg-gray-900 rounded-xl max-w-sm w-full border border-gray-700 shadow-2xl overflow-hidden transform transition-all scale-100">
            
            <div className="bg-gray-800 p-4 border-b border-gray-700 flex justify-between items-center">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">📑 Auditoría Rápida</h3>
              <button onClick={() => setShowAuditModal(false)} className="text-gray-400 hover:text-white font-bold text-xl">&times;</button>
            </div>

            <div className="p-6 space-y-4">
              <div className="space-y-3 text-sm">
                <div className="flex justify-between text-green-400 border-b border-gray-800 pb-2">
                  <span>(+) Total Buy-ins:</span>
                  <span className="font-mono font-bold text-base">${auditData.total_buyins.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-red-400">
                  <span>(-) Cashouts:</span>
                  <span className="font-mono font-bold">${auditData.total_cashouts.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-purple-400">
                  <span>(-) Jackpots:</span>
                  <span className="font-mono font-bold">${auditData.total_jackpot_payouts.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-yellow-500">
                  <span>(-) Propinas:</span>
                  <span className="font-mono font-bold">${auditData.total_tips.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-orange-400">
                  <span>(-) Gastos:</span>
                  <span className="font-mono font-bold">${auditData.total_expenses.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-orange-500 font-bold border-t border-gray-800 pt-2">
      <span>🎁 Bonos Otorgados:</span>
      <span className="font-mono">${auditData.total_bonuses?.toLocaleString() || 0}</span>
    </div>
              </div>

              <hr className="border-gray-700" />

              <div className="bg-gray-800 p-4 rounded-lg text-center border border-gray-600 shadow-inner">
                <p className="text-gray-400 text-xs mb-1 uppercase tracking-wider font-semibold">Dinero Físico Esperado</p>
                <p className="text-3xl font-mono font-bold text-white tracking-tight">
                  ${auditData.expected_cash_in_box.toLocaleString()}
                </p>
              </div>
            </div>

            <div className="p-4 bg-gray-800 border-t border-gray-700">
              <button 
                onClick={() => setShowAuditModal(false)}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-4 rounded-lg transition-colors shadow-lg"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
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
    <button 
      onClick={onClick}
      className={`${colors[color]} text-white font-bold py-6 px-4 rounded-xl shadow-lg border-b-4 active:border-b-0 active:translate-y-1 active:shadow-none transition-all cursor-pointer text-lg flex flex-col items-center justify-center gap-1`}
    >
      {label}
    </button>
  );
}