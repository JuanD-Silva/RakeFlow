const formatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

export function formatMoney(amount) {
  return formatter.format(amount || 0);
}

// --- Formato del Panel del Jugador (móvil, COP redondeado sin decimales) ---
export const cop = (n) => '$' + Math.round(n || 0).toLocaleString('es-CO');
export const signCop = (n) => (n >= 0 ? '+' : '−') + cop(Math.abs(n || 0));
// Los timestamps de sesiones/transacciones llegan naive-UTC (sin 'Z'): hay que
// parsearlos como UTC o una sesión cerrada después de las 7pm Colombia se
// muestra con el día corrido. (scheduled_start de torneos NO: ese viaja local.)
// El regex de offset va anclado al final: los guiones de la fecha no cuentan.
export const parseServerDate = (iso) => new Date(/Z$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z');
export const fmtDate = (iso) => iso
  ? parseServerDate(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
  : '';
export const monthName = (y, m) => new Date(y, m - 1, 1).toLocaleDateString('es-CO', { month: 'long' });
