"""Stack promedio del torneo (T4).

Fuente única de la matemática de fichas: total de fichas en juego y stack
promedio sobre jugadores activos. Funciona tanto con el modelo Tournament como
con el schema TournamentResponse (duck-typing: ambos tienen las columnas de
fichas + .players con los contadores y status).

Las "fichas" NO son plata: son los puntos que cada jugada agrega al stack del
jugador (buy-in => starting_stack; rebuy/addon sencillo/doble y tip => *_chips).
En un torneo las fichas de un jugador eliminado siguen EN JUEGO (pasaron a quien
lo eliminó), así que el total cuenta todas las entradas y el promedio se divide
sobre los jugadores ACTIVOS (estándar de poker: 'average stack').
"""


def _int(v) -> int:
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        return 0


def chip_stats(tournament) -> dict:
    """Devuelve {total_chips, average_stack, active_players} para un torneo."""
    players = getattr(tournament, "players", None) or []
    starting = _int(getattr(tournament, "starting_stack", 0))
    rc = _int(getattr(tournament, "rebuy_chips", 0))
    drc = _int(getattr(tournament, "double_rebuy_chips", 0))
    ac = _int(getattr(tournament, "addon_chips", 0))
    dac = _int(getattr(tournament, "double_addon_chips", 0))
    tc = _int(getattr(tournament, "tip_chips", 0))

    total = 0
    active = 0
    for p in players:
        rebuys = _int(getattr(p, "rebuys_count", 0))
        d_rebuys = _int(getattr(p, "double_rebuys_count", 0))
        addons = _int(getattr(p, "addons_count", 0))
        d_addons = _int(getattr(p, "double_addons_count", 0))
        tips = _int(getattr(p, "tips_count", 0))
        s_rebuys = max(0, rebuys - d_rebuys)   # invariante: sencillos = total - dobles
        s_addons = max(0, addons - d_addons)
        total += (starting
                  + s_rebuys * rc + d_rebuys * drc
                  + s_addons * ac + d_addons * dac
                  + tips * tc)
        if getattr(p, "status", None) == "ACTIVE":
            active += 1

    average = round(total / active) if active else 0
    return {"total_chips": total, "average_stack": average, "active_players": active}
