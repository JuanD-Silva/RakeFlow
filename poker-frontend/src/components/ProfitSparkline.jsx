import { useId } from 'react';

// Sparkline SVG casero del profit acumulado del jugador. La curva llega lista
// del backend (my-sessions.profit_curve, orden cronológico) — acá solo se
// dibuja: nada de libs de charts para ~50 líneas de SVG.
export default function ProfitSparkline({ points, height = 72 }) {
  const gradId = useId();
  if (!points || points.length < 2) return null;

  // Con cientos de sesiones el path se vuelve pesado sin aportar detalle
  // visible: se muestrea conservando siempre el último punto.
  let pts = points;
  if (pts.length > 120) {
    const step = Math.ceil(pts.length / 120);
    pts = pts.filter((_, i) => i % step === 0);
    if (pts[pts.length - 1] !== points[points.length - 1]) pts.push(points[points.length - 1]);
  }

  const W = 320, H = height, PAD = 5;
  const min = Math.min(0, ...pts);
  const max = Math.max(0, ...pts);
  const span = max - min || 1;
  const x = (i) => PAD + (i * (W - 2 * PAD)) / (pts.length - 1);
  const y = (v) => PAD + ((max - v) * (H - 2 * PAD)) / span;

  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const zeroY = y(0);
  // El relleno va entre la curva y la línea de cero (no el borde inferior):
  // así "área verde arriba / roja abajo" se lee como ganancia vs pérdida.
  const area = `${line} L${x(pts.length - 1).toFixed(1)} ${zeroY.toFixed(1)} L${x(0).toFixed(1)} ${zeroY.toFixed(1)} Z`;
  const last = pts[pts.length - 1];
  const color = last >= 0 ? '#34d399' : '#f87171';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Curva de resultado acumulado">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.04" />
        </linearGradient>
      </defs>
      <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="#4b5563" strokeWidth="1" strokeDasharray="3 3" />
      <path d={area} fill={`url(#${gradId})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(pts.length - 1)} cy={y(last)} r="3" fill={color} />
    </svg>
  );
}
