import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Pagina a la que ePayco redirige despues del pago.
 * Si esta dentro de un iframe, envia postMessage al padre (Subscribe).
 * Si esta en una pestaña normal, redirige a /payment-success.
 */
export default function PaymentCallback() {
  const [searchParams] = useSearchParams();
  const refPayco = searchParams.get('ref_payco') || '';
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const isInIframe = window.parent !== window;

    if (isInIframe) {
      // Enviar mensaje al padre (Subscribe.jsx)
      window.parent.postMessage({
        type: 'EPAYCO_PAYMENT_COMPLETE',
        ref_payco: refPayco,
      }, window.location.origin);

      setSent(true);

      // Reintentar por si el padre no estaba escuchando
      const retry = setInterval(() => {
        window.parent.postMessage({
          type: 'EPAYCO_PAYMENT_COMPLETE',
          ref_payco: refPayco,
        }, window.location.origin);
      }, 1000);

      return () => clearInterval(retry);
    } else {
      // Si no esta en iframe, redirigir directamente
      const target = refPayco
        ? `/payment-success?ref_payco=${refPayco}`
        : '/payment-success';
      window.location.href = target;
    }
  }, [refPayco]);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: '#0a0f1a',
      color: '#9ca3af',
      fontFamily: 'system-ui, sans-serif',
      textAlign: 'center',
    }}>
      <div>
        <div style={{
          width: 60, height: 60, borderRadius: 16,
          background: 'rgba(16,185,129,0.1)',
          border: '1px solid rgba(16,185,129,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 16px', fontSize: 28,
        }}>
          ✓
        </div>
        <p style={{ color: '#e5e7eb', fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
          Pago procesado
        </p>
        <p style={{ color: '#6b7280', fontSize: 14 }}>
          {sent ? 'Cerrando ventana de pago...' : 'Redirigiendo...'}
        </p>
      </div>
    </div>
  );
}
