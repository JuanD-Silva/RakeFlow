# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RakeFlow is a multi-tenant SaaS for managing poker clubs. It tracks cash game sessions, tournaments, player transactions, rake collection, and financial distribution. The codebase is in Spanish (comments, some variable names).

## Architecture

- **Backend**: Python FastAPI with async SQLAlchemy (asyncpg) and PostgreSQL. Entry point: `app/main.py`.
- **Frontend**: React 19 + Vite + Tailwind CSS 4, located in `poker-frontend/`. No TypeScript — uses JSX.
- **Auth**: JWT tokens (python-jose) with Argon2 password hashing. Token stored in localStorage, attached via axios interceptor.
- **DB Migrations**: Alembic (config in `alembic.ini`, scripts in `alembic/`).
- **Deployment**: Backend on Railway (Procfile: `uvicorn app.main:app`). Frontend on Vercel (SPA rewrite in `vercel.json`).

## Key Domain Model (app/models.py)

Multi-tenant via `club_id` on most tables. Hierarchy: Club -> Users/Players/Sessions/Tournaments. Sessions contain Transactions. DistributionRules define how rake is split (fixed, percentage, quota). Tournaments have their own player registrations (TournamentPlayer) with rebuys/addons tracking.

## Development Commands

### Backend
```bash
# Start backend (requires DATABASE_URL env var)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Database: local Postgres via Docker
docker-compose up -d

# Alembic migrations
alembic revision --autogenerate -m "description"
alembic upgrade head
```

### Frontend
```bash
cd poker-frontend
npm install
npm run dev      # Vite dev server on :5173
npm run build    # Production build
npm run lint     # ESLint
```

## Backend Structure

- `app/routers/` — Route modules: auth, players, sessions, transactions, stats, config, tournaments, history
- `app/models.py` — All SQLAlchemy models and enums
- `app/schemas.py` — Pydantic request/response schemas
- `app/services.py` — Business logic (financial calculations, distributions)
- `app/database.py` — Async engine setup, session factory, `get_db` dependency
- `app/dependencies.py` — Auth/permission dependencies
- `app/auth_utils.py` — JWT creation, password hashing

## Frontend Structure

- `poker-frontend/src/App.jsx` — Router and auth guard. Views: game, history, finance, ranking.
- `poker-frontend/src/api/axios.js` — Axios instance with auth interceptor (BASE_URL defaults to localhost:8000)
- `poker-frontend/src/api/services.js` — API service functions
- `poker-frontend/src/pages/` — Login, Register, Setup
- `poker-frontend/src/components/` — Main UI: GameControl (live session), TransactionManager, Dashboard, TournamentPlayerTable, WeeklyReport, etc.

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection string (required). The app auto-converts `postgres://` to `postgresql+asyncpg://`.

## Important Notes

- Tables are auto-created on startup via `metadata.create_all` (in addition to Alembic migrations).
- CORS is currently set to allow all origins (`"*"`).
- The SECRET_KEY in `auth_utils.py` is hardcoded — should be an env var in production.
- All database operations are async (AsyncSession). Use `await` with all DB calls.
- The frontend uses conditional rendering (not nested routes) to switch between views in the dashboard.
