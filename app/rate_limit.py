import ipaddress
import threading
import time
from collections import OrderedDict, deque

from slowapi import Limiter
from slowapi.util import get_remote_address


def _ip(value):
    try:
        return str(ipaddress.ip_address((value or "").strip()))
    except ValueError:
        return None


def client_ip(request) -> str:
    """IP real del cliente detrás del proxy de Railway.

    get_remote_address ve la IP del PROXY, así que todos compartían UN cupo.

    1) X-Real-IP: es el encabezado que Railway documenta para la IP del
       cliente y su borde lo SOBRESCRIBE en cada request (el cliente no lo
       puede falsificar). Verificado en prod: X-Forwarded-For llega siempre
       con 2 entradas aunque el cliente mande una falsa, o sea que Railway lo
       reescribe y la última es un salto interno, no el cliente.
    2) Respaldo: última entrada de X-Forwarded-For (última línea).
    3) Sin encabezados (local): la IP de la conexión."""
    real = _ip(request.headers.get("x-real-ip"))
    if real:
        return real
    lines = request.headers.getlist("x-forwarded-for")
    if lines:
        last = _ip(lines[-1].split(",")[-1])
        if last:
            return last
    return get_remote_address(request)


def global_key(request) -> str:
    """Un solo cupo para todo el sitio: tope de respaldo encima del límite por
    IP en endpoints que mandan correos o crean cosas (registro, recuperar
    clave, activar). Así rotar IPs no permite volumen ilimitado."""
    return "global"


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
        # OrderedDict: el más recientemente fallado al final (para desalojar
        # primero lo vencido y después lo más viejo, sin ordenar todo).
        self._fails: "OrderedDict[str, deque]" = OrderedDict()
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
            self._prune(key, now)
            if len(self._fails) >= self.max_keys and key not in self._fails:
                # Tope de memoria: primero se va lo vencido; si no alcanza, lo
                # que lleva más tiempo sin fallar. Una cuenta que sigue siendo
                # atacada siempre está al final y no se desaloja.
                for k in [k for k, q in self._fails.items() if not q or now - q[-1] > self.window]:
                    self._fails.pop(k, None)
                while len(self._fails) >= self.max_keys:
                    self._fails.popitem(last=False)
            self._fails.setdefault(key, deque()).append(now)
            self._fails.move_to_end(key)

    def reset(self, key: str) -> None:
        with self._lock:
            self._fails.pop(key, None)


# Claves malas por PERSONA (teléfono o email): 10 cada 15 min. Lo usan el
# login y la vinculación de una 2ª cuenta en la activación (que prueba la
# clave de la cuenta hermana).
login_failures = FailureThrottle(max_failures=10, window_seconds=15 * 60)
