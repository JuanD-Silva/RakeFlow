// src/components/Modal.jsx
export default function Modal({ isOpen, onClose, title, children }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Fondo Oscuro (Backdrop) */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      ></div>

      {/* La Ventana (Card) — scrolleable si el contenido no cabe (clave en movil) */}
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6 transform transition-all scale-100">
        <div className="flex justify-between items-center mb-6 border-b border-gray-800 pb-4 sticky top-0 bg-gray-900 -mx-6 -mt-6 px-6 pt-6 z-10">
          <h3 className="text-xl font-bold text-white">{title}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white hover:bg-gray-800 rounded-full p-2 transition-colors cursor-pointer"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        {/* Aquí va el formulario dinámico */}
        {children}
      </div>
    </div>
  );
}