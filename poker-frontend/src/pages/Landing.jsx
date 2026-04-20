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

const features = [
  { icon: BanknotesIcon, title: 'Control de Rake', desc: 'Registra buy-ins, cashouts, propinas y gastos en tiempo real. Calcula el rake automaticamente al cerrar cada sesion.', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', glow: 'group-hover:shadow-emerald-500/10' },
  { icon: TrophyIcon, title: 'Gestion de Torneos', desc: 'Crea torneos con estructura de premios, rebuys, add-ons y asigna ganadores con un solo toque.', color: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20', glow: 'group-hover:shadow-violet-500/10' },
  { icon: ChartBarIcon, title: 'Reportes Financieros', desc: 'Visualiza ingresos semanales y mensuales. Controla metas, distribuciones a socios y fondos operativos.', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20', glow: 'group-hover:shadow-blue-500/10' },
  { icon: UserGroupIcon, title: 'Gestion de Jugadores', desc: 'Base de datos de jugadores con historial, ranking mensual de ganadores, consumidores y tiempo en mesa.', color: 'text-pink-400', bg: 'bg-pink-500/10', border: 'border-pink-500/20', glow: 'group-hover:shadow-pink-500/10' },
  { icon: Cog6ToothIcon, title: 'Reglas Personalizables', desc: 'Define como se reparte el dinero: montos fijos, porcentajes o metas mensuales. Cambia las reglas cuando quieras.', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', glow: 'group-hover:shadow-amber-500/10' },
  { icon: ShieldCheckIcon, title: 'Auditoria y Cierre', desc: 'Sistema de auditoria pre-cierre que detecta descuadres antes de cerrar caja. Sin sorpresas.', color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', glow: 'group-hover:shadow-cyan-500/10' }
];

const steps = [
  { number: '01', title: 'Crea tu Club', desc: 'Registrate con tu email en menos de 30 segundos.', emoji: '♠️' },
  { number: '02', title: 'Configura las Reglas', desc: 'Define tu meta mensual y como se reparten las ganancias.', emoji: '♦️' },
  { number: '03', title: 'Abre tu Primera Mesa', desc: 'Registra jugadores, buy-ins y empieza a controlar el rake.', emoji: '♣️' },
];

const plans = [
  { name: 'Pro', price: '$49.900', period: '/mes', desc: 'Para clubes activos', popular: true, color: 'border-emerald-500/50', btn: 'bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white shadow-lg shadow-emerald-900/30', features: ['Mesas ilimitadas', 'Jugadores ilimitados', 'Reportes avanzados', 'Torneos ilimitados', 'Soporte prioritario', 'Multi-usuario (cajeros)', '7 dias de prueba gratis'] },
  { name: 'Enterprise', price: 'Contacto', period: '', desc: 'Para cadenas de clubes', color: 'border-violet-500/50', btn: 'bg-violet-700 hover:bg-violet-600 text-white', features: ['Todo de Pro', 'Multi-sede', 'API personalizada', 'Dashboard corporativo', 'Soporte dedicado', 'SLA garantizado'] }
];

function AnimatedSection({ children, className = '', animation = 'animate-fade-up' }) {
  const [ref, inView] = useInView();
  return (
    <div ref={ref} className={`${className} ${inView ? animation : 'opacity-0'}`}>
      {children}
    </div>
  );
}

export default function Landing() {
  const [scrollY, setScrollY] = useState(0);
  const [navSolid, setNavSolid] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrollY(window.scrollY);
      setNavSolid(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0f1a] text-gray-100 font-sans overflow-x-hidden relative noise-bg">

      {/* NAVBAR */}
      <nav className={`fixed top-0 w-full z-50 transition-all duration-500 ${navSolid ? 'bg-[#0a0f1a]/95 backdrop-blur-xl border-b border-gray-800/50 shadow-2xl shadow-black/20' : 'bg-transparent'}`}>
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 group cursor-pointer">
            <div className="bg-gradient-to-br from-emerald-600 to-green-900 p-1.5 rounded-lg border border-emerald-500/30 group-hover:shadow-lg group-hover:shadow-emerald-500/20 transition-all duration-300">
              <span className="text-lg leading-none">💸</span>
            </div>
            <span className="text-white font-black text-xl tracking-tighter uppercase">
              Rake<span className="text-emerald-500">Flow</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-gray-400 hover:text-white text-sm font-bold px-4 py-2 transition-colors relative after:absolute after:bottom-0 after:left-1/2 after:-translate-x-1/2 after:w-0 hover:after:w-full after:h-px after:bg-emerald-500 after:transition-all">
              Iniciar Sesion
            </Link>
            <Link to="/register" className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold px-5 py-2 rounded-lg transition-all shadow-lg shadow-emerald-900/20 hover:shadow-emerald-500/20 hover:-translate-y-0.5 active:translate-y-0">
              Crear Club Gratis
            </Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="pt-28 pb-24 px-6 relative min-h-[90vh] flex items-center">
        {/* Ambient background — parallax on scroll */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-20 left-1/4 w-[500px] h-[500px] bg-emerald-600/8 rounded-full blur-[120px] animate-drift" style={{ transform: `translate(${scrollY * 0.03}px, ${scrollY * -0.06}px)` }}></div>
          <div className="absolute bottom-10 right-1/4 w-[400px] h-[400px] bg-violet-600/8 rounded-full blur-[100px] animate-drift delay-700" style={{ transform: `translate(${scrollY * -0.04}px, ${scrollY * -0.03}px)` }}></div>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-cyan-500/5 rounded-full blur-[80px]" style={{ transform: `translate(-50%, -50%) scale(${1 + scrollY * 0.0003})` }}></div>

          {/* Floating card suits — parallax */}
          <div className="animate-orbit opacity-[0.04] text-6xl" style={{ position: 'absolute', top: '50%', left: '50%', transform: `translateY(${scrollY * -0.1}px)` }}>♠</div>
          <div className="animate-orbit opacity-[0.03] text-5xl" style={{ position: 'absolute', top: '50%', left: '50%', animationDuration: '25s', animationDirection: 'reverse', transform: `translateY(${scrollY * -0.07}px)` }}>♥</div>
          <div className="animate-orbit opacity-[0.03] text-4xl" style={{ position: 'absolute', top: '50%', left: '50%', animationDuration: '30s', transform: `translateY(${scrollY * -0.05}px)` }}>♦</div>

          {/* Grid lines — subtle parallax */}
          <div className="absolute inset-0 opacity-[0.02]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)', backgroundSize: '80px 80px', transform: `translateY(${scrollY * 0.02}px)` }}></div>
        </div>

        <div className="max-w-4xl mx-auto text-center relative z-10">
          <div className="animate-fade-up inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-5 py-2 mb-8 hover:bg-emerald-500/15 transition-colors cursor-default">
            <BoltIcon className="w-4 h-4 text-emerald-400 animate-pulse" />
            <span className="text-emerald-400 text-xs font-bold uppercase tracking-wider">Sistema de gestion para clubes de poker</span>
          </div>

          <h1 className="animate-fade-up delay-100 text-5xl md:text-7xl font-black text-white tracking-tight leading-[1.1] mb-6">
            Controla el{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-cyan-400 to-emerald-400 animate-shimmer" style={{ backgroundSize: '200% 100%' }}>
              rake
            </span>
            {' '}de tu club como un profesional
          </h1>

          <p className="animate-fade-up delay-200 text-gray-400 text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
            RakeFlow automatiza el cierre de caja, distribuye ganancias entre socios y te da visibilidad total sobre las finanzas de tu club de poker.
          </p>

          <div className="animate-fade-up delay-300 flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/register" className="group bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold text-lg px-8 py-4 rounded-xl shadow-[0_0_30px_rgba(16,185,129,0.3)] hover:shadow-[0_0_50px_rgba(16,185,129,0.4)] transition-all active:scale-[0.98] flex items-center justify-center gap-2 animate-pulse-glow">
              Probar 7 Dias Gratis <ArrowRightIcon className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <a href="#features" className="bg-gray-800/60 hover:bg-gray-700/80 text-gray-300 hover:text-white font-bold text-lg px-8 py-4 rounded-xl border border-gray-700 hover:border-gray-500 transition-all flex items-center justify-center gap-2 backdrop-blur-sm">
              Ver Funciones
            </a>
          </div>

          <div className="animate-fade-up delay-500 flex flex-wrap items-center justify-center gap-6 mt-10 text-gray-500 text-sm">
            <span className="flex items-center gap-1.5 hover:text-gray-300 transition-colors"><CheckIcon className="w-4 h-4 text-emerald-500" /> 7 dias de prueba gratis</span>
            <span className="flex items-center gap-1.5 hover:text-gray-300 transition-colors"><CheckIcon className="w-4 h-4 text-emerald-500" /> Listo en 2 minutos</span>
            <span className="flex items-center gap-1.5 hover:text-gray-300 transition-colors"><DeviceTabletIcon className="w-4 h-4 text-emerald-500" /> Funciona en tablet</span>
          </div>
        </div>

        {/* HERO MOCKUP — Browser frame con UI simulada */}
        <div className="max-w-5xl mx-auto mt-16 px-4 relative z-10 animate-fade-up delay-600" style={{ transform: `translateY(${scrollY * 0.04}px)` }}>
          <div className="relative group">
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
              </div>
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-fade-in-view delay-800">
          <div className="w-6 h-10 rounded-full border-2 border-gray-600 flex justify-center pt-2">
            <div className="w-1 h-3 bg-gray-500 rounded-full animate-bounce"></div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="py-24 px-6 relative">
        <div className="max-w-6xl mx-auto">
          <AnimatedSection className="text-center mb-16">
            <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest mb-3">Funcionalidades</p>
            <h2 className="text-3xl md:text-4xl font-black text-white tracking-tight">Todo lo que necesita tu club</h2>
            <div className="w-16 h-1 bg-gradient-to-r from-emerald-500 to-cyan-500 rounded-full mx-auto mt-4"></div>
          </AnimatedSection>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f, i) => (
              <AnimatedSection key={i} animation={`animate-fade-up delay-${(i + 1) * 100}`}>
                <div className={`bg-gray-800/30 border border-gray-700/50 rounded-2xl p-6 hover:border-gray-600 transition-all duration-500 group cursor-default hover:shadow-2xl ${f.glow} hover:-translate-y-1 relative overflow-hidden h-full`}>
                  {/* Hover glow effect */}
                  <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 ${f.bg} blur-3xl`}></div>

                  <div className="relative z-10">
                    <div className={`w-12 h-12 ${f.bg} border ${f.border} rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300`}>
                      <f.icon className={`w-6 h-6 ${f.color}`} />
                    </div>
                    <h3 className="text-white font-black text-lg mb-2 group-hover:text-emerald-50 transition-colors">{f.title}</h3>
                    <p className="text-gray-400 text-sm leading-relaxed group-hover:text-gray-300 transition-colors">{f.desc}</p>
                  </div>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="py-24 px-6 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-gray-900/50 to-transparent pointer-events-none"></div>

        <div className="max-w-4xl mx-auto relative z-10">
          <AnimatedSection className="text-center mb-16">
            <p className="text-violet-400 text-xs font-bold uppercase tracking-widest mb-3">Como funciona</p>
            <h2 className="text-3xl md:text-4xl font-black text-white tracking-tight">Listo en 3 pasos</h2>
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
            <h2 className="text-3xl md:text-4xl font-black text-white tracking-tight">Simple y transparente</h2>
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
                  <Link to="/register" className={`w-full py-3.5 rounded-xl font-bold text-sm uppercase tracking-wider text-center transition-all active:scale-[0.98] block hover:-translate-y-0.5 ${plan.btn}`}>
                    {plan.price === 'Contacto' ? 'Contactar' : 'Comenzar'}
                  </Link>
                </div>
              </AnimatedSection>
            ))}
          </div>
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
              <h2 className="text-3xl md:text-4xl font-black text-white tracking-tight mb-4">
                Deja de contar fichas a mano
              </h2>
              <p className="text-gray-400 text-lg mb-8 max-w-xl mx-auto">
                Unete a los clubes que ya gestionan sus finanzas con RakeFlow. Configuracion en menos de 2 minutos.
              </p>
              <Link to="/register" className="group/btn inline-flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold text-lg px-10 py-4 rounded-xl shadow-[0_0_30px_rgba(16,185,129,0.3)] hover:shadow-[0_0_50px_rgba(16,185,129,0.5)] transition-all active:scale-[0.98]">
                Crear Mi Club Gratis <ArrowRightIcon className="w-5 h-5 group-hover/btn:translate-x-1 transition-transform" />
              </Link>
            </div>
          </div>
        </AnimatedSection>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-gray-800/50 py-10 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-lg">💸</span>
            <span className="text-gray-500 font-bold text-sm uppercase tracking-wider">
              Rake<span className="text-emerald-500">Flow</span>
            </span>
          </div>
          <div className="flex items-center gap-6 text-gray-600 text-xs flex-wrap justify-center">
            <a href="#features" className="hover:text-gray-300 transition-colors">Funciones</a>
            <a href="#pricing" className="hover:text-gray-300 transition-colors">Planes</a>
            <Link to="/login" className="hover:text-gray-300 transition-colors">Acceder</Link>
            <Link to="/terms" className="hover:text-gray-300 transition-colors">Términos</Link>
            <Link to="/privacy" className="hover:text-gray-300 transition-colors">Privacidad</Link>
          </div>
          <p className="text-gray-700 text-xs">&copy; 2026 RakeFlow</p>
        </div>
      </footer>
    </div>
  );
}
