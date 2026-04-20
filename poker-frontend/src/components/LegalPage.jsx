import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';

export default function LegalPage({ title, lastUpdated, children }) {
  return (
    <div className="min-h-screen bg-[#0a0f1a] text-gray-200 font-sans">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="mb-8">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-gray-500 hover:text-emerald-400 text-xs font-bold uppercase tracking-wider transition-colors"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            Volver al inicio
          </Link>
        </div>

        <header className="mb-10 border-b border-gray-800 pb-6">
          <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight">{title}</h1>
          {lastUpdated && (
            <p className="text-gray-500 text-sm mt-2">
              Última actualización: <span className="text-gray-400 font-mono">{lastUpdated}</span>
            </p>
          )}
        </header>

        <article className="legal-content space-y-6 text-gray-300 leading-relaxed">
          {children}
        </article>

        <footer className="mt-16 pt-8 border-t border-gray-800 text-xs text-gray-500">
          <p>
            RakeFlow · Operado por Juan David Silva · Bogotá D.C., Colombia · Contacto:{' '}
            <a href="mailto:soporte@rakeflow.site" className="text-emerald-400 hover:text-emerald-300">
              soporte@rakeflow.site
            </a>
          </p>
          <div className="mt-4 flex gap-4">
            <Link to="/terms" className="hover:text-emerald-400 transition-colors">Términos y Condiciones</Link>
            <Link to="/privacy" className="hover:text-emerald-400 transition-colors">Política de Privacidad</Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
