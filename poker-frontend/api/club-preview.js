// Preview por club del link público (/c/{token}) para los crawlers de
// WhatsApp/Facebook/Twitter, que NO ejecutan JavaScript: sin esto leen las
// metas estáticas del index.html y el preview sale como publicidad de
// RakeFlow en vez de la invitación del CLUB.
//
// Cómo: vercel.json reescribe /c/:token → esta función. Se toma el shell del
// SPA del propio deploy (mismos assets con hash), se reemplazan título/OG/
// twitter por los del club (nombre + anuncio o actividad en vivo + imagen de
// fieltro) y se devuelve el MISMO HTML — el navegador hidrata la app igual
// que siempre; solo cambian las metas. Si algo falla, se sirve el shell tal
// cual: la página nunca se rompe por culpa del preview.

const BACKEND = 'https://rakeflow-production.up.railway.app';

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const attr = (html, re, value) => html.replace(re, `$1${value}$2`);

export default async function handler(req, res) {
  const token = (req.query?.token || '').toString();
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'rakeflow.site';
  const origin = `https://${host}`;

  // Shell del SPA desde el propio deploy (así los <script> con hash siempre
  // son los del build vigente, sin duplicar el index en la función).
  let html;
  try {
    const r = await fetch(`${origin}/index.html`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`shell ${r.status}`);
    html = await r.text();
  } catch {
    // Sin shell no hay página: mandar al home (el preview saldrá genérico).
    res.statusCode = 302;
    res.setHeader('Location', '/');
    res.end();
    return;
  }

  // Datos públicos del club (mismo endpoint que usa la página; sin auth).
  // Token con forma inválida ni se consulta. Si falla → shell sin tocar.
  let club = null;
  if (/^[A-Za-z0-9_-]{8,64}$/.test(token)) {
    try {
      const r = await fetch(`${BACKEND}/public/clubs/${token}/activity`, { signal: AbortSignal.timeout(4000) });
      if (r.ok) club = await r.json();
    } catch { /* preview genérico */ }
  }

  if (club?.club_name) {
    const name = esc(club.club_name);
    const title = `${name} · Poker en vivo ♠`;
    const url = `${origin}/c/${esc(token)}`;
    const img = `${origin}/og-club.jpg`;

    // Descripción: el anuncio del club manda; si no, la actividad en vivo;
    // si la sala está cerrada, copy evergreen que invita igual.
    const mesas = (club.cash || []).length;
    const sillas = (club.cash || []).reduce((a, c) => a + (c.seats_available || 0), 0);
    const torneos = (club.tournaments || []).length;
    const vivo = [];
    if (mesas > 0) vivo.push(`${mesas} mesa${mesas !== 1 ? 's' : ''} en juego`);
    if (sillas > 0) vivo.push(`${sillas} silla${sillas !== 1 ? 's' : ''} libre${sillas !== 1 ? 's' : ''}`);
    if (torneos > 0) vivo.push(`torneo en curso`);
    const desc = esc(
      club.announcement
        ? `${club.announcement} — mirá la sala en vivo: mesas, sillas libres y torneos.`
        : vivo.length
          ? `🟢 Ahora: ${vivo.join(' · ')}. Tocá y mirá la sala en vivo.`
          : 'Mesas, sillas libres y torneos, en vivo. Guardá el link: cuando la sala abra, acá la ves primero.'
    );

    html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
    html = attr(html, /(<meta name="description" content=")[^"]*(")/, desc);
    html = attr(html, /(<meta property="og:site_name" content=")[^"]*(")/, name);
    html = attr(html, /(<meta property="og:title" content=")[^"]*(")/, esc(title));
    html = attr(html, /(<meta property="og:description" content=")[^"]*(")/, desc);
    html = attr(html, /(<meta property="og:url" content=")[^"]*(")/, url);
    html = attr(html, /(<meta property="og:image" content=")[^"]*(")/, img);
    html = attr(html, /(<meta name="twitter:title" content=")[^"]*(")/, esc(title));
    html = attr(html, /(<meta name="twitter:description" content=")[^"]*(")/, desc);
    html = attr(html, /(<meta name="twitter:image" content=")[^"]*(")/, img);
    html = attr(html, /(<link rel="canonical" href=")[^"]*(")/, url);
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Cache corto en el edge por URL (= por club): aguanta ráfagas de crawlers
  // sin pegarle al backend, y los conteos "en vivo" no envejecen mal.
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=1800');
  res.end(html);
}
