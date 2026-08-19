// Normaliza para buscar: minusculas y sin tildes (mismo criterio que el
// sorteo publico y el directorio CRM).
export const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
