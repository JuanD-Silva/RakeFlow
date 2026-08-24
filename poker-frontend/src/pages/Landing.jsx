import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import {
  ChartBarIcon,
  UserGroupIcon,
  BanknotesIcon,
  TrophyIcon,
  ShieldCheckIcon,
  Cog6ToothIcon,
  CheckIcon,
  ArrowRightIcon,
  DeviceTabletIcon,
  BoltIcon
} from '@heroicons/react/24/outline';

// Contacto de ventas — WhatsApp con mensaje pre-cargado
const WHATSAPP_URL = `https://wa.me/573041076526?text=${encodeURIComponent('Hola! Me interesa RakeFlow para mi club. ¿Podemos agendar una demo?')}`;

// Logo oficial de WhatsApp (heroicons no lo trae)
function WhatsAppIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885M20.52 3.449C18.24 1.245 15.24 0 12.045 0 5.463 0 .104 5.334.101 11.892c0 2.096.549 4.142 1.595 5.945L0 24l6.335-1.652a12.062 12.062 0 005.71 1.448h.006c6.585 0 11.946-5.336 11.949-11.896 0-3.176-1.24-6.165-3.495-8.411z" />
    </svg>
  );
}

// Hook para detectar cuando un elemento entra al viewport
function useInView(threshold = 0.15) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setInView(true); obs.disconnect(); } }, { threshold });
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, inView];
}

// Los dolores del dueño, con nombre propio — la sección que convierte es la
// que le dice "esto te pasa a ti", no la lista de funciones.
const pains = [
  { pain: 'El cuaderno de fiados', fix: 'Cada "luego te pago" queda en la ficha del jugador: quién debe, cuánto y desde cuándo. Nada se olvida al cerrar.' },
  { pain: 'El descuadre de las 3 a.m.', fix: 'Antes de cerrar, RakeFlow compara la plata física contra lo registrado y te muestra la diferencia en pesos. El descuadre se encuentra, no se descubre.' },
  { pain: '"¿Cuánto ganó el club esta noche?"', fix: 'Cada cierre te da la utilidad real: rake menos dealers y cortesías, por noche, semana y mes. Y si tienes socios, el reparto se calcula solo con tus reglas.' },
];

const features = [
  { icon: BanknotesIcon, title: 'Control de Rake', desc: 'Buy-ins, cashouts, propinas y gastos en tiempo real. El rake se calcula solo al cerrar cada mesa.', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', glow: 'group-hover:shadow-emerald-500/10' },
  { icon: TrophyIcon, title: 'Torneos completos', desc: 'Reloj de blinds con pantalla para TV, sorteo de sillas, re-entradas y premios. El torneo corre solo.', color: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20', glow: 'group-hover:shadow-violet-500/10' },
  { icon: ChartBarIcon, title: 'La caja, clara', desc: 'Caja diaria, semanal y mensual. Metas, reparto a socios y pago a dealers, cuadrados con el cierre.', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20', glow: 'group-hover:shadow-blue-500/10' },
  { icon: UserGroupIcon, title: 'Jugadores que vuelven', desc: 'Cada jugador con su historial, ranking mensual y su propia app: logros, retos y estatus VIP para que vuelva.', color: 'text-pink-400', bg: 'bg-pink-500/10', border: 'border-pink-500/20', glow: 'group-hover:shadow-pink-500/10' },
  { icon: Cog6ToothIcon, title: 'Tus reglas de reparto', desc: 'Define cómo se reparte la plata: fijos, porcentajes o metas mensuales. Cambia las reglas cuando quieras.', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', glow: 'group-hover:shadow-amber-500/10' },
  { icon: ShieldCheckIcon, title: 'Auditoría y cierre', desc: 'Auditoría pre-cierre que detecta el descuadre antes de cerrar caja, y registro de quién hizo cada movimiento.', color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', glow: 'group-hover:shadow-cyan-500/10' }
];

const steps = [
  { number: '01', title: 'Crea tu Club', desc: 'Regístrate con tu correo en menos de 30 segundos. Sin tarjeta.', emoji: '♠️' },
  { number: '02', title: 'Configura las Reglas', desc: 'Define tu meta mensual y cómo se reparte entre los socios.', emoji: '♦️' },
  { number: '03', title: 'Abre tu Primera Mesa', desc: 'Sienta jugadores, registra buy-ins y cierra tu primera caja cuadrada.', emoji: '♣️' },
];

const plans = [
  { name: 'Pro', price: '$199.000', period: '/mes', desc: 'Para clubes activos', popular: true, color: 'border-emerald-500/50', btn: 'bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white shadow-lg shadow-emerald-900/30', features: ['Mesas ilimitadas', 'Jugadores ilimitados', 'Reportes avanzados', 'Torneos ilimitados', 'Soporte prioritario', 'Multi-usuario (cajeros)', '14 días de prueba gratis'] },
  { name: 'Enterprise', price: 'Contacto', period: '', desc: 'Para cadenas de clubes', color: 'border-violet-500/50', btn: 'bg-violet-700 hover:bg-violet-600 text-white', features: ['Todo de Pro', 'Multi-sede', 'API personalizada', 'Dashboard corporativo', 'Soporte dedicado', 'SLA garantizado'] }
];

const FAQ = [
  { q: '¿Necesito tarjeta para probar?', a: 'No. Creas tu club con tu correo y tienes 14 días con todo habilitado. Solo pagas si decides quedarte.' },
  { q: '¿Qué pasa cuando se acaba la prueba?', a: 'Nada se borra. Tus datos quedan guardados y eliges si activas el plan. No hay cobros automáticos sorpresa.' },
  { q: '¿Sirve si mi club también hace torneos?', a: 'Sí — es de las pocas herramientas que maneja cash y torneos juntos: reloj de blinds con pantalla para TV, sorteo de sillas, re-entradas, y el rake del torneo entra a la misma caja.' },
  { q: '¿Quién puede ver las finanzas del club?', a: 'Tú decides. Hay roles: el dueño ve todo, el cajero solo opera la mesa, el dealer solo su turno. Cada movimiento queda registrado con quién lo hizo.' },
  { q: '¿Es complicado para mi cajero?', a: 'Se opera desde el celular con botones grandes: entrada, cobro, gasto. Si tu cajero maneja WhatsApp, maneja RakeFlow.' },
  { q: '¿En qué moneda y en qué idioma?', a: 'Pesos colombianos y español, de punta a punta. Soporte por WhatsApp con nosotros directamente.' },
];

// La demo del hero está VIVA: cada pocos segundos "pasa algo" en la mesa
// (un buy-in, un cashout, el rake que sube) — el visitante ve el producto
// trabajando antes de tocar nada. Todo determinista y barato: un interval.
const DEMO_EVENTS = [
  { text: 'Buy-in de $100.000 — Pedro', tone: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' },
  { text: 'Cashout de $185.000 — Andrea', tone: 'text-rose-300 border-rose-500/40 bg-rose-500/10' },
  { text: 'Rake declarado: $52.000', tone: 'text-cyan-300 border-cyan-500/40 bg-cyan-500/10' },
  { text: 'Re-entrada al torneo — Miguel', tone: 'text-violet-300 border-violet-500/40 bg-violet-500/10' },
  { text: 'Turno de dealer cerrado — 4.5 h', tone: 'text-amber-300 border-amber-500/40 bg-amber-500/10' },
];

function useDemoTick(intervalMs = 2600) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}

// Aislado en su propio componente: el tick re-renderiza SOLO el chip, no la
// landing entera (la promesa de fluidez en Android bajo se mantiene).
function LiveDemoChip() {
  const tick = useDemoTick();
  const ev = DEMO_EVENTS[tick % DEMO_EVENTS.length];
  return (
    <div key={tick} className="animate-demo-pop">
      <div className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[11px] font-bold ${ev.tone}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
        {ev.text}
      </div>
    </div>
  );
}

function AnimatedSection({ children, className = '', animation = 'animate-fade-up' }) {
  const [ref, inView] = useInView();
  return (
    <div ref={ref} className={`${className} ${inView ? animation : 'opacity-0'}`}>
      {children}
    </div>
  );
}

export default function Landing() {
  const [navSolid, setNavSolid] = useState(false);
  // En móvil, pasada la primera pantalla, el CTA viaja contigo: barra fija
  // abajo con la oferta + WhatsApp. En desktop basta el FAB.
  const [showMobileCta, setShowMobileCta] = useState(false);

  // Solo cambia el navbar al cruzar el umbral — NO re-renderiza en cada scroll
  // (el parallax por scrollY causaba lag en movil al repintar los blurs).
  useEffect(() => {
    let solid = false;
    const handleScroll = () => {
      const next = window.scrollY > 50;
      if (next !== solid) { solid = next; setNavSolid(next); }
      setShowMobileCta(window.scrollY > 700);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0f1a] text-gray-100 font-sans overflow-x-hidden relative noise-bg">

      {/* NAVBAR — pt safe-area: con viewport-fit=cover el iPhone mete la página
          bajo la isla/status bar y tapaba Entrar/Crear Club */}
      <nav className={`fixed top-0 w-full z-50 pt-[env(safe-area-inset-top)] transition-all duration-500 ${navSolid ? 'bg-[#0a0f1a]/95 backdrop-blur-xl border-b border-gray-800/50 shadow-2xl shadow-black/20' : 'bg-transparent'}`}>
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 group cursor-pointer">
            <img src="/rakeflow-logo.svg" alt="" className="w-8 h-8 rounded-lg" />
            <span className="text-white font-black text-xl tracking-tighter uppercase">
              Rake<span className="text-emerald-500">Flow</span>
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <Link to="/login" className="whitespace-nowrap text-white/90 hover:text-white text-sm font-bold px-4 sm:px-5 py-2 rounded-lg border border-white/25 bg-white/5 hover:bg-white/10 hover:border-emerald-500/60 transition-all">
              <span className="sm:hidden">Entrar</span>
              <span className="hidden sm:inline">Iniciar Sesion</span>
            </Link>
            <Link to="/register" className="whitespace-nowrap bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold px-4 sm:px-5 py-2 rounded-lg transition-all shadow-lg shadow-emerald-900/20 hover:shadow-emerald-500/20 hover:-translate-y-0.5 active:translate-y-0">
              <span className="sm:hidden">Crear Club</span>
              <span className="hidden sm:inline">Crear Club Gratis</span>
            </Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="pt-[calc(7rem+env(safe-area-inset-top))] pb-24 px-6 relative">
        {/* Ambient background — parallax on scroll */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-20 left-1/4 w-[500px] h-[500px] bg-emerald-600/8 rounded-full blur-[120px] animate-drift"></div>
          <div className="absolute bottom-10 right-1/4 w-[400px] h-[400px] bg-violet-600/8 rounded-full blur-[100px] animate-drift delay-700"></div>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-cyan-500/5 rounded-full blur-[80px]"></div>

          {/* Floating card suits */}
          <div className="animate-orbit opacity-[0.04] text-6xl" style={{ position: 'absolute', top: '50%', left: '50%' }}>♠</div>
          <div className="animate-orbit opacity-[0.03] text-5xl" style={{ position: 'absolute', top: '50%', left: '50%', animationDuration: '25s', animationDirection: 'reverse' }}>♥</div>
          <div className="animate-orbit opacity-[0.03] text-4xl" style={{ position: 'absolute', top: '50%', left: '50%', animationDuration: '30s' }}>♦</div>

          {/* Grid lines */}
          <div className="absolute inset-0 opacity-[0.02]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)', backgroundSize: '80px 80px' }}></div>
        </div>

        <div className="max-w-7xl mx-auto relative z-10 grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-12 lg:gap-10 items-center">
        <div className="text-center lg:text-left">
          <div className="animate-fade-up inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-5 py-2 mb-8 hover:bg-emerald-500/15 transition-colors cursor-default">
            <BoltIcon className="w-4 h-4 text-emerald-400 animate-pulse" />
            <span className="text-emerald-400 text-xs font-bold uppercase tracking-wider">Hecho para clubes de poker en Colombia</span>
          </div>

          <h1 className="font-display animate-fade-up delay-100 text-5xl md:text-6xl xl:text-7xl font-bold text-white leading-[1.05] mb-6">
            Controla el{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-cyan-400 to-emerald-400 animate-shimmer" style={{ backgroundSize: '200% 100%' }}>
              rake
            </span>
            {' '}de tu club como un profesional
          </h1>

          <p className="animate-fade-up delay-200 text-gray-400 text-lg md:text-xl max-w-2xl mx-auto lg:mx-0 mb-10 leading-relaxed">
            Cada buy-in, cada cashout, el pago a dealers y el reparto a socios — registrado desde el celular, con auditoría que detecta el descuadre <b className="text-gray-200">antes</b> de cerrar la noche.
          </p>

          <div className="animate-fade-up delay-300 flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
            <Link to="/register" className="group bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold text-lg px-8 py-4 rounded-xl shadow-[0_0_30px_rgba(16,185,129,0.3)] hover:shadow-[0_0_50px_rgba(16,185,129,0.4)] transition-all active:scale-[0.98] flex items-center justify-center gap-2 animate-pulse-glow">
              Probar 14 días gratis <ArrowRightIcon className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="bg-gray-800/60 hover:bg-gray-700/80 text-gray-300 hover:text-white font-bold text-lg px-8 py-4 rounded-xl border border-gray-700 hover:border-emerald-500/40 transition-all flex items-center justify-center gap-2 backdrop-blur-sm">
              <WhatsAppIcon className="w-5 h-5 text-emerald-400" /> Hablar con nosotros
            </a>
          </div>

          <div className="animate-fade-up delay-500 flex flex-wrap items-center justify-center lg:justify-start gap-x-6 gap-y-2 mt-10 text-gray-500 text-sm">
            <span className="flex items-center gap-1.5 hover:text-gray-300 transition-colors"><CheckIcon className="w-4 h-4 text-emerald-500" /> Sin tarjeta de crédito</span>
            <span className="flex items-center gap-1.5 hover:text-gray-300 transition-colors"><CheckIcon className="w-4 h-4 text-emerald-500" /> Listo en 2 minutos</span>
            <span className="flex items-center gap-1.5 hover:text-gray-300 transition-colors"><DeviceTabletIcon className="w-4 h-4 text-emerald-500" /> Celular, tablet o PC</span>
          </div>
        </div>

        {/* HERO MOCKUP — la demo viva, columna derecha en desktop */}
        <div className="relative animate-fade-up delay-400">
          <div className="relative group lg:rotate-1 lg:hover:rotate-0 transition-transform duration-700">
            {/* Glow detrás */}
            <div className="absolute -inset-4 bg-gradient-to-r from-emerald-500/10 via-cyan-500/5 to-violet-500/10 rounded-3xl blur-2xl opacity-60 group-hover:opacity-100 transition-opacity duration-1000"></div>

            {/* Browser chrome */}
            <div className="relative bg-[#0f1623] rounded-2xl border border-gray-700/60 shadow-2xl shadow-black/40 overflow-hidden">
              {/* Title bar */}
              <div className="flex items-center gap-2 px-4 py-3 bg-[#0b1018] border-b border-gray-800/80">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500/70"></div>
                  <div className="w-3 h-3 rounded-full bg-yellow-500/70"></div>
                  <div className="w-3 h-3 rounded-full bg-green-500/70"></div>
                </div>
                <div className="flex-1"></div>
              </div>

              {/* App UI simulada */}
              <div className="p-4 md:p-6 space-y-4">
                {/* Nav simulado */}
                <div className="flex items-center justify-between bg-gray-900/80 rounded-xl px-4 py-3 border border-gray-800/50">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">💸</span>
                    <span className="text-white font-black text-sm">Rake<span className="text-emerald-500">Flow</span></span>
                  </div>
                  <div className="hidden md:flex gap-2">
                    <div className="bg-gray-700 px-3 py-1.5 rounded-lg text-white text-xs font-bold">Mesa Activa</div>
                    <div className="px-3 py-1.5 text-gray-500 text-xs font-bold">Historial</div>
                    <div className="px-3 py-1.5 text-gray-500 text-xs font-bold">Caja Semanal</div>
                    <div className="px-3 py-1.5 text-gray-500 text-xs font-bold">Ranking</div>
                  </div>
                  <div className="text-[10px] text-green-500 font-bold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span> Online
                  </div>
                </div>

                {/* Stats cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-gradient-to-r from-purple-900/60 to-indigo-900/60 rounded-xl p-3 border border-purple-500/20">
                    <p className="text-purple-300 text-[8px] font-bold uppercase tracking-wider">Jackpot Club</p>
                    <p className="text-white font-black text-lg font-mono mt-1">$850.000</p>
                  </div>
                  <div className="bg-gradient-to-r from-emerald-900/60 to-teal-900/60 rounded-xl p-3 border border-emerald-500/20">
                    <p className="text-emerald-300 text-[8px] font-bold uppercase tracking-wider">Buy-in Promedio</p>
                    <p className="text-white font-black text-lg font-mono mt-1">$127.500</p>
                  </div>
                  <div className="hidden md:block bg-gray-800/60 rounded-xl p-3 border border-gray-700/50">
                    <p className="text-blue-300 text-[8px] font-bold uppercase tracking-wider">Rake / Hora</p>
                    <p className="text-white font-black text-lg font-mono mt-1">$45.200</p>
                  </div>
                  <div className="hidden md:block bg-gray-800/60 rounded-xl p-3 border border-gray-700/50">
                    <p className="text-yellow-300 text-[8px] font-bold uppercase tracking-wider">Sesiones</p>
                    <p className="text-white font-black text-lg font-mono mt-1">24</p>
                  </div>
                </div>

                {/* Action buttons simulados */}
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                  {['💰 Buy-in', '💸 Cashout', '🎁 Bono', '🍺 Gasto', '🎁 Jackpot', '🤝 Propina'].map((label, i) => (
                    <div key={i} className={`text-center py-2.5 rounded-xl text-[10px] font-bold border ${i === 0 ? 'bg-emerald-900/40 border-emerald-500/30 text-emerald-300' : i === 1 ? 'bg-rose-900/30 border-rose-500/20 text-rose-300' : 'bg-gray-800/60 border-gray-700/50 text-gray-400'}`}>
                      {label}
                    </div>
                  ))}
                </div>

                {/* Player table simulada */}
                <div className="bg-gray-800/40 rounded-xl border border-gray-700/50 overflow-hidden">
                  <div className="px-4 py-2 border-b border-gray-700/50 flex justify-between items-center">
                    <span className="text-white text-xs font-bold">Jugadores en Mesa</span>
                    <span className="text-emerald-400 text-[10px] font-bold">5 activos</span>
                  </div>
                  <div className="divide-y divide-gray-800/50">
                    {[
                      { name: 'Carlos M.', buyin: '$200.000', balance: '+$85.000', color: 'text-green-400' },
                      { name: 'Andrea R.', buyin: '$150.000', balance: '-$45.000', color: 'text-red-400' },
                      { name: 'Miguel S.', buyin: '$300.000', balance: '+$120.000', color: 'text-green-400' },
                    ].map((p, i) => (
                      <div key={i} className="flex justify-between items-center px-4 py-2 text-xs">
                        <span className="text-gray-300 font-bold">{p.name}</span>
                        <span className="text-gray-500 font-mono">{p.buyin}</span>
                        <span className={`font-mono font-bold ${p.color}`}>{p.balance}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Evento en vivo: la mesa nunca está quieta */}
                <LiveDemoChip />
              </div>
            </div>
          </div>
        </div>
        </div>
      </section>

      {/* DOLORES — "esto te pasa a ti" antes de la lista de funciones */}
      <section className="py-24 px-6 relative">
        <div className="max-w-5xl mx-auto">
          <AnimatedSection className="text-center mb-14">
            <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest mb-3">¿Te suena?</p>
            <h2 className="font-display text-3xl md:text-4xl font-bold text-white">Las tres cosas que todo club sufre</h2>
          </AnimatedSection>
          {/* Tres cartas repartidas sobre la mesa: cada dolor es una mano que
              el dueño ya jugó. Rotación leve que se endereza al pasar. */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-5">
            {pains.map((it, i) => (
              <AnimatedSection key={i} animation={`animate-fade-up delay-${(i + 1) * 100}`}>
                <div
                  className={`relative h-full bg-gradient-to-b from-gray-800/60 to-gray-900/80 border border-gray-700/60 rounded-2xl p-6 pt-14 shadow-xl shadow-black/30 transition-transform duration-500 hover:-translate-y-1 hover:rotate-0 ${['md:-rotate-2', 'md:rotate-1', 'md:rotate-2'][i]}`}
                >
                  <span className="absolute top-4 left-5 text-2xl leading-none select-none" aria-hidden="true">
                    <span className={i === 1 ? 'text-red-400/80' : 'text-gray-500'}>{['♠', '♥', '♣'][i]}</span>
                  </span>
                  <span className="absolute top-4 right-5 font-display font-bold text-gray-600 text-sm select-none" aria-hidden="true">{i + 1}</span>
                  <p className="font-display text-white font-bold text-xl leading-snug mb-3">{it.pain}</p>
                  <p className="text-gray-400 text-sm leading-relaxed">{it.fix}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="py-24 px-6 relative">
        <div className="max-w-6xl mx-auto">
          <AnimatedSection className="text-center mb-16">
            <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest mb-3">Funcionalidades</p>
            <h2 className="font-display text-3xl md:text-4xl font-bold text-white">Todo lo que necesita tu club</h2>
            <div className="w-16 h-1 bg-gradient-to-r from-emerald-500 to-cyan-500 rounded-full mx-auto mt-4"></div>
          </AnimatedSection>

          {/* Bento: los dos pilares (control financiero, torneos) grandes con
              viñeta de producto dibujada; el resto compacto. Nada de seis
              cards iguales. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Pilar 1: la cuenta que cuadra */}
            <AnimatedSection animation="animate-fade-up delay-100">
              <div className="group h-full bg-gray-800/30 border border-emerald-500/25 rounded-2xl p-6 hover:border-emerald-500/50 transition-all duration-500 hover:shadow-2xl hover:shadow-emerald-500/10">
                <h3 className="font-display text-white font-bold text-xl mb-2">{features[0].title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed mb-5">{features[0].desc}</p>
                {/* Viñeta: la ecuación del cierre */}
                <div className="bg-gray-900/70 border border-gray-700/60 rounded-xl p-4 font-mono text-sm space-y-1.5">
                  <div className="flex justify-between text-gray-400"><span>Rake bruto</span><span className="text-white">$ 1.240.000</span></div>
                  <div className="flex justify-between text-gray-400"><span>− Dealers y cortesías</span><span className="text-red-300">$ 310.000</span></div>
                  <div className="flex justify-between border-t border-gray-700/60 pt-1.5 font-bold"><span className="text-gray-300">= Neto a repartir</span><span className="text-emerald-300">$ 930.000</span></div>
                  <p className="text-[10px] text-emerald-400/80 font-sans font-bold pt-1">✓ La caja cuadró al peso</p>
                </div>
              </div>
            </AnimatedSection>

            {/* Pilar 2: torneos */}
            <AnimatedSection animation="animate-fade-up delay-200">
              <div className="group h-full bg-gray-800/30 border border-violet-500/25 rounded-2xl p-6 hover:border-violet-500/50 transition-all duration-500 hover:shadow-2xl hover:shadow-violet-500/10">
                <h3 className="font-display text-white font-bold text-xl mb-2">{features[1].title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed mb-5">{features[1].desc}</p>
                {/* Viñeta: el reloj del torneo */}
                <div className="bg-gray-900/70 border border-violet-500/30 rounded-xl p-4 text-center">
                  <p className="text-[10px] text-violet-300 font-bold uppercase tracking-[0.25em]">Nivel 4 / 14</p>
                  <p className="font-mono font-black text-4xl text-white tabular-nums my-1">08:42</p>
                  <p className="text-xs text-gray-400 font-mono">Blinds 400 / 800 · <span className="text-gray-500">sigue 500/1.000</span></p>
                  <div className="mt-3 h-1 rounded-full bg-gray-800 overflow-hidden"><div className="h-full w-2/3 bg-violet-500/80 rounded-full" /></div>
                </div>
              </div>
            </AnimatedSection>

            {/* Los otros cuatro, compactos en fila */}
            <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {features.slice(2).map((f, i) => (
                <AnimatedSection key={i} animation={`animate-fade-up delay-${(i + 1) * 100}`}>
                  <div className={`h-full bg-gray-800/30 border border-gray-700/50 rounded-2xl p-5 hover:border-gray-600 transition-all duration-500 group cursor-default hover:-translate-y-1`}>
                    <div className={`w-10 h-10 ${f.bg} border ${f.border} rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-300`}>
                      <f.icon className={`w-5 h-5 ${f.color}`} />
                    </div>
                    <h3 className="text-white font-bold text-base mb-1.5">{f.title}</h3>
                    <p className="text-gray-400 text-[13px] leading-relaxed">{f.desc}</p>
                  </div>
                </AnimatedSection>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="py-24 px-6 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-gray-900/50 to-transparent pointer-events-none"></div>

        <div className="max-w-4xl mx-auto relative z-10">
          <AnimatedSection className="text-center mb-16">
            <p className="text-violet-400 text-xs font-bold uppercase tracking-widest mb-3">Como funciona</p>
            <h2 className="font-display text-3xl md:text-4xl font-bold text-white">Listo en 3 pasos</h2>
            <div className="w-16 h-1 bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-full mx-auto mt-4"></div>
          </AnimatedSection>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            {/* Connecting line (desktop) */}
            <div className="hidden md:block absolute top-12 left-[16%] right-[16%] h-px bg-gradient-to-r from-violet-500/30 via-fuchsia-500/30 to-violet-500/30"></div>

            {steps.map((s, i) => (
              <AnimatedSection key={i} animation={`animate-scale-in delay-${(i + 1) * 200}`} className="text-center relative">
                <div className="relative inline-block mb-6">
                  <div className="w-20 h-20 bg-violet-500/10 border border-violet-500/20 rounded-2xl flex items-center justify-center mx-auto group hover:bg-violet-500/20 transition-all duration-500 hover:scale-110 hover:rotate-6 cursor-default">
                    <span className="text-3xl">{s.emoji}</span>
                  </div>
                  <div className="absolute -top-2 -right-2 w-7 h-7 bg-violet-600 rounded-lg flex items-center justify-center shadow-lg shadow-violet-900/50">
                    <span className="text-white font-mono font-black text-xs">{s.number}</span>
                  </div>
                </div>
                <h3 className="text-white font-black text-lg mb-2">{s.title}</h3>
                <p className="text-gray-400 text-sm">{s.desc}</p>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <AnimatedSection className="text-center mb-16">
            <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest mb-3">Planes</p>
            <h2 className="font-display text-3xl md:text-4xl font-bold text-white">Menos de lo que deja una buena noche</h2>
            <p className="text-gray-400 text-sm mt-3 max-w-md mx-auto">Un solo plan con todo. Lo pruebas gratis 14 días con tu operación real y decides.</p>
            <div className="w-16 h-1 bg-gradient-to-r from-emerald-500 to-cyan-500 rounded-full mx-auto mt-4"></div>
          </AnimatedSection>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start max-w-3xl mx-auto">
            {plans.map((plan, i) => (
              <AnimatedSection key={i} animation={`animate-fade-up delay-${(i + 1) * 100}`}>
                <div className={`bg-gray-800/40 border ${plan.color} rounded-2xl p-6 relative flex flex-col transition-all duration-500 hover:-translate-y-2 hover:shadow-2xl ${plan.popular ? 'ring-1 ring-emerald-500/30 md:-mt-4 md:mb-4 shadow-xl shadow-emerald-900/10' : ''}`}>
                  {plan.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white text-[10px] font-black uppercase tracking-widest px-4 py-1 rounded-full shadow-lg shadow-emerald-900/30">
                      Popular
                    </div>
                  )}
                  <div className="mb-6">
                    <h3 className="text-white font-black text-xl mb-1">{plan.name}</h3>
                    <p className="text-gray-500 text-xs">{plan.desc}</p>
                  </div>
                  <div className="mb-6">
                    <span className="text-4xl font-black text-white font-mono">{plan.price}</span>
                    {plan.period && <span className="text-gray-500 text-sm">{plan.period}</span>}
                  </div>
                  <ul className="space-y-3 mb-8 flex-1">
                    {plan.features.map((feat, j) => (
                      <li key={j} className="flex items-center gap-2 text-sm text-gray-300">
                        <CheckIcon className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                        {feat}
                      </li>
                    ))}
                  </ul>
                  {plan.price === 'Contacto' ? (
                    <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className={`w-full py-3.5 rounded-xl font-bold text-sm uppercase tracking-wider text-center transition-all active:scale-[0.98] flex items-center justify-center gap-2 hover:-translate-y-0.5 ${plan.btn}`}>
                      <WhatsAppIcon className="w-4 h-4" /> Contactar
                    </a>
                  ) : (
                    <>
                      <Link to="/register" className={`w-full py-3.5 rounded-xl font-bold text-sm uppercase tracking-wider text-center transition-all active:scale-[0.98] block hover:-translate-y-0.5 ${plan.btn}`}>
                        Probar 14 días gratis
                      </Link>
                      <p className="text-center text-[11px] text-gray-500 mt-2">Sin tarjeta · cancelas cuando quieras</p>
                    </>
                  )}
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ — las objeciones respondidas donde nacen */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto">
          <AnimatedSection className="text-center mb-12">
            <p className="text-cyan-400 text-xs font-bold uppercase tracking-widest mb-3">Preguntas frecuentes</p>
            <h2 className="font-display text-3xl md:text-4xl font-bold text-white">Lo que todo dueño pregunta</h2>
          </AnimatedSection>
          <div className="space-y-3">
            {FAQ.map((f, i) => (
              <AnimatedSection key={i} animation="animate-fade-up">
                <details className="group bg-gray-800/30 border border-gray-700/50 rounded-2xl open:border-emerald-500/30 transition-colors">
                  <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-4 px-6 py-4 min-h-14 text-white font-bold text-sm md:text-base">
                    {f.q}
                    <span className="shrink-0 text-emerald-400 transition-transform group-open:rotate-45 text-xl leading-none" aria-hidden="true">+</span>
                  </summary>
                  <p className="px-6 pb-5 text-gray-400 text-sm leading-relaxed">{f.a}</p>
                </details>
              </AnimatedSection>
            ))}
          </div>
          <p className="text-center text-sm text-gray-500 mt-8">
            ¿Otra pregunta? <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300 font-bold">Escríbenos por WhatsApp</a> — respondemos personas, no bots.
          </p>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="py-24 px-6">
        <AnimatedSection>
          <div className="max-w-3xl mx-auto text-center bg-gradient-to-br from-emerald-900/30 via-cyan-900/10 to-violet-900/20 border border-emerald-500/20 rounded-3xl p-12 md:p-16 relative overflow-hidden group hover:border-emerald-500/30 transition-all duration-700">
            {/* Background effects */}
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-1000">
              <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl"></div>
              <div className="absolute bottom-0 left-0 w-64 h-64 bg-violet-500/5 rounded-full blur-3xl"></div>
            </div>

            <div className="relative z-10">
              <div className="text-5xl mb-6 animate-float">♠️</div>
              <h2 className="font-display text-3xl md:text-4xl font-bold text-white mb-4">
                Deja de contar fichas a mano
              </h2>
              <p className="text-gray-400 text-lg mb-8 max-w-xl mx-auto">
                Pruébalo esta misma semana con tu operación real: abre una mesa, cierra la caja y mira cómo cuadra. En 2 minutos estás adentro.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
                <Link to="/register" className="group/btn inline-flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold text-lg px-10 py-4 rounded-xl shadow-[0_0_30px_rgba(16,185,129,0.3)] hover:shadow-[0_0_50px_rgba(16,185,129,0.5)] transition-all active:scale-[0.98]">
                  Crear mi club gratis <ArrowRightIcon className="w-5 h-5 group-hover/btn:translate-x-1 transition-transform" />
                </Link>
                <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="group/wa inline-flex items-center gap-2 bg-gray-800/60 hover:bg-gray-700/80 text-gray-300 hover:text-white font-bold text-lg px-10 py-4 rounded-xl border border-gray-700 hover:border-emerald-500/40 transition-all active:scale-[0.98] backdrop-blur-sm">
                  <WhatsAppIcon className="w-5 h-5 text-emerald-400 group-hover/wa:scale-110 transition-transform" /> Agendar una demo
                </a>
              </div>
            </div>
          </div>
        </AnimatedSection>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-gray-800/50 py-10 pb-28 sm:pb-10 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/rakeflow-logo.svg" alt="" className="w-5 h-5 rounded" />
            <span className="text-gray-500 font-bold text-sm uppercase tracking-wider">
              Rake<span className="text-emerald-500">Flow</span>
            </span>
          </div>
          <div className="flex items-center gap-6 text-gray-600 text-xs flex-wrap justify-center">
            <a href="#features" className="hover:text-gray-300 transition-colors">Funciones</a>
            <a href="#pricing" className="hover:text-gray-300 transition-colors">Planes</a>
            <Link to="/login" className="hover:text-gray-300 transition-colors">Acceder</Link>
            <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="hover:text-emerald-400 transition-colors flex items-center gap-1"><WhatsAppIcon className="w-3.5 h-3.5" /> WhatsApp</a>
            <a href="mailto:soporte@rakeflow.site" className="hover:text-gray-300 transition-colors">Soporte</a>
            <Link to="/terms" className="hover:text-gray-300 transition-colors">Términos</Link>
            <Link to="/privacy" className="hover:text-gray-300 transition-colors">Privacidad</Link>
          </div>
          <p className="text-gray-700 text-xs">&copy; 2026 RakeFlow</p>
        </div>
      </footer>

      {/* CTA móvil fijo: pasada la primera pantalla, la oferta viaja contigo */}
      <div className={`sm:hidden fixed bottom-0 inset-x-0 z-50 transition-transform duration-300 ${showMobileCta ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="flex gap-2 px-3 pt-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))] bg-[#0a0f1a]/95 backdrop-blur-xl border-t border-gray-800">
          <Link to="/register" className="flex-1 min-h-12 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-bold text-sm uppercase tracking-wide flex items-center justify-center gap-2 active:scale-[0.98]">
            Probar 14 días gratis
          </Link>
          <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" aria-label="Hablar por WhatsApp"
            className="min-h-12 min-w-12 rounded-xl bg-[#25D366] text-white flex items-center justify-center active:scale-95">
            <WhatsAppIcon className="w-6 h-6" />
          </a>
        </div>
      </div>

      {/* WhatsApp FAB — contacto de ventas siempre visible (desktop) */}
      <a
        href={WHATSAPP_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Agendar demo por WhatsApp"
        className="group/fab hidden sm:flex fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-6 z-50 items-center gap-2.5 bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold rounded-full pl-4 pr-5 py-3.5 shadow-[0_8px_30px_rgba(37,211,102,0.4)] hover:shadow-[0_8px_45px_rgba(37,211,102,0.65)] hover:-translate-y-0.5 transition-all duration-300 active:scale-95"
      >
        <span className="absolute inset-0 rounded-full bg-[#25D366] animate-ping opacity-20 group-hover/fab:opacity-0"></span>
        <WhatsAppIcon className="w-6 h-6 relative z-10 shrink-0" />
        <span className="hidden sm:inline relative z-10 text-sm whitespace-nowrap">Agendar demo</span>
      </a>
    </div>
  );
}
