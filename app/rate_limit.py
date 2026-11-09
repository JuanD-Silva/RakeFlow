import threading
import time
from collections import deque

from slowapi import Limiter
from slowapi.util import get_remote_address


def client_ip(request) -> str:
    """IP real del cliente detrás del proxy de Railway.

    get_remote_address ve la IP del PROXY (uvicorn no le cree al proxy), así que
    todos los usuarios compartían UN solo cupo: los límites eran globales para
    todo RakeFlow (8 activaciones/hora en total, 10 logins/minuto en total...).

    Se usa la ÚLTIMA IP de X-Forwarded-For: la agrega el proxy de Railway y el
    cliente no la puede falsificar (las de la izquierda sí: las manda él). Si
    no hay encabezado (local), la IP de la conexión."""
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        last = fwd.split(",")[-1].strip()
        if last:
            return last
    return get_remote_address(request)


limiter = Limiter(key_func=client_ip)


class FailureThrottle:
    """Bloqueo por CUENTA tras N intentos fallidos en una ventana.

    El límite por IP no frena a quien rota IPs contra UNA cuenta; esto sí. En
    memoria (un solo proceso, igual que slowapi): un reinicio lo limpia, que es
    aceptable para un freno anti fuerza bruta."""

    def __init__(self, max_failures: int, window_seconds: int, max_keys: int = 20000):
        self.max_failures = max_failures
        self.window = window_seconds
        self.max_keys = max_keys
        self._fails: dict[str, deque] = {}
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> int:
        q = self._fails.get(key)
        if not q:
            self._fails.pop(key, None)
            return 0
        while q and now - q[0] > self.window:
            q.popleft()
        if not q:
            self._fails.pop(key, None)
        return len(q)

    def blocked(self, key: str) -> bool:
        with self._lock:
            return self._prune(key, time.monotonic()) >= self.max_failures

    def fail(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            if len(self._fails) >= self.max_keys and key not in self._fails:
                # Tope de memoria: fuera las cuentas cuyo último fallo es más viejo.
                oldest = sorted(self._fails, key=lambda k: self._fails[k][-1])[: self.max_keys // 10]
                for k in oldest:
                    self._fails.pop(k, None)
            self._prune(key, now)
            self._fails.setdefault(key, deque()).append(now)

    def reset(self, key: str) -> None:
        with self._lock:
            self._fails.pop(key, None)


# Login: 10 claves malas por cuenta cada 15 min.
login_failures = FailureThrottle(max_failures=10, window_seconds=15 * 60)
