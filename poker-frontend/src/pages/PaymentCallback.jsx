import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { wompiService } from '../api/services';

/**
 * Pagina a la que Wompi redirige despues del checkout.
 * Wompi pasa: ?id=<transaction_id>&env=test|prod
 * El backend confirma con la API de Wompi y activa la suscripcion.
 */
export default function PaymentCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [statusText, setStatusText] = useState('Verificando pago...');
  const [error, setError] = useState(null);

  const transactionId = searchParams.get('id') || searchParams.get('transaction_id') || '';

  useEffect(() => {
    async function confirm() {
      if (!transactionId) {
        setError('No se recibio identificador de transaccion');
        return;
      }
      try {
        const res = await wompiService.confirmTransaction(transactionId);
        if (res.subscription_active) {
          localStorage.removeItem('rakeflow_wizard_done');
          navigate(`/payment-success?id=${encodeURIComponent(transactionId)}`);
          return;
        }
        // Pago no aprobado todavia (PENDING/DECLINED/etc)
        const status = res.wompi_status || 'PENDING';
        if (status === 'PENDING') {
          setStatusText('Pago en proceso, te confirmaremos cuando se acredite...');
          // El webhook eventualmente activara la suscripcion. Reintentamos en 5s.
          setTimeout(confirm, 5000);
        } else {
          setError(`Pago no aprobado (${status}). Vuelve a intentar.`);
        }
      } catch (err) {
        console.error(err);
        setError(err.response?.data?.detail || 'No se pudo verificar el pago');
      }
    }
    confirm();
  }, [transactionId]);

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
      padding: 24,
    }}>
      <div style={{ maxWidth: 380 }}>
        <div style={{
          width: 60, height: 60, borderRadius: 16,
          background: error ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)',
          border: `1px solid ${error ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.2)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 16px', fontSize: 28,
        }}>
          {error ? '⚠️' : '⏳'}
        </div>
        <p style={{ color: '#e5e7eb', fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
          {error ? 'Algo salió mal' : 'Confirmando pago'}
        </p>
        <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>
          {error || statusText}
        </p>
        {error && (
          <button
            onClick={() => navigate('/subscribe')}
            style={{
              padding: '10px 20px',
              borderRadius: 12,
              background: '#10b981',
              color: 'white',
              border: 'none',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Volver a intentar
          </button>
        )}
      </div>
    </div>
  );
}
