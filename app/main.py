# app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import engine  # 👈 Importar el motor de base de datos
from app import models           # 👈 Importar tus modelos

# Importamos todos los módulos donde distribuimos la lógica
from app.routers import auth, players, sessions, transactions, stats, config, tournaments, history

app = FastAPI(title="Poker Club SaaS", version="2.0")

# ---------------------------------------------------------
# 1. CREACIÓN DE TABLAS AL INICIAR (SOLUCIÓN AL ERROR) 🏗️
# ---------------------------------------------------------
@app.on_event("startup")
async def startup_event():
    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)

origins = [
    "http://localhost:5173",      # Tu Frontend (Vite)
    "http://127.0.0.1:5173",      # A veces se detecta así
    "http://localhost:8000",      # Tu Backend (por si acaso)
    "https://rakeflow-production.up.railway.app" # Tu producción (opcional)
]

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
app.include_router(tournaments.router) 
app.include_router(history.router)    

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