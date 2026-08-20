import { useEffect } from 'react';

// Cierra un modal con la tecla Escape. `enabled` apaga el listener cuando el
// modal no está abierto o cuando hay una operación en curso (no cancelar un
// cobro a mitad de request). Con modales apilados, cada capa pasa un enabled
// que excluye a las capas superiores para que Escape cierre solo la de arriba.
export function useEscape(onClose, enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, enabled]);
}
