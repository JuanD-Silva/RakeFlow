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
