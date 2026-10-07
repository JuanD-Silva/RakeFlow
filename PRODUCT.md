# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

El usuario primario es el **staff del club de poker** (cajero, dueño, manager, dealer): opera mesas cash y torneos de noche, desde el celular, en el salón del club. Bajo presión y con plata real de por medio — cada toque cuenta.

Audiencia secundaria confirmada: los **jugadores del club**, vía su panel personal (stats, logros, VIP, retos) y el link público del club (mesas vivas, sorteo de sillas, reloj de torneo en TV).

## Product Purpose

RakeFlow es un SaaS multi-tenant para administrar clubes de poker en Colombia: sesiones cash, torneos (reloj, mesas, sorteo, re-entradas), transacciones de jugadores, recaudo de rake, pago a dealers y reparto de utilidades a socios. Éxito = la caja del club cuadra al peso sin cuadernos, y los jugadores vuelven.

## Positioning

Confirmado por el dueño (2026-08-20), dos pilares que un competidor tipo PokerDesk no puede copiar con honestidad:

1. **Control financiero total**: rake, dealers, cortesías, fiados y reparto a socios cuadran al peso — hecho para clubes colombianos, en español (tuteo), móvil primero.
2. **Fidelización del jugador**: el panel del jugador (logros, VIP, retos mensuales, ranking, compartir tarjetas-trofeo) hace que los jugadores vuelvan al club — el club no solo administra, retiene.

(La visión de red de dos lados — jugadores descubren clubes — es dirección futura, no posicionamiento actual.)

## Operating Context

- Uso nocturno en el club, celular en mano (iPhone frecuente); la app es PWA instalable. El staff alterna entre mesas cash y torneos en vivo.
- Venta asistida por WhatsApp (573041076526) con trial de 14 días; onboarding cercano, precio en pesos (Plan Pro $199.000 COP/mes).
- Cliente fundador: club Mambo (grandfathered). Los datos de producción son plata real de un negocio real.
- Backend FastAPI + PostgreSQL en Railway; frontend React 19 + Vite + Tailwind 4 en Vercel (rakeflow.site). Deploy automático desde `main`.

## Capabilities and Constraints

- Multi-tenant por `club_id`; RBAC (OWNER/MANAGER/CASHIER/DEALER); multi-mesa cash y multi-torneo simultáneos.
- Motor de torneos completo: reloj server-authoritative, TV pública, builder de blinds, mesas con sorteo aleatorio y nivelado, re-entradas, dealers por mesa.
- Capa pública sin auth (`/c/{token}`): mesas vivas, sorteo, jackpot — **regla dura: cero plata de jugadores en la capa pública** (excepciones deliberadas documentadas en `app/routers/public.py`).
- Cobros recurrentes con Wompi; correo transaccional con Resend (`noreply@rakeflow.site`); OTP por Twilio Verify (pendiente de claves).
- Terminología del dominio en español: rake, cortes, fiados, cortesías, sorteo de sillas, nivelar, re-entrada, quebró (BUST).
- Todo cambio a producción va por rama + PR + revisor + merge + smoke (sin excepciones).

## Brand Commitments

- Nombre: **RakeFlow**. Logo existente: `poker-frontend/public/rakeflow-logo.svg` y `.png` (+ favicons/PWA icons en `public/`).
- Voz: **español, tuteo (nunca voseo)**, corto y directo — en UI, copy y notificaciones.
- Tema oscuro como identidad (uso nocturno en el club); acentos por contexto ya establecidos: esmeralda = cash, violeta = torneo.

## Evidence on Hand

- Datos reales de producción del club Mambo (sesiones, rake, jugadores, retención) — usables en análisis internos, nunca públicos.
- Landing autoservicio existente (`poker-frontend/src/pages/Landing.jsx`) con contacto WhatsApp.
- No hay testimonios ni casos de estudio publicables confirmados: **no inventarlos**.

## Product Principles

1. **La plata cuadra o no sirve**: cualquier feature que toque dinero debe mantener ledger y contadores sincronizados en todas las vistas (vivo, histórico, reportes, rankings).
2. **Móvil de noche primero**: cada pantalla del staff se diseña para un celular en un salón oscuro con prisa.
3. **El jugador ve su gloria, no su pérdida**: el panel del jugador celebra logros y esconde la pérdida al perdedor (decisión de producto establecida).
4. **Público = sin plata**: la capa pública jamás expone dinero de jugadores.
5. **Acciones destructivas siempre confirman** (ConfirmModal de la app, nunca alertas del navegador).

## Accessibility & Inclusion

Sin requisito formal establecido (confirmado 2026-08-20). Piso práctico: legibilidad en pantallas chicas con brillo bajo y uso con una mano.
