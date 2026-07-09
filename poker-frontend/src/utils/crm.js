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

// Semáforo de recencia (mismos cortes que el análisis de negocio):
// ≤14 activo · 15–30 tibio · 31–60 enfriándose · >60 dormido.
export const segmentOf = (days) => {
  if (days == null) return null;
  if (days <= 14) return { emoji: '🔥', cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' };
  if (days <= 30) return { emoji: '🌗', cls: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/30' };
  if (days <= 60) return { emoji: '🧊', cls: 'bg-sky-500/10 text-sky-300 border-sky-500/30' };
  return { emoji: '😴', cls: 'bg-red-500/10 text-red-300/90 border-red-500/25' };
};
