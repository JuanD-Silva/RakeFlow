#!/usr/bin/env bash
# Re-clona la data de PRODUCCION (Railway) hacia el Postgres LOCAL (Docker).
# Solo LEE de prod (pg_dump) y escribe en local. Nunca modifica prod.
#
# Uso:
#   PROD_DATABASE_URL='postgresql://postgres:...@hopper.proxy.rlwy.net:36864/railway' \
#     bash scripts/refresh-local-db.sh
#
# Si no pasas PROD_DATABASE_URL, lo intenta leer de la linea comentada del .env.
set -euo pipefail

LOCAL_DB_USER="poker_admin"
LOCAL_DB_NAME="poker_treasury_db"
CONTAINER="poker_db"

# 1. Resolver URL de prod
PROD_URL="${PROD_DATABASE_URL:-}"
if [ -z "$PROD_URL" ] && [ -f .env ]; then
  PROD_URL=$(grep -E '^#?\s*DATABASE_URL=postgresql://postgres:' .env | grep 'rlwy.net' | head -1 | sed -E 's/^#?\s*DATABASE_URL=//')
fi
if [ -z "$PROD_URL" ]; then
  echo "ERROR: pasa PROD_DATABASE_URL='postgresql://...' como variable de entorno." >&2
  exit 1
fi

# 2. Asegurar que el Postgres local este arriba
if ! docker exec "$CONTAINER" pg_isready -U "$LOCAL_DB_USER" -d "$LOCAL_DB_NAME" >/dev/null 2>&1; then
  echo "==> Levantando Postgres local (docker compose up -d)..."
  docker compose up -d
  for i in $(seq 1 15); do
    docker exec "$CONTAINER" pg_isready -U "$LOCAL_DB_USER" -d "$LOCAL_DB_NAME" >/dev/null 2>&1 && break
    sleep 2
  done
fi

# 3. Clonar prod -> local con los binarios PG17 del container (evita mismatch de version)
echo "==> Clonando prod -> local (esto NO toca prod)..."
docker exec -e PROD_URL="$PROD_URL" -i "$CONTAINER" sh -c \
  'pg_dump --no-owner --no-privileges --clean --if-exists "$PROD_URL" | psql -U '"$LOCAL_DB_USER"' -d '"$LOCAL_DB_NAME"' -q'

# 4. Verificar
echo "==> Listo. Conteos en local:"
docker exec "$CONTAINER" psql -U "$LOCAL_DB_USER" -d "$LOCAL_DB_NAME" -t -c \
  "select 'clubs='||count(*) from clubs
   union all select 'players='||count(*) from players
   union all select 'transactions='||count(*) from transactions;"
