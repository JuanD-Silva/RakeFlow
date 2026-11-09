from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)


def client_ip(request) -> str:
    """IP del cliente real detrás del proxy de Railway (X-Forwarded-For).

    get_remote_address ve la IP del proxy (uvicorn no confía en el proxy), así
    que todos los usuarios comparten UN cupo. Se usa en endpoints donde el
    límite es anti-spam y no defiende un secreto (passkeys): ahí que se pueda
    falsear el encabezado importa menos que no bloquear a todos a la vez."""
    fwd = request.headers.get("x-forwarded-for", "")
    ip = fwd.split(",")[0].strip() if fwd else ""
    return ip or get_remote_address(request)
