# app/main.py
import logging
import os
import time
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from jose import jwt, JWTError
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler
from app.database import engine  # 👈 Importar el motor de base de datos
from app import models, auth_utils
from app.rate_limit import limiter
from app.logging_config import (
    setup_logging,
    request_id_ctx,
    club_id_ctx,
    new_request_id,
)

_sentry_dsn = os.getenv("SENTRY_DSN", "").strip()
if _sentry_dsn:
    sentry_sdk.init(
        dsn=_sentry_dsn,
        environment=os.getenv("ENVIRONMENT", "production"),
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
        profiles_sample_rate=float(os.getenv("SENTRY_PROFILES_SAMPLE_RATE", "0.0")),
        send_default_pii=False,
        integrations=[StarletteIntegration(), FastApiIntegration()],
    )

# Importamos todos los módulos donde distribuimos la lógica
from app.routers import auth, players, sessions, transactions, stats, config, tournaments, history, payments

setup_logging(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("rakeflow")

app = FastAPI(title="Poker Club SaaS", version="2.0")

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.middleware("http")
async def observability_middleware(request: Request, call_next):
    req_id = request.headers.get("X-Request-ID") or new_request_id()
    token_req_id = request_id_ctx.set(req_id)

    club_id_value = "-"
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        try:
            payload = jwt.decode(
                auth_header.split(" ", 1)[1],
                auth_utils.SECRET_KEY,
                algorithms=[auth_utils.ALGORITHM],
                options={"verify_exp": False},
            )
            cid = payload.get("club_id")
            if cid is not None:
                club_id_value = str(cid)
        except JWTError:
            pass
    token_club_id = club_id_ctx.set(club_id_value)

    if _sentry_dsn:
        sentry_sdk.set_tag("request_id", req_id)
        if club_id_value != "-":
            sentry_sdk.set_tag("club_id", club_id_value)

    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = (time.perf_counter() - start) * 1000
        logger.exception(
            "request_failed",
            extra={"method": request.method, "path": request.url.path, "duration_ms": round(duration_ms, 2)},
        )
        raise
    else:
        duration_ms = (time.perf_counter() - start) * 1000
        logger.info(
            "request",
            extra={
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": round(duration_ms, 2),
            },
        )
        response.headers["X-Request-ID"] = req_id
        return response
    finally:
        request_id_ctx.reset(token_req_id)
        club_id_ctx.reset(token_club_id)

# ---------------------------------------------------------
# 1. CREACIÓN DE TABLAS AL INICIAR (SOLUCIÓN AL ERROR) 🏗️
# ---------------------------------------------------------
@app.on_event("startup")
async def startup_event():
    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)

import os

_allowed = os.getenv("ALLOWED_ORIGINS", "")
origins = [o.strip() for o in _allowed.split(",") if o.strip()] if _allowed else [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8000",
]

# ---------------------------------------------------------
# CONFIGURACIÓN DE SEGURIDAD (CORS)
# ---------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------
# CONEXIÓN DE RUTAS (ROUTERS)
# ---------------------------------------------------------
app.include_router(auth.router)
app.include_router(players.router)       
app.include_router(sessions.router)      
app.include_router(transactions.router)  
app.include_router(stats.router)         
app.include_router(config.router)   
app.include_router(tournaments.router) 
app.include_router(history.router)
app.include_router(payments.router)

# ---------------------------------------------------------
# ENDPOINT DE SALUD
# ---------------------------------------------------------
@app.get("/")
def root():
    return {
        "system": "Poker Club SaaS API",
        "status": "online 🟢",
        "version": "2.0 (Modular Architecture)",
        "message": "Sistema listo para recibir peticiones."
    }