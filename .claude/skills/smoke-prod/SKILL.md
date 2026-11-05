---
name: smoke-prod
description: Corre smoke tests read-only contra RakeFlow en producción (backend Railway + frontend Vercel) tras un deploy. Reporta HTTP status y latencia. Úsalo después de pushear a main o cuando se sospeche un outage.
---

# Smoke test de producción (RakeFlow)

Verificación rápida post-deploy. **Solo GETs read-only** — no muta nada, seguro de correr siempre. Hubo un outage de Railway/GCP que requirió redeploy manual, así que este check vale tras cada push a `main`.

## Endpoints

Backend (Railway): `https://rakeflow-production.up.railway.app`
Frontend (Vercel): `https://rakeflow.site` (OJO: NO usar rake-flow.vercel.app — Vercel desafía bots/curl en su dominio compartido con 403 `x-vercel-mitigated: challenge`; el dominio propio no)

## Comando

```bash
echo "=== Backend (Railway) ==="
curl -sS -o /dev/null -w "  /                       -> HTTP %{http_code}  (%{time_total}s)\n" --max-time 12 https://rakeflow-production.up.railway.app/
curl -sS -o /dev/null -w "  /payments/wompi/config   -> HTTP %{http_code}  (%{time_total}s)\n" --max-time 12 https://rakeflow-production.up.railway.app/payments/wompi/config
echo "=== Frontend (Vercel) ==="
curl -sS -o /dev/null -w "  /                       -> HTTP %{http_code}  (%{time_total}s)\n" --max-time 12 https://rakeflow.site/
```

## Interpretación

- **200** en `/` backend y frontend = arriba.
- `/payments/wompi/config` debe responder **401** sin Authorization header (el endpoint requiere `Depends(get_current_club)`). Eso confirma que el router cargó y la dependencia de auth funciona. **500 o 502 ahí = problema** (env vars Wompi faltantes o crash al import).
- Latencia > ~5s o timeout en el primer hit puede ser cold start de Railway; reintenta una vez antes de declarar outage.
- Si el backend cae pero Vercel responde, revisa Railway: `railway logs` y el status de GCP/Railway.

## Si algo falla
1. `railway logs` para ver el error del backend.
2. Confirma que las env vars críticas están (DATABASE_URL, SECRET_KEY, WOMPI_*, RESEND_API_KEY).
3. Reporta al usuario qué endpoint cayó y el código HTTP, no intentes arreglar prod sin confirmar.
