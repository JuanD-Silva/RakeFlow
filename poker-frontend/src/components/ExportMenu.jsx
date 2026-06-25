import { useState, useRef, useEffect } from 'react';
import { ArrowDownTrayIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { exportPDF, exportExcel, toWhatsAppText, shareWhatsAppText } from '../utils/reportExport';

/**
 * Menú "Exportar / Compartir" reutilizable.
 * getModel: async () => modelo de reporte (ver utils/reportExport.js). Puede
 * hacer fetch; se invoca recién al elegir una opción. Si devuelve null/lanza,
 * no exporta.
 */
export default function ExportMenu({ getModel }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const canShareFiles = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const run = async (action) => {
    setOpen(false);
    setBusy(true);
    try {
      const model = await getModel();
      if (!model || (model.rows && model.rows.length === 0)) {
        alert('No hay datos en este periodo para exportar.');
        return;
      }
      await action(model);
    } catch (err) {
      console.error('Error exportando reporte:', err);
      alert('No se pudo generar el reporte. Intentá de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  const Item = ({ emoji, text, onClick }) => (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-700/70 transition-colors text-left"
    >
      <span className="text-base leading-none">{emoji}</span>
      {text}
    </button>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white shadow-lg shadow-emerald-900/20 transition-all"
      >
        <ArrowDownTrayIcon className="w-4 h-4" />
        {busy ? 'Generando…' : 'Exportar'}
        {!busy && <ChevronDownIcon className="w-3 h-3 opacity-70" />}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-56 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden py-1 animate-fade-in">
          <Item emoji="📄" text="Descargar PDF" onClick={() => run((m) => exportPDF(m))} />
          <Item emoji="📊" text="Descargar Excel" onClick={() => run((m) => exportExcel(m))} />
          <Item emoji="💬" text="Resumen por WhatsApp" onClick={() => run((m) => shareWhatsAppText(toWhatsAppText(m)))} />
          {canShareFiles && (
            <Item emoji="📤" text="Compartir PDF…" onClick={() => run((m) => exportPDF(m, { share: true }))} />
          )}
        </div>
      )}
    </div>
  );
}
