# Teléfono verificado — setup de Twilio Verify

RakeFlow manda el código de activación DIRECTO al teléfono del jugador/dealer
(por WhatsApp o SMS) en vez de dárselo al club. Así, activar la cuenta prueba
que la persona tiene ese número — el cimiento para el multi-cuenta seguro y la
futura red de jugadores.

**Sin estas variables, RakeFlow sigue funcionando igual que hoy** (el club
recibe el código y lo reenvía por WhatsApp). Cargarlas activa el modo verificado.

## Pasos (una vez)

1. Crear cuenta en https://www.twilio.com (o entrar si ya existe).
2. Consola → **Verify** → **Services** → **Create new** → nombre "RakeFlow".
   - Activar el canal **WhatsApp** (usa la plantilla ya aprobada de Twilio — NO
     necesitas cuenta de Meta ni aprobar plantillas).
   - Dejar **SMS** activado también como respaldo de canal.
3. Copiar tres valores:
   - **Account SID** y **Auth Token**: portada de la consola.
   - **Verify Service SID**: dentro del servicio que creaste (empieza con `VA...`).

## Cargar en Railway (servicio RakeFlow → Variables)

```
TWILIO_ACCOUNT_SID=AC........................
TWILIO_AUTH_TOKEN=........................
TWILIO_VERIFY_SERVICE_SID=VA........................
TWILIO_VERIFY_CHANNEL=whatsapp
```

(`TWILIO_VERIFY_CHANNEL` acepta `whatsapp` o `sms`; default `whatsapp`.)

## Costo

~USD $0.05 por verificación exitosa (más el costo del mensaje del canal).
Solo se cobra cuando RakeFlow manda un código; sin volumen, casi nada.

## Cómo verificar que quedó activo (smoke)

Invitar a un jugador de prueba desde el panel del staff: si aparece "Código
enviado por WhatsApp" (en vez de abrir WhatsApp con el link), el modo verificado
está andando. Si algo falla en Twilio, cae solo al link de siempre (plan B).
