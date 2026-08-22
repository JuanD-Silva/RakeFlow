// Helpers compartidos del CRM del club (directorio de jugadores + ficha 360).

// Espejo de app/phone_utils.normalize_phone: dígitos + indicativo CO si faltara
// (los teléfonos creados en mesa suelen venir sin el 57 → wa.me roto si va crudo).
export const waPhone = (raw) => {
  let d = (raw || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10) d = '57' + d;
  else if (d.startsWith('0057')) d = d.slice(2);
  return d;
};

// Dinero compacto para líneas de stats ($2,3M / $850k / $900)
export const mcop = (n) => {
  const v = Math.abs(Math.round(n || 0));
  if (v >= 1e6) return '$' + (v / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + 'M';
  if (v >= 1e3) return '$' + Math.round(v / 1e3).toLocaleString('es-CO') + 'k';
  return '$' + v.toLocaleString('es-CO');
};

// Semáforo de recencia (mismos cortes que el análisis de negocio). UNA sola
// fuente: chips de filtro, contadores y el chip de cada card salen de aquí —
// antes el filtro "dormidos" era +30 y la card pintaba 🧊 a los de 31-60.
export const SEGMENTS = [
  { key: 'hot',    emoji: '🔥', label: 'Activo',       range: '≤14d',   from: 0,  to: 14,       cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
  { key: 'warm',   emoji: '🌗', label: 'Tibio',        range: '15–30d', from: 15, to: 30,       cls: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/30' },
  { key: 'cool',   emoji: '🧊', label: 'Enfriándose',  range: '31–60d', from: 31, to: 60,       cls: 'bg-sky-500/10 text-sky-300 border-sky-500/30' },
  { key: 'asleep', emoji: '😴', label: 'Dormido',      range: '+60d',   from: 61, to: Infinity, cls: 'bg-red-500/10 text-red-300/90 border-red-500/25' },
];

export const segmentOf = (days) => {
  if (days == null) return null;
  return SEGMENTS.find((s) => days >= s.from && days <= s.to) || SEGMENTS[SEGMENTS.length - 1];
};

// "hoy" / "ayer" / "hace 14d"
export const haceDias = (days) => (days === 0 ? 'hoy' : days === 1 ? 'ayer' : `hace ${days}d`);
