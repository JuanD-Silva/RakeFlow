import { useState, useEffect } from 'react';
import { sessionService } from '../api/services';
import { formatMoney } from '../utils/formatters';

export default function CloseSessionForm({ sessionId, onSuccess }) {
  // Estados del formulario
  const [declaredRake, setDeclaredRake] = useState("");
  const [declaredJackpot, setDeclaredJackpot] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null); // bruto/neto estimado antes de cerrar

  // Preview en vivo del rake neto a medida que el cajero escribe el rake bruto.
  // Debounce 500ms; read-only (no cierra nada).
  useEffect(() => {
    const rake = parseFloat(declaredRake) || 0;
    if (!sessionId || rake <= 0) { setPreview(null); return; }
    const t = setTimeout(async () => {
      try { setPreview(await sessionService.closePreview(sessionId, rake)); }
      catch { setPreview(null); }
    }, 500);
    return () => clearTimeout(t);
  }, [declaredRake, sessionId]);
  
  // Estados para controlar el flujo visual
  const [auditMismatch, setAuditMismatch] = useState(null); // Alerta Roja
  const [isSuccess, setIsSuccess] = useState(false);        // Factura Verde
  const [closureReport, setClosureReport] = useState(null); // Datos finales



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
          
          {/* RAKE BRUTO */}
          <div className="flex justify-between items-center border-b border-gray-700 pb-2">
            <span className="text-gray-400">Rake bruto (ingreso):</span>
            <span className="text-white font-mono font-bold text-lg">
              {formatMoney(closureReport.gross_rake ?? closureReport.declared_rake_cash)}
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

          {/* GASTOS: salario dealers + cortesías (reducen la utilidad de socios) */}
          {closureReport.dealer_cost > 0 && (
            <div className="flex justify-between items-center text-amber-400">
              <span>(-) Salario dealers:</span>
              <span className="font-mono">{formatMoney(closureReport.dealer_cost)}</span>
            </div>
          )}
          {closureReport.courtesy_cost > 0 && (
            <div className="flex justify-between items-center text-amber-400">
              <span>(-) Cortesías (bonos):</span>
              <span className="font-mono">{formatMoney(closureReport.courtesy_cost)}</span>
            </div>
          )}

          {/* RAKE NETO (monitoreo: bruto - gastos) */}
          {(closureReport.dealer_cost > 0 || closureReport.courtesy_cost > 0) && (
            <div className="flex justify-between items-center text-gray-300 border-t border-gray-700 pt-2">
              <span className="text-xs uppercase tracking-wider">Rake neto (− egresos):</span>
              <span className="font-mono font-bold">{formatMoney(closureReport.net_rake)}</span>
            </div>
          )}

          <div className="border-t border-gray-600 pt-2"></div>

          {/* UTILIDAD SOCIOS (ya neta de gastos) */}
          <div className={`flex justify-between items-center p-3 rounded-lg border ${closureReport.partner_profit < 0 ? 'bg-red-900/30 border-red-500/40' : 'bg-green-900/30 border-green-500/30'}`}>
            <span className={`font-bold uppercase text-xs tracking-wider ${closureReport.partner_profit < 0 ? 'text-red-400' : 'text-green-400'}`}>
              (=) Utilidad Socios
            </span>
            <span className={`font-mono font-bold text-xl ${closureReport.partner_profit < 0 ? 'text-red-400' : 'text-green-400'}`}>
              {formatMoney(closureReport.partner_profit)}
            </span>
          </div>
          {closureReport.partner_profit < 0 && (
            <p className="text-[9px] text-red-400/80 text-left italic">
              ⚠️ Los egresos (dealers + cortesías) superaron el rake disponible para socios esta sesión.
            </p>
          )}

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

          {/* PAGO A DEALERS (gasto: ya descontado de la utilidad de socios arriba) */}
          {closureReport.dealers_report && closureReport.dealers_report.length > 0 && (
            <div className="pt-4 space-y-3 border-t border-gray-700">
              <p className="text-[10px] text-amber-500 font-bold uppercase tracking-widest">
                🃏 Detalle pago a Dealers
              </p>

              {closureReport.dealers_warning && (
                <div className="bg-yellow-900/30 border border-yellow-500/40 text-yellow-300 p-2.5 rounded-lg text-[10px] text-left">
                  ⚠️ {closureReport.dealers_warning}
                </div>
              )}

              <div className="space-y-2">
                {closureReport.dealers_report.map((shift, i) => (
                  <div key={i} className="bg-gray-900/40 border border-gray-700/50 p-3 rounded-lg text-left">
                    <div className="flex justify-between items-center">
                      <p className="text-xs text-white font-bold">{shift.dealer_name}</p>
                      <span className="text-amber-400 font-mono font-bold text-sm">
                        {formatMoney(shift.payment)}
                      </span>
                    </div>
                    <p className="text-[9px] text-gray-500 font-mono mt-1">
                      {shift.hours}h × {formatMoney(shift.hourly_rate_cop)}/h
                      {shift.rake_pct > 0 && (
                        <> + {shift.rake_pct}% de {formatMoney(Math.max(0, shift.declared_rake || 0))} rake</>
                      )}
                    </p>
                  </div>
                ))}
              </div>

              {closureReport.unassigned_rake > 0 && (
                <p className="text-[9px] text-gray-500 text-left">
                  Rake sin dealer asignado: {formatMoney(closureReport.unassigned_rake)}
                </p>
              )}

              {closureReport.dealers_note && (
                <p className="text-[9px] text-gray-500 text-left italic">
                  ℹ️ {closureReport.dealers_note}
                </p>
              )}

              <div className="flex justify-between items-center bg-amber-900/20 p-3 rounded-lg border border-amber-500/30">
                <span className="text-amber-400 font-bold uppercase text-[10px] tracking-wider">
                  Total a pagar dealers
                </span>
                <span className="text-amber-400 font-mono font-bold text-base">
                  {formatMoney(closureReport.total_dealers_payment)}
                </span>
              </div>
              <p className="text-[8px] text-gray-600 text-left italic">
                Este total ya se descontó de la utilidad de socios (rake neto).
              </p>
            </div>
          )}

          {/* PROPINAS POR DEALER (lo que recibió cada uno) */}
          {closureReport.dealers_tips && closureReport.dealers_tips.length > 0 && (
            <div className="pt-4 space-y-2 border-t border-gray-700">
              <p className="text-[10px] text-yellow-500 font-bold uppercase tracking-widest">
                🤝 Propinas por Dealer
              </p>
              <div className="space-y-1.5">
                {closureReport.dealers_tips.map((t, i) => (
                  <div key={i} className="flex justify-between items-center bg-gray-900/40 border border-gray-700/50 p-2.5 rounded-lg">
                    <span className="text-xs text-white font-bold">{t.dealer_name}</span>
                    <span className="text-yellow-400 font-mono font-bold text-sm">{formatMoney(t.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

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

      {/* PREVIEW: rake bruto → gastos → neto (estimado, antes de cerrar) */}
      {preview && (preview.dealer_cost > 0 || preview.courtesy_cost > 0) && (
        <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-4 text-sm space-y-1.5 animate-fade-in">
          <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1">Vista previa (estimado)</p>
          <div className="flex justify-between text-gray-300">
            <span>Rake bruto</span><span className="font-mono">{formatMoney(preview.gross_rake)}</span>
          </div>
          {preview.dealer_cost > 0 && (
            <div className="flex justify-between text-amber-400">
              <span>(−) Salario dealers</span><span className="font-mono">{formatMoney(preview.dealer_cost)}</span>
            </div>
          )}
          {preview.courtesy_cost > 0 && (
            <div className="flex justify-between text-amber-400">
              <span>(−) Cortesías (bonos)</span><span className="font-mono">{formatMoney(preview.courtesy_cost)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-gray-700 pt-1.5 mt-1.5 font-bold">
            <span className={preview.net_rake < 0 ? 'text-red-400' : 'text-emerald-400'}>(=) Rake neto</span>
            <span className={`font-mono ${preview.net_rake < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{formatMoney(preview.net_rake)}</span>
          </div>
          <p className="text-[9px] text-gray-600 italic pt-1">El neto definitivo se calcula al confirmar (cierra los turnos de dealer).</p>
        </div>
      )}

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