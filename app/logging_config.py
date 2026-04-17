import logging
import sys
import uuid
from contextvars import ContextVar
from pythonjsonlogger import jsonlogger

request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")
club_id_ctx: ContextVar[str] = ContextVar("club_id", default="-")


class ContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_ctx.get()
        record.club_id = club_id_ctx.get()
        return True


def setup_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.addFilter(ContextFilter())
    formatter = jsonlogger.JsonFormatter(
        "%(asctime)s %(levelname)s %(name)s %(request_id)s %(club_id)s %(message)s",
        rename_fields={"asctime": "ts", "levelname": "level", "name": "logger"},
    )
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)

    for noisy in ("uvicorn.access",):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def new_request_id() -> str:
    return uuid.uuid4().hex[:12]
