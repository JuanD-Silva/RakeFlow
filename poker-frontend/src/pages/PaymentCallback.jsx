import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api/axios';
import { wompiService } from '../api/services';
import { useAuth } from '../context/AuthContext';

/**
 * Pagina a la que Wompi redirige despues del checkout.
 * Wompi pasa: ?id=<transaction_id>&env=test|prod
 *
 * Estrategia:
 * 1. Si hay token, intentar /wompi/confirm (lo ideal)
 * 2. Si /confirm falla o no hay token, consultar /payments/status:
 *    el webhook ya pudo haber activado la suscripcion.
 * 3. Si no hay token y la suscripcion no esta activa, redirigir a /login.
 */
export default function PaymentCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { token } = useAuth();
  const [statusText, setStatusText] = useState('Verificando pago...');
  const [error, setError] = useState(null);

  const transactionId = searchParams.get('id') || searchParams.get('transaction_id') || '';

  useEffect(() => {
    async function checkStatusFallback() {
      // El webhook puede haber activado la suscripcion ya
      try {
        const status = await api.get('/payments/status');
        if (status.data.subscription_active) {
          localStorage.removeItem('rakeflow_wizard_done');
          navigate(`/payment-success?id=${encodeURIComponent(transactionId)}`);
          return true;
        }
      } catch {}
      return false;
    }

    async function attempt() {
      if (!transactionId) {
        setError('No se recibió identificador de transacción');
        return;
      }

      // Si no hay token, redirigir a login (con next al payment-success)
      if (!token) {
        const next = encodeURIComponent(`/payment-success?id=${transactionId}`);
        navigate(`/login?next=${next}`);
        return;
      }

      try {
        const res = await wompiService.confirmTransaction(transactionId);
        if (res.subscription_active) {
          localStorage.removeItem('rakeflow_wizard_done');
          navigate(`/payment-success?id=${encodeURIComponent(transactionId)}`);
          return;
        }
        const wompiStatus = res.wompi_status || 'PENDING';
        if (wompiStatus === 'PENDING') {
          setStatusText('Pago en proceso, te confirmaremos cuando se acredite...');
          setTimeout(attempt, 5000);
        } else {
          // Estado no APPROVED — pero el webhook pudo haber cerrado igualmente
          if (await checkStatusFallback()) return;
          setError(`Pago no aprobado (${wompiStatus}). Vuelve a intentar.`);
        }
      } catch (err) {
        console.error(err);
        // Fallback: el webhook pudo haber activado la suscripcion
        // independientemente del error en /confirm
        if (await checkStatusFallback()) return;
        setError(err.response?.data?.detail || 'No se pudo verificar el pago');
      }
    }
    attempt();
  }, [transactionId, token]);

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
