import { useState } from 'react';
import { sessionService } from '../api/services';

export default function CloseSessionForm({ sessionId, onSuccess }) {
  // Estados del formulario
  const [declaredRake, setDeclaredRake] = useState("");
  const [declaredJackpot, setDeclaredJackpot] = useState(""); 
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Estados para controlar el flujo visual
  const [auditMismatch, setAuditMismatch] = useState(null); // Alerta Roja
  const [isSuccess, setIsSuccess] = useState(false);        // Factura Verde
  const [closureReport, setClosureReport] = useState(null); // Datos finales

  // Helper para formato de moneda colombiana
  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount || 0);
  };

  const handleSubmit = async (e, force = false) => {
    e.preventDefault();
    
    // Resetear alertas si no es un forzado
    setError(null);
    if (!force) setAuditMismatch(null);
    
    setLoading(true);

    try {
      const rakeVal = parseFloat(declaredRake) || 0;
      const jackpotVal = parseFloat(declaredJackpot) || 0;

      // Llamada limpia al servicio
      const result = await sessionService.closeSession(sessionId, rakeVal, jackpotVal, force);
      
      // Si llegamos aquí, es un ÉXITO (200 OK)
      setClosureReport(result);
      setIsSuccess(true); 

    } catch (err) {
      console.error("Error cerrando sesión:", err);

      // Si el backend dice 409, mostramos la pantalla de Descuadre
      if (err.response && err.response.status === 409) {
        setAuditMismatch(err.response.data); 
      } else {
        // Otros errores (conexión, 500, etc)
        const msg = err.response?.data?.detail || err.message || "Error desconocido";
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------
  // 1. PANTALLA DE ÉXITO (FACTURA VERDE) 🏆
  // ---------------------------------------------------
  if (isSuccess && closureReport) {
    return (
      <div className="text-center animate-fade-in space-y-6">
        <div className="flex justify-center mb-4">
          <div className="bg-green-500/20 p-3 rounded-full border-2 border-green-500">
            <span className="text-4xl">✅</span>
          </div>
        </div>
        
        <h2 className="text-xl font-bold text-white">¡Sesión Cerrada!</h2>
        <p className="text-gray-400 text-sm">Distribución de Ganancias:</p>

        {/* FACTURA */}
        <div className="bg-gray-800 rounded-xl p-5 border border-gray-600 shadow-xl text-sm space-y-3">
          
          {/* RAKE */}
          <div className="flex justify-between items-center border-b border-gray-700 pb-2">
            <span className="text-gray-400">Total Rake (Ingreso):</span>
            <span className="text-white font-mono font-bold text-lg">
              {formatMoney(closureReport.declared_rake_cash)}
            </span>
          </div>

          {/* DEUDA */}
          <div className="flex justify-between items-center text-yellow-500">
            <span>(-) Abono a Deuda/Fijos:</span>
            <span className="font-mono">
              {formatMoney(closureReport.debt_payment)}
            </span>
          </div>

          {/* JACKPOT */}
          {closureReport.declared_jackpot_cash > 0 && (
             <div className="flex justify-between items-center text-purple-400">
               <span>(-) Jackpot Apartado:</span>
               <span className="font-mono">
                 {formatMoney(closureReport.declared_jackpot_cash)}
               </span>
             </div>
          )}

          <div className="border-t border-gray-600 pt-2"></div>

          {/* UTILIDAD SOCIOS */}
          <div className="flex justify-between items-center bg-green-900/30 p-3 rounded-lg border border-green-500/30">
            <span className="text-green-400 font-bold uppercase text-xs tracking-wider">
              (=) Utilidad Neta (Socios)
            </span>
            <span className="text-green-400 font-mono font-bold text-xl">
              {formatMoney(closureReport.partner_profit)}
            </span>
          </div>

        <div className="pt-4 space-y-3">
  <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">
    Distribución Individual
  </p>
  <div className="grid grid-cols-2 gap-2">
    {closureReport.distributions && closureReport.distributions.length > 0 ? (
      closureReport.distributions.map((dist, i) => (
        <div key={i} className="bg-gray-900/40 border border-gray-700/50 p-2 rounded-lg flex justify-between items-center">
          <div className="text-left">
            <p className="text-[9px] text-gray-400 font-bold uppercase leading-none mb-1">{dist.name}</p>
            <p className="text-[8px] text-blue-500 font-mono">
              {dist.percentage_applied > 0 ? `${(dist.percentage_applied * 100).toFixed(0)}%` : 'Fijo'}
            </p>
          </div>
          <span className="text-white font-mono font-bold text-xs">
            {formatMoney(dist.amount)}
          </span>
        </div>
      ))
    ) : (
      <p className="col-span-2 text-[10px] text-gray-600 italic">No se generaron reparticiones individuales</p>
    )}
  </div>
</div>

          
        </div>

        <button
          onClick={onSuccess} 
          className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-8 rounded-lg shadow-lg transition-transform transform hover:scale-105"
        >
          Finalizar y Salir
        </button>
      </div>
    );
  }

  // ---------------------------------------------------
  // 2. PANTALLA DE DESCUADRE (ALERTA ROJA) ⚠️
  // ---------------------------------------------------
  if (auditMismatch) {
    return (
      <div className="space-y-5 animate-fade-in">
        <div className="bg-red-900/20 border-l-4 border-red-500 p-4 rounded-r">
          <div className="flex items-center gap-2">
            <span className="text-2xl">⚠️</span>
            <h3 className="text-red-400 font-bold uppercase tracking-wider">¡Descuadre Detectado!</h3>
          </div>
          <p className="text-gray-300 text-xs mt-2">
            El dinero declarado no coincide con el sistema.
          </p>
        </div>

        <div className="bg-gray-800 rounded p-4 text-sm font-mono border border-gray-700">
          <div className="flex justify-between border-b border-gray-700 pb-2 mb-2">
            <span className="text-gray-400">Sistema espera:</span>
            <span className="text-green-400 font-bold text-lg">$ {auditMismatch.expected?.toLocaleString()}</span>
          </div>
          <div className="flex justify-between border-b border-gray-700 pb-2 mb-2">
            <span className="text-gray-400">Tú declaraste:</span>
            <span className="text-yellow-400 font-bold text-lg">$ {auditMismatch.declared?.toLocaleString()}</span>
          </div>
          <div className="flex justify-between pt-1">
            <span className="text-red-400 font-bold">Diferencia:</span>
            <span className="text-red-400 font-bold">
              {auditMismatch.difference > 0 ? "+" : ""}
              $ {auditMismatch.difference?.toLocaleString()}
            </span>
          </div>
        </div>

        <div className="flex gap-3 mt-4">
          <button
            type="button"
            onClick={() => {
               setAuditMismatch(null);
               setError(null);
            }} 
            className="flex-1 bg-gray-600 hover:bg-gray-500 text-white py-3 rounded-lg font-bold transition-colors"
          >
            🔙 Corregir
          </button>
          
          <button
            type="button"
            onClick={(e) => handleSubmit(e, true)} 
            className="flex-1 bg-red-600 hover:bg-red-500 text-white py-3 rounded-lg font-bold shadow-lg shadow-red-900/50 transition-colors animate-pulse"
          >
            🚨 FORZAR CIERRE
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------
  // 3. FORMULARIO NORMAL (INPUTS) 📝
  // ---------------------------------------------------
  return (
    <form onSubmit={(e) => handleSubmit(e, false)} className="space-y-6">
      <div className="bg-blue-900/20 border border-blue-500/30 p-4 rounded-lg">
        <h3 className="text-blue-300 font-bold text-sm uppercase mb-2">Cierre de Caja</h3>
        <p className="text-gray-400 text-xs">
          Ingresa el dinero físico real (billetes) que tienes en la caja del Rake.
        </p>
      </div>

      {error && (
        <div className="bg-red-500/20 text-red-200 p-3 rounded text-sm text-center border border-red-500 animate-pulse">
          {error}
        </div>
      )}

      {/* RAKE CASH */}
      <div>
        <label className="block text-gray-400 text-sm font-bold mb-2">
          Dinero Rake (Ganancia Casa)
        </label>
        <div className="relative">
          <span className="absolute left-3 top-3 text-green-500 font-bold">$</span>
          <input
            type="number"
            value={declaredRake}
            onChange={(e) => setDeclaredRake(e.target.value)}
            className="w-full bg-gray-800 text-white border border-gray-600 rounded-lg p-3 pl-8 focus:outline-none focus:border-green-500 transition-colors font-mono text-xl"
            placeholder="Ej: 500000"
            required
            autoFocus
          />
        </div>
      </div>

      {/* JACKPOT CASH */}
      <div>
        <label className="block text-gray-400 text-sm font-bold mb-2">
          Dinero Jackpot (Opcional)
        </label>
        <div className="relative">
          <span className="absolute left-3 top-3 text-purple-500 font-bold">$</span>
          <input
            type="number"
            value={declaredJackpot}
            onChange={(e) => setDeclaredJackpot(e.target.value)}
            className="w-full bg-gray-800 text-white border border-gray-600 rounded-lg p-3 pl-8 focus:outline-none focus:border-purple-500 transition-colors font-mono text-xl"
            placeholder="Ej: 0"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-gradient-to-r from-blue-700 to-blue-600 hover:from-blue-600 hover:to-blue-500 text-white font-bold py-4 rounded-lg shadow-xl transform transition-all active:scale-95 disabled:opacity-50 flex justify-center items-center gap-2"
      >
        {loading ? (
          "Procesando..."
        ) : (
          <>
            🔒 Confirmar y Repartir
          </>
        )}
      </button>
    </form>
  );
}