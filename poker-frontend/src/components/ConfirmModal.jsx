import { ExclamationTriangleIcon, CheckBadgeIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { useEscape } from '../hooks/useEscape';

// CONFIRM ÚNICO de la app. `variant` colorea encabezado y botón según el tipo
// de decisión: 'danger' (destructivo, rojo), 'success' (paso feliz de plata,
// dorado), 'info' (cobros de rutina, azul). `subMessage` es el bloque mono
// (montos, recap de premios multilínea).
const VARIANTS = {
  danger: {
    header: 'bg-red-500/10 border-red-500/20', iconBg: 'bg-red-500/20', icon: 'text-red-500',
    confirm: 'bg-red-600 hover:bg-red-500 text-white shadow-red-900/20', Icon: ExclamationTriangleIcon,
  },
  success: {
    header: 'bg-yellow-500/10 border-yellow-500/20', iconBg: 'bg-yellow-500/20', icon: 'text-yellow-400',
    confirm: 'bg-yellow-600 hover:bg-yellow-500 text-black shadow-yellow-900/20', Icon: CheckBadgeIcon,
  },
  info: {
    header: 'bg-blue-500/10 border-blue-500/20', iconBg: 'bg-blue-500/20', icon: 'text-blue-400',
    confirm: 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/20', Icon: InformationCircleIcon,
  },
};

export default function ConfirmModal({ isOpen, onClose, onConfirm, title, message, subMessage, variant = 'danger', isDeleting = false, confirmText = "Sí, Eliminar", loadingText = "Eliminando..." }) {
  // Antes del early return: los hooks no pueden ser condicionales.
  useEscape(onClose, isOpen && !isDeleting);
  if (!isOpen) return null;
  const v = VARIANTS[variant] || VARIANTS.danger;
  const VIcon = v.Icon;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in" role="dialog" aria-modal="true" aria-label={title || "Confirmar"}>
      {/* 1. Fondo Oscuro (Backdrop) */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      ></div>

      {/* 2. Contenido del Modal */}
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden transform transition-all scale-100">

        {/* Encabezado según variante */}
        <div className={`${v.header} border-b p-6 flex flex-col items-center text-center`}>
          <div className={`${v.iconBg} p-3 rounded-full mb-4`}>
            <VIcon className={`w-8 h-8 ${v.icon}`} />
          </div>
          <h3 className="text-xl font-bold text-white uppercase tracking-wide">
            {title || "¿Estás seguro?"}
          </h3>
        </div>

        {/* Mensaje */}
        <div className="p-6 text-center">
          <p className="text-gray-400 text-sm leading-relaxed whitespace-pre-line">
            {message}
          </p>
          {subMessage && (
            <p className="mt-3 text-sm font-mono font-bold text-white bg-gray-700/50 py-2 px-3 rounded-lg inline-block whitespace-pre-line text-left">
              {subMessage}
            </p>
          )}
        </div>

        {/* Botones de Acción */}
        <div className="p-4 bg-gray-800/50 border-t border-gray-700 flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 font-medium transition-colors text-sm uppercase tracking-wider"
            disabled={isDeleting}
          >
            Cancelar
          </button>

          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className={`px-6 py-2 rounded-lg ${v.confirm} disabled:opacity-50 disabled:cursor-not-allowed font-bold shadow-lg transition-all flex items-center gap-2 text-sm uppercase tracking-wider`}
          >
            {isDeleting ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                {loadingText}
              </>
            ) : (
              confirmText
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
