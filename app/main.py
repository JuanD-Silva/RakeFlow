# app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import engine  # 👈 Importar el motor de base de datos
from app import models           # 👈 Importar tus modelos

# Importamos todos los módulos donde distribuimos la lógica
from app.routers import auth, players, sessions, transactions, stats, config, audit

app = FastAPI(title="Poker Club SaaS", version="2.0")

# ---------------------------------------------------------
# 1. CREACIÓN DE TABLAS AL INICIAR (SOLUCIÓN AL ERROR) 🏗️
# ---------------------------------------------------------
@app.on_event("startup")
async def startup_event():
    print("🔄 Verificando tablas en la base de datos...")
    async with engine.begin() as conn:
        # Esto crea las tablas sessions, players, clubs, etc.
        await conn.run_sync(models.Base.metadata.create_all)
    print("✅ Tablas listas.")

# ---------------------------------------------------------
# CONFIGURACIÓN DE SEGURIDAD (CORS)
# ---------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
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
app.include_router(audit.router, prefix="/audit", tags=["audit"])

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