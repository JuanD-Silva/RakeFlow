import { useState, useEffect } from 'react';
import api from '../api/axios';
import { wompiService } from '../api/services';
import {
  CreditCardIcon,
  CheckIcon,
  ExclamationTriangleIcon,
  ShieldCheckIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

// Detectar marca de tarjeta por bin (los primeros digitos)
function detectBrand(num) {
  const n = num.replace(/\D/g, '');
  if (/^4/.test(n)) return 'VISA';
  if (/^(5[1-5]|2[2-7])/.test(n)) return 'MASTERCARD';
  if (/^3[47]/.test(n)) return 'AMEX';
  if (/^(6011|65|64[4-9])/.test(n)) return 'DISCOVER';
  return null;
}

// Luhn check para validar el numero
function luhnValid(num) {
  const n = num.replace(/\D/g, '');
  if (n.length < 12) return false;
  let sum = 0;
  let alt = false;
  for (let i = n.length - 1; i >= 0; i--) {
    let d = parseInt(n[i], 10);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function formatCardNumber(value) {
  const digits = value.replace(/\D/g, '').slice(0, 19);
  return digits.replace(/(.{4})/g, '$1 ').trim();
}

export default function WompiCardForm({ onSuccess, onCancel, amountCop = 49900 }) {
  const [cfg, setCfg] = useState(null);
  const [loadingCfg, setLoadingCfg] = useState(true);

  const [number, setNumber] = useState('');
  const [holder, setHolder] = useState('');
  const [expMonth, setExpMonth] = useState('');
  const [expYear, setExpYear] = useState('');
  const [cvc, setCvc] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const brand = detectBrand(number);

  useEffect(() => {
    async function load() {
      try {
        const c = await wompiService.getConfig();
        if (!c.acceptance_token || !c.personal_data_acceptance_token) {
          setError('No se pudo cargar la configuracion de pago');
          return;
        }
        setCfg(c);
      } catch (err) {
        console.error(err);
        setError('No se pudo cargar la configuracion de pago');
      } finally {
        setLoadingCfg(false);
      }
    }
    load();
  }, []);

  const valid =
    luhnValid(number) &&
    holder.trim().length >= 3 &&
    /^(0[1-9]|1[0-2])$/.test(expMonth) &&
    /^\d{2}$/.test(expYear) &&
    /^\d{3,4}$/.test(cvc) &&
    acceptTerms;

  const submit = async (e) => {
    e.preventDefault();
    if (!valid || !cfg) return;
    setSubmitting(true);
    setError(null);

    try {
      // 1. Tokenizar la tarjeta directamente con Wompi (con public key)
      const tokenRes = await fetch(`${cfg.api_base}/tokens/cards`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.public_key}`,
        },
        body: JSON.stringify({
          number: number.replace(/\s/g, ''),
          exp_month: expMonth,
          exp_year: expYear,
          cvc,
          card_holder: holder.trim(),
        }),
      });
      const tokenData = await tokenRes.json();
      if (tokenData.status !== 'CREATED' || !tokenData.data?.id) {
        const msg = tokenData?.error?.messages
          ? Object.values(tokenData.error.messages).flat().join(' ')
          : 'Datos de tarjeta invalidos';
        throw new Error(msg);
      }

      const cardToken = tokenData.data.id;

      // Limpiar numero/cvc del state inmediatamente despues de tokenizar
      // (PCI hygiene: no mantener PAN/CVC en memoria mas de lo necesario)
      setNumber('');
      setCvc('');

      // 2. Backend crea payment_source y cobra primer mes
      const subRes = await api.post('/payments/wompi/subscribe', {
        card_token: cardToken,
        acceptance_token: cfg.acceptance_token,
        accept_personal_auth: cfg.personal_data_acceptance_token,
        customer_email: cfg.club_email,
      });

      if (subRes.data.subscription_active) {
        onSuccess?.(subRes.data);
      } else if (subRes.data.wompi_status === 'PENDING') {
        // Esperar webhook
        onSuccess?.(subRes.data);
      } else {
        setError(subRes.data.message || 'Pago rechazado. Intenta con otra tarjeta.');
      }
    } catch (err) {
      console.error(err);
      const detail = err.response?.data?.detail || err.message || 'No se pudo procesar el pago';
      setError(detail);
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingCfg) {
    return (
      <div className="p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500 mx-auto"></div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-start gap-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3">
        <ShieldCheckIcon className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
        <p className="text-xs text-emerald-300 leading-relaxed">
          Tu tarjeta se cobra <strong>${amountCop.toLocaleString('es-CO')} COP hoy</strong> y se renueva
          automáticamente cada mes. Puedes cancelar cuando quieras.
        </p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-start gap-2">
          <ExclamationTriangleIcon className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <span className="text-red-300 text-sm">{error}</span>
        </div>
      )}

      {/* Numero de tarjeta */}
      <div>
        <label className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1.5 block">
          Número de tarjeta
        </label>
        <div className="relative">
          <CreditCardIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
          <input
            type="text"
            inputMode="numeric"
            autoComplete="cc-number"
            value={number}
            onChange={(e) => setNumber(formatCardNumber(e.target.value))}
            placeholder="1234 5678 9012 3456"
            maxLength={23}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-10 pr-16 py-3 text-white placeholder-gray-500 font-mono focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 focus:outline-none"
          />
          {brand && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-1 rounded">
              {brand}
            </span>
          )}
        </div>
      </div>

      {/* Nombre del titular */}
      <div>
        <label className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1.5 block">
          Nombre del titular
        </label>
        <input
          type="text"
          autoComplete="cc-name"
          value={holder}
          onChange={(e) => setHolder(e.target.value.toUpperCase())}
          placeholder="JUAN PEREZ"
          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 focus:outline-none uppercase"
        />
      </div>

      {/* MM/AA + CVC */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1.5 block">MM</label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="cc-exp-month"
            value={expMonth}
            onChange={(e) => setExpMonth(e.target.value.replace(/\D/g, '').slice(0, 2))}
            placeholder="06"
            maxLength={2}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 font-mono text-center focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 focus:outline-none"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1.5 block">AA</label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="cc-exp-year"
            value={expYear}
            onChange={(e) => setExpYear(e.target.value.replace(/\D/g, '').slice(0, 2))}
            placeholder="29"
            maxLength={2}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 font-mono text-center focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 focus:outline-none"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1.5 block">CVC</label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="cc-csc"
            value={cvc}
            onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="123"
            maxLength={4}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 font-mono text-center focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 focus:outline-none"
          />
        </div>
      </div>

      {/* Aceptar terminos Wompi */}
      <label className="flex items-start gap-2 cursor-pointer text-xs text-gray-400 leading-relaxed">
        <input
          type="checkbox"
          checked={acceptTerms}
          onChange={(e) => setAcceptTerms(e.target.checked)}
          className="mt-0.5 w-4 h-4 rounded border-gray-600 bg-gray-900 text-emerald-500 focus:ring-emerald-500/30 accent-emerald-500"
        />
        <span>
          Acepto el{' '}
          {cfg?.acceptance_permalink && (
            <>
              <a href={cfg.acceptance_permalink} target="_blank" rel="noopener noreferrer" className="text-emerald-400 underline">
                reglamento de servicio
              </a>{' '}y{' '}
            </>
          )}
          {cfg?.personal_data_acceptance_permalink && (
            <a href={cfg.personal_data_acceptance_permalink} target="_blank" rel="noopener noreferrer" className="text-emerald-400 underline">
              política de datos personales
            </a>
          )} de Wompi.
        </span>
      </label>

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-bold text-sm uppercase tracking-wider disabled:opacity-50"
        >
          <XMarkIcon className="w-4 h-4 inline mr-1" /> Cancelar
        </button>
        <button
          type="submit"
          disabled={!valid || submitting}
          className="flex-2 py-3 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold text-sm uppercase tracking-wider shadow-lg shadow-emerald-900/30 flex-1"
        >
          {submitting ? (
            <>
              <div className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></div>
              Procesando...
            </>
          ) : (
            <><CheckIcon className="w-4 h-4 inline mr-1" /> Suscribirme</>
          )}
        </button>
      </div>

      <p className="text-[10px] text-center text-gray-600">
        Pago seguro procesado por <strong>Wompi (Bancolombia)</strong>. RakeFlow no almacena los datos completos de tu tarjeta.
      </p>
    </form>
  );
}
