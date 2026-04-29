# app/email_service.py
import os
import logging
import resend
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)


def _get_config():
    api_key = os.getenv("RESEND_API_KEY")
    if api_key:
        resend.api_key = api_key
    return {
        "api_key": api_key,
        "from_email": os.getenv("RESEND_FROM_EMAIL", "onboarding@resend.dev"),
        "frontend_url": os.getenv("FRONTEND_URL", "http://localhost:5173"),
    }


def send_verification_email(to_email: str, token: str, club_name: str):
    config = _get_config()
    if not config["api_key"]:
        logger.warning("RESEND_API_KEY not set, skipping verification email to %s", to_email)
        return False

    verify_link = f"{config['frontend_url']}/verify-email?token={token}"

    try:
        resend.Emails.send({
            "from": f"RakeFlow <{config['from_email']}>",
            "to": [to_email],
            "subject": "Verifica tu email - RakeFlow",
            "html": f"""
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <span style="font-size: 24px; font-weight: 900; color: #10b981;">RakeFlow</span>
                </div>
                <div style="background: #1e293b; border-radius: 16px; padding: 32px; border: 1px solid #334155;">
                    <h2 style="color: #ffffff; margin: 0 0 8px 0; font-size: 20px;">Bienvenido, {club_name}!</h2>
                    <p style="color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">
                        Gracias por crear tu club en RakeFlow. Para activar tu cuenta, confirma tu correo electronico haciendo clic en el boton.
                    </p>
                    <a href="{verify_link}" style="display: block; background: linear-gradient(to right, #059669, #10b981); color: white; text-decoration: none; padding: 14px 24px; border-radius: 12px; font-weight: 700; font-size: 14px; text-align: center; letter-spacing: 0.05em; text-transform: uppercase;">
                        Verificar Email
                    </a>
                    <p style="color: #64748b; font-size: 12px; margin: 24px 0 0 0; text-align: center;">
                        Si no creaste esta cuenta, puedes ignorar este correo.
                    </p>
                </div>
                <p style="color: #475569; font-size: 11px; text-align: center; margin-top: 20px;">
                    &copy; 2026 RakeFlow. Todos los derechos reservados.
                </p>
            </div>
            """
        })
        logger.info("Verification email sent to %s", to_email)
        return True
    except Exception as e:
        logger.error("Failed to send verification email to %s: %s", to_email, e)
        return False


def send_invitation_email(to_email: str, token: str, inviter_name: str, club_name: str, role: str):
    config = _get_config()
    if not config["api_key"]:
        logger.warning("RESEND_API_KEY not set, skipping invitation email to %s", to_email)
        return False

    accept_link = f"{config['frontend_url']}/accept-invitation?token={token}"
    role_label = {
        "owner": "Dueño",
        "manager": "Encargado",
        "cashier": "Cajero",
    }.get(str(role).lower(), role)

    try:
        resend.Emails.send({
            "from": f"RakeFlow <{config['from_email']}>",
            "to": [to_email],
            "subject": f"Te invitaron a {club_name} en RakeFlow",
            "html": f"""
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <span style="font-size: 24px; font-weight: 900; color: #10b981;">RakeFlow</span>
                </div>
                <div style="background: #1e293b; border-radius: 16px; padding: 32px; border: 1px solid #334155;">
                    <h2 style="color: #ffffff; margin: 0 0 8px 0; font-size: 20px;">Te invitaron a {club_name}</h2>
                    <p style="color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 12px 0;">
                        <strong style="color: #ffffff;">{inviter_name}</strong> te invitó a unirte como <strong style="color: #10b981;">{role_label}</strong>.
                    </p>
                    <p style="color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">
                        Acepta la invitación para crear tu contraseña y comenzar a operar.
                    </p>
                    <a href="{accept_link}" style="display: block; background: linear-gradient(to right, #059669, #10b981); color: white; text-decoration: none; padding: 14px 24px; border-radius: 12px; font-weight: 700; font-size: 14px; text-align: center; letter-spacing: 0.05em; text-transform: uppercase;">
                        Aceptar Invitación
                    </a>
                    <p style="color: #64748b; font-size: 12px; margin: 24px 0 0 0; text-align: center;">
                        Este enlace expira en 7 días. Si no esperabas esta invitación, ignora este correo.
                    </p>
                </div>
                <p style="color: #475569; font-size: 11px; text-align: center; margin-top: 20px;">
                    &copy; 2026 RakeFlow.
                </p>
            </div>
            """
        })
        logger.info("Invitation email sent to %s", to_email)
        return True
    except Exception as e:
        logger.error("Failed to send invitation email to %s: %s", to_email, e)
        return False


def send_payment_succeeded_email(to_email: str, club_name: str, amount: int, period_end, card_brand: str = None, card_last4: str = None):
    config = _get_config()
    if not config["api_key"]:
        logger.warning("RESEND_API_KEY not set, skipping email to %s", to_email)
        return False

    period_end_str = period_end.strftime("%d/%m/%Y") if hasattr(period_end, "strftime") else str(period_end)
    card_str = f"{card_brand} ··· {card_last4}" if card_brand and card_last4 else "tu tarjeta"
    amount_fmt = f"${amount:,}".replace(",", ".")

    try:
        resend.Emails.send({
            "from": f"RakeFlow <{config['from_email']}>",
            "to": [to_email],
            "subject": "Tu pago se procesó - RakeFlow",
            "html": f"""
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <span style="font-size: 24px; font-weight: 900; color: #10b981;">RakeFlow</span>
                </div>
                <div style="background: #1e293b; border-radius: 16px; padding: 32px; border: 1px solid #334155;">
                    <h2 style="color: #ffffff; margin: 0 0 8px 0; font-size: 20px;">✓ Pago confirmado</h2>
                    <p style="color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 16px 0;">
                        Hola <strong style="color: #ffffff;">{club_name}</strong>, tu suscripción de RakeFlow se renovó automáticamente.
                    </p>
                    <div style="background: #0f172a; border-radius: 12px; padding: 16px; border: 1px solid #1e293b; margin-bottom: 16px;">
                        <p style="margin: 0 0 4px 0; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 1px;">Monto</p>
                        <p style="margin: 0 0 12px 0; color: #ffffff; font-size: 24px; font-weight: bold; font-family: monospace;">{amount_fmt} COP</p>
                        <p style="margin: 0 0 4px 0; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 1px;">Pagado con</p>
                        <p style="margin: 0 0 12px 0; color: #cbd5e1; font-size: 14px; font-family: monospace;">{card_str}</p>
                        <p style="margin: 0 0 4px 0; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 1px;">Vigencia hasta</p>
                        <p style="margin: 0; color: #cbd5e1; font-size: 14px;">{period_end_str}</p>
                    </div>
                    <p style="color: #64748b; font-size: 12px; margin: 0; text-align: center;">
                        Cualquier duda, escríbenos a soporte@rakeflow.site
                    </p>
                </div>
                <p style="color: #475569; font-size: 11px; text-align: center; margin-top: 20px;">
                    &copy; 2026 RakeFlow.
                </p>
            </div>
            """
        })
        logger.info("Payment succeeded email sent to %s", to_email)
        return True
    except Exception as e:
        logger.error("Failed to send payment succeeded email to %s: %s", to_email, e)
        return False


def send_payment_failed_email(to_email: str, club_name: str, amount: int, reason: str = "", card_brand: str = None, card_last4: str = None):
    config = _get_config()
    if not config["api_key"]:
        logger.warning("RESEND_API_KEY not set, skipping email to %s", to_email)
        return False

    update_link = f"{config['frontend_url']}/subscribe"
    card_str = f"{card_brand} ··· {card_last4}" if card_brand and card_last4 else "tu tarjeta"
    amount_fmt = f"${amount:,}".replace(",", ".")

    try:
        resend.Emails.send({
            "from": f"RakeFlow <{config['from_email']}>",
            "to": [to_email],
            "subject": "Tu pago no se pudo procesar - RakeFlow",
            "html": f"""
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <span style="font-size: 24px; font-weight: 900; color: #10b981;">RakeFlow</span>
                </div>
                <div style="background: #1e293b; border-radius: 16px; padding: 32px; border: 1px solid #f59e0b;">
                    <h2 style="color: #f59e0b; margin: 0 0 8px 0; font-size: 20px;">⚠️ No se pudo cobrar tu suscripción</h2>
                    <p style="color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 16px 0;">
                        Hola <strong style="color: #ffffff;">{club_name}</strong>, intentamos cobrar {amount_fmt} COP a {card_str} pero la transacción fue rechazada.
                    </p>
                    {f'<p style="color: #fbbf24; font-size: 13px; line-height: 1.5; background: #422006; padding: 12px; border-radius: 8px; border-left: 3px solid #f59e0b; margin: 0 0 16px 0;">Motivo: {reason}</p>' if reason else ''}
                    <p style="color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">
                        Para no perder acceso, actualiza tu medio de pago o usa otra tarjeta. Tu cuenta sigue activa, intentaremos cobrar de nuevo en las próximas horas.
                    </p>
                    <a href="{update_link}" style="display: block; background: linear-gradient(to right, #f59e0b, #d97706); color: white; text-decoration: none; padding: 14px 24px; border-radius: 12px; font-weight: 700; font-size: 14px; text-align: center; letter-spacing: 0.05em; text-transform: uppercase;">
                        Actualizar tarjeta
                    </a>
                    <p style="color: #64748b; font-size: 12px; margin: 24px 0 0 0; text-align: center;">
                        ¿Necesitas ayuda? Escríbenos a soporte@rakeflow.site
                    </p>
                </div>
                <p style="color: #475569; font-size: 11px; text-align: center; margin-top: 20px;">
                    &copy; 2026 RakeFlow.
                </p>
            </div>
            """
        })
        logger.info("Payment failed email sent to %s", to_email)
        return True
    except Exception as e:
        logger.error("Failed to send payment failed email to %s: %s", to_email, e)
        return False


def send_password_reset_email(to_email: str, token: str, club_name: str):
    config = _get_config()
    if not config["api_key"]:
        logger.warning("RESEND_API_KEY not set, skipping email to %s", to_email)
        return False

    reset_link = f"{config['frontend_url']}/reset-password?token={token}"

    try:
        resend.Emails.send({
            "from": f"RakeFlow <{config['from_email']}>",
            "to": [to_email],
            "subject": "Restablecer contrasena - RakeFlow",
            "html": f"""
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <span style="font-size: 24px; font-weight: 900; color: #10b981;">RakeFlow</span>
                </div>
                <div style="background: #1e293b; border-radius: 16px; padding: 32px; border: 1px solid #334155;">
                    <h2 style="color: #ffffff; margin: 0 0 8px 0; font-size: 20px;">Hola, {club_name}</h2>
                    <p style="color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">
                        Recibimos una solicitud para restablecer la contrasena de tu cuenta. Haz clic en el boton para crear una nueva contrasena.
                    </p>
                    <a href="{reset_link}" style="display: block; background: linear-gradient(to right, #059669, #10b981); color: white; text-decoration: none; padding: 14px 24px; border-radius: 12px; font-weight: 700; font-size: 14px; text-align: center; letter-spacing: 0.05em; text-transform: uppercase;">
                        Restablecer Contrasena
                    </a>
                    <p style="color: #64748b; font-size: 12px; margin: 24px 0 0 0; text-align: center;">
                        Este enlace expira en 1 hora. Si no solicitaste este cambio, ignora este correo.
                    </p>
                </div>
                <p style="color: #475569; font-size: 11px; text-align: center; margin-top: 20px;">
                    &copy; 2026 RakeFlow. Todos los derechos reservados.
                </p>
            </div>
            """
        })
        logger.info("Password reset email sent to %s", to_email)
        return True
    except Exception as e:
        logger.error("Failed to send email to %s: %s", to_email, e)
        return False
