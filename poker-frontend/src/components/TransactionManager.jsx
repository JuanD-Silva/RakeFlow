// src/components/TransactionManager.jsx
import { useState, useEffect } from 'react';
import api from '../api/axios';
import { 
  PencilSquareIcon, 
  TrashIcon, 
  CheckIcon, 
  XMarkIcon, 
  ExclamationTriangleIcon 
} from '@heroicons/react/24/outline';

export default function TransactionManager({ player, onClose, onUpdate }) {
  // 1. ESTADO LOCAL: Copiamos las transacciones para manipularlas al instante
  const [localTransactions, setLocalTransactions] = useState([]);
  
  // Estados de edición
  const [editingId, setEditingId] = useState(null);
  const [editAmount, setEditAmount] = useState("");
  
  // Estados de eliminación
  const [deleteConfirmId, setDeleteConfirmId] = useState(null); // Para mostrar "¿Seguro?"

  // Estados de feedback (Mensajes de éxito)
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState(null); // { type: 'success'|'error', msg: '' }

  // Cargar datos iniciales
  useEffect(() => {
    if (player && player.transactions) {
      setLocalTransactions(player.transactions);
    }
  }, [player]);

  // Helper para mostrar notificaciones temporales
  const showNotification = (msg, type = 'success') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3000); // Se borra a los 3 segundos
  };

  const typeMap = {
    'BUYIN': 'Compra', 'REBUY': 'Recompra', 'CASHOUT': 'Cobro',
    'SPEND': 'Gasto', 'TIP': 'Propina', 'JACKPOT_PAYOUT': 'Jackpot', 'BONUS': 'Bono'
  };

  // 💾 GUARDAR EDICIÓN
  const handleSave = async (txId) => {
    if (!editAmount || isNaN(editAmount)) return;
    setLoading(true);
    try {
      // 1. Llamada al Backend
      await api.put(`/transactions/${txId}`, { amount: parseFloat(editAmount), method: "CASH" });
      
      // 2. Actualizar UI Localmente (Inmediato)
      const updatedList = localTransactions.map(tx => 
        tx.id === txId ? { ...tx, amount: parseFloat(editAmount) } : tx
      );
      setLocalTransactions(updatedList);
      
      // 3. Feedback y Limpieza
      showNotification("Transacción actualizada correctamente");
      setEditingId(null);
      
      // 4. Avisar al padre para que recalcule totales globales
      onUpdate(); 

    } catch (error) {
      console.error("Error editando", error);
      showNotification("Error al guardar cambios", "error");
    } finally {
      setLoading(false);
    }
  };

  // 🗑️ ELIMINAR TRANSACCIÓN
  const handleDelete = async (txId) => {
    setLoading(true);
    try {
      // 1. Llamada al Backend
      await api.delete(`/transactions/${txId}`);
      
      // 2. Actualizar UI Localmente (Filtrar la borrada)
      const updatedList = localTransactions.filter(tx => tx.id !== txId);
      setLocalTransactions(updatedList);

      // 3. Feedback
      showNotification("Transacción eliminada del sistema");
      setDeleteConfirmId(null);
      
      // 4. Avisar al padre
      onUpdate();

    } catch (error) {
      console.error("Error borrando", error);
      showNotification("No se pudo eliminar", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-gray-900 border border-gray-700 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden relative flex flex-col max-h-[90vh]">
        
        {/* NOTIFICACIÓN FLOTANTE */}
        {notification && (
          <div className={`absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg shadow-lg text-sm font-bold z-20 flex items-center gap-2 animate-bounce-in ${
            notification.type === 'error' ? 'bg-red-500 text-white' : 'bg-emerald-500 text-white'
          }`}>
            {notification.type === 'success' && <CheckIcon className="w-4 h-4" />}
            {notification.msg}
          </div>
        )}

        {/* HEADER */}
        <div className="bg-gray-800 p-4 flex justify-between items-center border-b border-gray-700 shrink-0">
          <div>
            <h3 className="text-white font-bold text-lg">Historial de Movimientos</h3>
            <p className="text-blue-400 text-sm font-mono">{player.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600 p-2 rounded-full transition">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* LISTA DE TRANSACCIONES (Scrollable) */}
        <div className="overflow-y-auto p-4 space-y-3 flex-1">
          {localTransactions.length > 0 ? (
            localTransactions.map((tx) => (
              <div key={tx.id} className={`flex flex-col bg-gray-800/50 p-3 rounded-lg border transition-colors ${
                deleteConfirmId === tx.id ? 'border-red-500 bg-red-900/10' : 'border-gray-700 hover:border-blue-500/30'
              }`}>
                
                {/* FILA SUPERIOR: INFO + VALOR */}
                <div className="flex items-center justify-between">
                  {/* IZQUIERDA: Info Tipo */}
                  <div className="flex flex-col">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded w-fit mb-1 ${
                      tx.type === 'CASHOUT' ? 'bg-green-500/20 text-green-400' : 
                      tx.type === 'SPEND' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'
                    }`}>
                      {typeMap[tx.type] || tx.type}
                    </span>
                    <span className="text-xs text-gray-500 font-mono">
                      {new Date(tx.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </span>
                  </div>

                  {/* CENTRO: Edición o Valor */}
                  <div className="flex-1 mx-4 text-right">
                    {editingId === tx.id ? (
                      <input 
                        type="number" 
                        autoFocus
                        className="w-full bg-gray-900 border border-blue-500 text-white text-right px-2 py-1 rounded font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={editAmount}
                        onChange={(e) => setEditAmount(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSave(tx.id)}
                      />
                    ) : (
                      <span className="text-white font-mono font-bold text-lg">
                        ${tx.amount.toLocaleString()}
                      </span>
                    )}
                  </div>

                  {/* DERECHA: Botones de Acción */}
                  <div className="flex items-center gap-2">
                    {editingId === tx.id ? (
                      // MODO EDICIÓN ACTIVADO
                      <>
                        <button onClick={() => handleSave(tx.id)} disabled={loading} className="text-green-400 hover:bg-green-500/20 p-2 rounded transition">
                          <CheckIcon className="w-5 h-5" />
                        </button>
                        <button onClick={() => setEditingId(null)} className="text-gray-400 hover:bg-gray-700 p-2 rounded transition">
                          <XMarkIcon className="w-5 h-5" />
                        </button>
                      </>
                    ) : deleteConfirmId === tx.id ? (
                      // MODO BORRADO NO VISIBLE AQUÍ (Se maneja abajo)
                      <button onClick={() => setDeleteConfirmId(null)} className="text-gray-400 hover:text-white p-2">
                         <XMarkIcon className="w-5 h-5" />
                      </button>
                    ) : (
                      // MODO NORMAL
                      <>
                        <button 
                          onClick={() => { setEditingId(tx.id); setEditAmount(tx.amount); setDeleteConfirmId(null); }} 
                          className="text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 p-2 rounded transition"
                          title="Editar monto"
                        >
                          <PencilSquareIcon className="w-5 h-5" />
                        </button>
                        <button 
                           onClick={() => { setDeleteConfirmId(tx.id); setEditingId(null); }} 
                           className="text-gray-500 hover:text-red-400 hover:bg-red-500/10 p-2 rounded transition"
                           title="Eliminar movimiento"
                        >
                          <TrashIcon className="w-5 h-5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* ZONA DE CONFIRMACIÓN DE BORRADO (Se despliega abajo si se activa) */}
                {deleteConfirmId === tx.id && (
                  <div className="mt-3 pt-3 border-t border-red-500/30 flex items-center justify-between animate-fade-in">
                    <div className="flex items-center gap-2 text-red-400 text-xs font-bold uppercase">
                      <ExclamationTriangleIcon className="w-4 h-4" />
                      ¿Eliminar este movimiento?
                    </div>
                    <button 
                      onClick={() => handleDelete(tx.id)}
                      disabled={loading}
                      className="bg-red-600 hover:bg-red-500 text-white text-xs font-bold px-3 py-1.5 rounded shadow transition-colors flex items-center gap-1"
                    >
                      {loading ? 'Borrando...' : 'SÍ, BORRAR'}
                    </button>
                  </div>
                )}

              </div>
            ))
          ) : (
            <div className="text-center py-10 opacity-50 flex flex-col items-center">
              <PencilSquareIcon className="w-12 h-12 text-gray-600 mb-2" />
              <p className="text-gray-400 text-sm">No hay movimientos registrados.</p>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div className="bg-gray-800 p-4 border-t border-gray-700 shrink-0 text-center">
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xs uppercase tracking-widest font-bold">
            Cerrar Ventana
          </button>
        </div>

      </div>
    </div>
  );
}