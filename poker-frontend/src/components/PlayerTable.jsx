import { useState, useEffect } from 'react';
import api from '../api/axios'; 

export default function PlayerTable({ refreshTrigger }) {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState({ buyin: 0, cashout: 0, balance: 0 });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await api.get('/sessions/current/players-stats');
        const data = response.data;
        
        setPlayers(data);

        // Calcular totales
        const newTotals = data.reduce((acc, p) => ({
          buyin: acc.buyin + p.total_buyin,
          cashout: acc.cashout + p.total_cashout,
          balance: acc.balance + p.current_balance
        }), { buyin: 0, cashout: 0, balance: 0 });
        
        setTotals(newTotals);

      } catch (error) {
        console.error("Error cargando tabla:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [refreshTrigger]); 

  const formatMoney = (amount) => {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0
    }).format(amount);
  };

  // 👇 HELPER PARA MOSTRAR ICONOS DE PAGO
  // Nota: El backend idealmente debería devolver un array "payment_methods" para cada jugador.
  // Como actualmente el endpoint de stats agrupa los montos, asumiremos por ahora
  // una lógica visual simple o dejaremos preparado el espacio.
  // 
  // *MEJORA*: Si tu backend envía 'details' con los métodos, úsalos aquí.
  // Por ahora, pondremos un indicador visual genérico o basado en si tiene buy-in.
  
  const getPaymentBadge = (player) => {
    // Si tienes el dato del método predominante desde el backend, úsalo aquí.
    // Si no, podemos mostrar un icono genérico de "Entrada".
    // Para este ejemplo, mostraré ambos si el jugador tiene historial mixto (simulado) 
    // o simplemente el icono de dinero.
    
    // Si quisieras ser estricto, necesitaríamos que el backend nos diga: 
    // "Juan: 50k (Cash), 20k (Digital)"
    
    // Por ahora, decorativo informativo:
    return (
      <span className="ml-2 text-xs" title="Método de pago">
        {/* Aquí podrías condicionar si tu backend te pasa el dato 'last_method' */}
        {/* <span role="img" aria-label="cash">💵</span> */}
      </span>
    );
  };

  if (loading) return <div className="text-gray-500 text-center py-4">Cargando puntuaciones...</div>;
  if (players.length === 0) return <div className="text-gray-500 text-center py-4 italic">No hay jugadores con movimientos aún.</div>;

  return (
    <div className="bg-gray-800 rounded-xl shadow-lg border border-gray-700 overflow-hidden mt-6 animate-fade-in">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-900 text-gray-400 text-xs uppercase tracking-wider">
              <th className="p-4 font-semibold">Jugador</th>
              <th className="p-4 font-semibold text-right text-green-400">Buy-ins (Entrada)</th>
              <th className="p-4 font-semibold text-right text-red-400">Cashouts (Salida)</th>
              <th className="p-4 font-semibold text-right text-yellow-400">Gastos / Otros</th>
              <th className="p-4 font-semibold text-right text-white">Balance (Neto)</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-700">
            {players.map((p) => (
              <tr key={p.player_id} className="hover:bg-gray-750 transition-colors">
                
                {/* NOMBRE */}
                <td className="p-4">
                  <div className="font-bold text-white">{p.name}</div>
                  <div className="text-xs text-gray-500 flex items-center gap-1">
                    {p.total_jackpot > 0 && <span className="text-purple-400">🎁 Jackpot</span>}
                  </div>
                </td>

                {/* BUYIN + ICONO */}
                <td className="p-4 text-right font-mono text-gray-300">
                  <div className="flex items-center justify-end gap-2">
                    {formatMoney(p.total_buyin)}
                    
                    {/* 👇 AQUÍ ESTÁ LA MAGIA VISUAL */}
                    {/* Si tu backend soporta devolver el método, úsalo. 
                        Si no, por defecto asumimos Cash o mostramos un indicador neutro */}
                    
                    {/* Ejemplo: Si el backend devuelve p.has_digital_payments = true */}
                    {p.has_digital_payments ? (
                         <span title="Pagos Digitales" className="text-lg cursor-help">📱</span>
                    ) : (
                         <span title="Efectivo" className="text-lg cursor-help opacity-50">💵</span>
                    )}
                  </div>
                </td>

                {/* CASHOUT */}
                <td className="p-4 text-right font-mono text-gray-300">
                  {p.total_cashout > 0 ? formatMoney(p.total_cashout) : "-"}
                </td>

                {/* GASTOS */}
                <td className="p-4 text-right font-mono text-gray-400 text-sm">
                  {p.total_spend > 0 && (
                    <span className="block text-red-300">-{formatMoney(p.total_spend)} (Bebida)</span>
                  )}
                  {p.total_jackpot > 0 && (
                    <span className="block text-purple-300">+{formatMoney(p.total_jackpot)} (Premio)</span>
                  )}
                  {p.total_spend === 0 && p.total_jackpot === 0 && "-"}
                </td>

                {/* BALANCE */}
                <td className="p-4 text-right">
                  <span className={`font-mono font-bold px-3 py-1 rounded ${
                    p.current_balance >= 0 
                      ? 'bg-green-900/50 text-green-400 border border-green-800' 
                      : 'bg-red-900/50 text-red-400 border border-red-800'
                  }`}>
                    {formatMoney(p.current_balance)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>

          {/* FOOTER */}
          <tfoot className="bg-gray-900/80 border-t border-gray-600 font-bold">
            <tr>
              <td className="p-4 text-gray-400 uppercase text-xs">Total Mesa</td>
              <td className="p-4 text-right text-green-500 font-mono">{formatMoney(totals.buyin)}</td>
              <td className="p-4 text-right text-red-500 font-mono">{formatMoney(totals.cashout)}</td>
              <td className="p-4 text-right text-gray-500">-</td>
              <td className="p-4 text-right text-white font-mono border-t-2 border-gray-500">
                {formatMoney(totals.balance)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}