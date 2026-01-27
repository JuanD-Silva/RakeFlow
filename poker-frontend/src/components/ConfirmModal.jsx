import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

export default function ConfirmModal({ isOpen, onClose, onConfirm, title, message, isDeleting = false }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in">
      {/* 1. Fondo Oscuro (Backdrop) */}
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity" 
        onClick={onClose}
      ></div>

      {/* 2. Contenido del Modal */}
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden transform transition-all scale-100">
        
        {/* Encabezado Rojo de Advertencia */}
        <div className="bg-red-500/10 border-b border-red-500/20 p-6 flex flex-col items-center text-center">
          <div className="bg-red-500/20 p-3 rounded-full mb-4">
            <ExclamationTriangleIcon className="w-8 h-8 text-red-500" />
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
            className="px-6 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold shadow-lg shadow-red-900/20 transition-all flex items-center gap-2 text-sm uppercase tracking-wider"
          >
            {isDeleting ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Eliminando...
              </>
            ) : (
              "Sí, Eliminar"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}