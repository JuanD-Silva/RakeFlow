---
name: crear-migracion
description: Crea una migración Alembic para RakeFlow siguiendo el patrón de SQL manual idempotente. Úsalo cuando haya que cambiar el schema de la DB (agregar columna/tabla/índice). Solo invocable por el usuario porque la migración se aplica sola en prod en el siguiente deploy.
disable-model-invocation: true
---

# Crear migración Alembic (RakeFlow)

⚠️ **Dev y prod son DBs distintas, pero prod migra sola.**
- **Local:** Postgres en Docker (`docker compose up -d`, puerto 5433). `./venv/bin/alembic upgrade head` solo toca esa DB. Para probar con datos reales: `scripts/refresh-local-db.sh` (copia prod → local, solo lee de prod).
- **Prod:** el `Procfile` corre `alembic upgrade head && uvicorn ...` en cada deploy de Railway (auto-deploy desde `main`). Mergear el PR = aplicar la migración sobre clubes reales en vivo. Si la migración falla, el `&&` corta y el backend no arranca.

Por eso:
- **Aditivo (ADD COLUMN/TABLE/INDEX) = seguro.** Procede.
- **Destructivo (DROP/RENAME/ALTER TYPE) = coordinar primero.** Detente y confírmalo con el usuario antes de mergear.

## Pasos

1. **Genera el archivo** (NO uses `--autogenerate`, produce SQL no idempotente):
   ```bash
   ./venv/bin/alembic revision -m "descripcion corta"
   ```
   Esto crea `alembic/versions/<hash>_descripcion_corta.py` con el `down_revision` ya encadenado al head actual.

2. **Escribe `upgrade()` y `downgrade()` con SQL manual idempotente** usando `op.execute(...)`. El patrón de todas las migraciones del repo (ver [i9d0e1f2g3h4_subscription_price.py](alembic/versions/i9d0e1f2g3h4_subscription_price.py)):

   ```python
   def upgrade() -> None:
       op.execute("ALTER TABLE clubs ADD COLUMN IF NOT EXISTS nueva_col INTEGER")

   def downgrade() -> None:
       op.execute("ALTER TABLE clubs DROP COLUMN IF EXISTS nueva_col")
   ```

   Reglas:
   - Siempre `IF NOT EXISTS` / `IF EXISTS` (idempotente: la migración puede correr sobre una DB donde alguien ya aplicó el cambio a mano).
   - Columnas nuevas: `nullable` o con `DEFAULT`, nunca `NOT NULL` sin default sobre tabla con datos (rompería las filas existentes).
   - Para enums nuevos/valores: `ALTER TYPE ... ADD VALUE IF NOT EXISTS`.

3. **Si agregaste/cambiaste un modelo**, refleja el cambio en [app/models.py](app/models.py) (las tablas se auto-crean en startup vía `metadata.create_all`, así que el modelo y la migración deben coincidir).

4. **Aplica local** (solo la DB de Docker; prod se migra al deploy):
   ```bash
   ./venv/bin/alembic upgrade head
   ./venv/bin/alembic heads   # debe salir UNA sola línea
   ```
   Si hay otro PR abierto con migración, el segundo en mergear re-apunta su `down_revision` al primero. Dos heads hacen que `alembic upgrade head` falle en el deploy y el backend no arranque.

5. **Verifica** que el backend importa y arranca:
   ```bash
   ./venv/bin/python -c "from app.main import app; print('OK', len(app.routes), 'routes')"
   ```

## Checklist final
- [ ] `down_revision` apunta al head anterior y `alembic heads` da uno solo (no rompiste la cadena).
- [ ] SQL idempotente (`IF [NOT] EXISTS`).
- [ ] Columnas nuevas no rompen filas existentes en producción.
- [ ] `models.py` coincide con la migración.
- [ ] Si es destructivo, lo confirmaste con el usuario antes de mergear.
