// ---------------------------------------------------------------------------
// Config regional del club (zona horaria, moneda, locale). Se siembra desde
// /auth/me (staff) o el perfil del jugador al cargar la app; persiste en
// localStorage para que el primer render ya formatee bien. Default = Colombia.
// ---------------------------------------------------------------------------
const REGIONAL_KEY = 'rf_regional';
let regional = { locale: 'es-CO', currency: 'COP', timeZone: 'America/Bogota' };
try {
  const saved = JSON.parse(localStorage.getItem(REGIONAL_KEY) || 'null');
  if (saved && saved.locale && saved.currency && saved.timeZone) regional = saved;
} catch { /* localStorage bloqueado: quedan los defaults */ }

let moneyFormatter = null;
function buildMoney() {
  try {
    moneyFormatter = new Intl.NumberFormat(regional.locale, {
      style: 'currency', currency: regional.currency, maximumFractionDigits: 0,
    });
  } catch {
    moneyFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  }
}
buildMoney();

export function setRegional({ locale, currency, timezone } = {}) {
  regional = {
    locale: locale || regional.locale,
    currency: currency || regional.currency,
    timeZone: timezone || regional.timeZone,
  };
  buildMoney();
  try { localStorage.setItem(REGIONAL_KEY, JSON.stringify(regional)); } catch { /* ok */ }
}

export const clubTimeZone = () => regional.timeZone;
export const clubLocale = () => regional.locale;

export function formatMoney(amount) {
  return moneyFormatter.format(amount || 0);
}

// --- Formato del Panel del Jugador (móvil, redondeado sin decimales) ---
export const cop = (n) => formatMoney(Math.round(n || 0));
export const signCop = (n) => (n >= 0 ? '+' : '−') + cop(Math.abs(n || 0));
// Los timestamps de sesiones/transacciones llegan naive-UTC (sin 'Z'): hay que
// parsearlos como UTC o una sesión cerrada después de las 7pm Colombia se
// muestra con el día corrido. (scheduled_start de torneos NO: ese viaja local.)
// El regex de offset va anclado al final: los guiones de la fecha no cuentan.
export const parseServerDate = (iso) => new Date(/Z$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z');
export const fmtDate = (iso) => iso
  ? parseServerDate(iso).toLocaleDateString(regional.locale, { day: '2-digit', month: 'short', timeZone: regional.timeZone })
  : '';
// Hora de un timestamp del servidor, en la zona del club.
export const fmtTime = (iso) => iso
  ? parseServerDate(iso).toLocaleTimeString(regional.locale, { hour: '2-digit', minute: '2-digit', timeZone: regional.timeZone })
  : '--:--';
export const monthName = (y, m) => new Date(y, m - 1, 1).toLocaleDateString(regional.locale, { month: 'long' });
