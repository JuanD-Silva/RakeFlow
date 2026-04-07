import { useEffect, useState } from 'react';
import api from '../api/axios';

/**
 * Pagina que se carga dentro del iframe sandboxed en Subscribe.
 * Usa external: 'true' para que ePayco tome toda la pagina del iframe.
 * El sandbox del iframe padre bloquea la navegacion top-level,
 * asi que todos los redirects de ePayco quedan contenidos aqui.
 */
export default function CheckoutFrame() {
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    async function initCheckout() {
      try {
        const { data: config } = await api.get('/payments/config');
        if (!mounted) return;

        const script = document.createElement('script');
        script.src = 'https://checkout.epayco.co/checkout.js';
        script.onload = () => {
          if (!mounted || !window.ePayco) {
            if (mounted) setError('No se pudo cargar ePayco.');
            return;
          }

          const handler = window.ePayco.checkout.configure({
            key: config.public_key,
            test: config.test
          });

          const backendUrl = import.meta.env.VITE_API_URL || window.location.origin.replace('5173', '8000');

          handler.open({
            name: config.plan_name,
            description: 'Suscripcion mensual RakeFlow Pro',
            invoice: `RF-${config.club_id}-${Date.now()}`,
            currency: 'cop',
            amount: String(config.plan_price),
            tax_base: '0',
            tax: '0',
            country: 'co',
            lang: 'es',
            external: 'true',
            extra1: String(config.club_id),
            extra2: config.club_email,
            extra3: config.club_name,
            confirmation: backendUrl + '/payments/webhook',
            response: window.location.origin + '/payment-callback',
            name_billing: config.club_name,
            email_billing: config.club_email,
            type_doc_billing: 'CC',
          });
        };

        script.onerror = () => {
          if (mounted) setError('Error cargando la pasarela de pagos.');
        };

        document.body.appendChild(script);
      } catch {
        if (mounted) setError('Error conectando con el servidor.');
      }
    }

    initCheckout();
    return () => { mounted = false; };
  }, []);

  if (error) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#0a0f1a', fontFamily: 'system-ui, sans-serif',
      }}>
        <p style={{ color: '#f87171', textAlign: 'center', padding: 20 }}>{error}</p>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: '#0a0f1a', fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          border: '3px solid rgba(16,185,129,0.2)',
          borderTopColor: '#10b981',
          animation: 'spin 1s linear infinite',
          margin: '0 auto 16px',
        }} />
        <p style={{ color: '#9ca3af' }}>Cargando pasarela de pagos...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>
  );
}
