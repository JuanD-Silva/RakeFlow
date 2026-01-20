import asyncio
from logging.config import fileConfig
import os
import sys

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config
from alembic import context

# --- MODIFICACIÓN 1: Agregar el directorio raíz al path ---
# Esto permite importar 'app' sin errores
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

# --- MODIFICACIÓN 2: Importar tus modelos y Base ---
from app.models import Base
# También carga las variables de entorno para no hardcodear la URL
from dotenv import load_dotenv
load_dotenv() 

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# --- MODIFICACIÓN 3: Sobrescribir la URL de sqlalchemy ---
# Leemos la URL del .env, tal como lo hace la app
db_url = os.getenv("DATABASE_URL")
if db_url:
    config.set_main_option("sqlalchemy.url", db_url)

# --- MODIFICACIÓN 4: Enlazar los metadatos ---
target_metadata = Base.metadata

# ... (El resto del archivo suele venir bien configurado por el template async)
# Solo verifica que run_migrations_online use async_engine_from_config
# A continuación dejo el bloque run_migrations_online estándar para async:

async def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()

def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)

    with context.begin_transaction():
        context.run_migrations()

async def run_async_migrations() -> None:
    """In this scenario we need to create an Engine
    and associate a connection with the context.
    """
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()

def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())