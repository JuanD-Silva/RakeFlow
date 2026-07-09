import { toPng } from 'html-to-image';

// Convierte un nodo del DOM en PNG y lo comparte como IMAGEN (no como link):
// Web Share API con el archivo cuando el dispositivo lo soporta, con fallback a
// descarga del PNG. Es el mecanismo detrás de toda card compartible del panel
// (mi mes, estatus VIP, reto del mes, logros) — el logro viaja como imagen con
// alma, no como un texto promocionando la app.
//
// Devuelve 'shared' | 'downloaded'. Propaga AbortError (cancelación del usuario)
// y cualquier error real para que el llamador decida el fallback de texto.
export async function shareCardImage(node, { shareText, fileName }) {
  const dataUrl = await toPng(node, { pixelRatio: 2, cacheBust: true });
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], fileName, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], text: shareText });
    return 'shared';
  }
  // Escritorio / navegadores sin Web Share de archivos: descarga + el llamador
  // ofrece el botón de WhatsApp con el texto.
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = fileName;
  a.click();
  return 'downloaded';
}
