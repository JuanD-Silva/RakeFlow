// Passkeys (huella/cara) con la API nativa WebAuthn, sin librerías.
// El backend (py_webauthn) manda las opciones en JSON con los binarios en
// base64url; acá se convierten a ArrayBuffer para el navegador y la respuesta
// del teléfono se serializa de vuelta. (PublicKeyCredential.toJSON y
// parseCreationOptionsFromJSON no existen en iOS 16, por eso va a mano.)

const FLAG = 'rf_passkey';             // {id: credential_id|null} — este celular tiene huella activa
const DISMISSED = 'rf_passkey_dismissed'; // timestamp del "Ahora no"
const REOFFER_MS = 30 * 24 * 3600 * 1000;

export function b64urlToBuf(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export function bufToB64url(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ¿Este dispositivo tiene huella/cara utilizable? (no llaves USB ni QR)
// Las passkeys quedan atadas a rakeflow.site (RP ID del backend): en otro
// dominio (p.ej. el *.vercel.app) fallarían, así que ni se ofrecen.
const PASSKEY_HOST = (h) => h === 'rakeflow.site' || h.endsWith('.rakeflow.site') || h === 'localhost';

export async function passkeyAvailable() {
  try {
    return PASSKEY_HOST(window.location.hostname)
      && Boolean(window.PublicKeyCredential)
      && await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function createPasskey(options) {
  const publicKey = {
    ...options,
    challenge: b64urlToBuf(options.challenge),
    user: { ...options.user, id: b64urlToBuf(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map((c) => ({ ...c, id: b64urlToBuf(c.id) })),
  };
  const cred = await navigator.credentials.create({ publicKey });
  return {
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bufToB64url(cred.response.clientDataJSON),
      attestationObject: bufToB64url(cred.response.attestationObject),
      transports: cred.response.getTransports?.() || [],
    },
    clientExtensionResults: cred.getClientExtensionResults?.() || {},
    authenticatorAttachment: cred.authenticatorAttachment || undefined,
  };
}

export async function getPasskey(options) {
  const publicKey = {
    ...options,
    challenge: b64urlToBuf(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((c) => ({ ...c, id: b64urlToBuf(c.id) })),
  };
  const cred = await navigator.credentials.get({ publicKey });
  return {
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: cred.type,
    response: {
      authenticatorData: bufToB64url(cred.response.authenticatorData),
      clientDataJSON: bufToB64url(cred.response.clientDataJSON),
      signature: bufToB64url(cred.response.signature),
      userHandle: cred.response.userHandle ? bufToB64url(cred.response.userHandle) : null,
    },
    clientExtensionResults: cred.getClientExtensionResults?.() || {},
    authenticatorAttachment: cred.authenticatorAttachment || undefined,
  };
}

// La persona canceló o el sistema no dejó (sin huella registrada, tiempo agotado).
export const isCancel = (e) => e?.name === 'NotAllowedError' || e?.name === 'AbortError';

// Marca local: el botón "Entrar con huella" del login solo aparece en el
// celular donde se activó (en un PC o en el celular de otra persona no estorba).
// Todo con try/catch: Safari privado puede lanzar al tocar localStorage.
export const localPasskey = {
  get() {
    try { return JSON.parse(localStorage.getItem(FLAG) || 'null'); } catch { return null; }
  },
  set(value) {
    try { localStorage.setItem(FLAG, JSON.stringify(value)); } catch { /* sin storage: sin botón */ }
    window.dispatchEvent(new Event('rf-passkey'));
  },
  clear() {
    try { localStorage.removeItem(FLAG); } catch { /* nada que limpiar */ }
  },
  dismissedRecently() {
    try {
      const at = Number(localStorage.getItem(DISMISSED) || 0);
      return at > 0 && Date.now() - at < REOFFER_MS;
    } catch { return false; }
  },
  dismiss() {
    try { localStorage.setItem(DISMISSED, String(Date.now())); } catch { /* ok */ }
  },
};

// Mensaje del backend ({detail: {code, message}}) o uno genérico.
export function passkeyError(err, fallback) {
  const d = err?.response?.data?.detail;
  return { code: d?.code || null, message: d?.message || fallback };
}
