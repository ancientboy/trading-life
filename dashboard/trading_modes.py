"""交易竞技进阶玩法 — 杠杆翻倍 / 1v1 PK / 阵营团战 / 逆袭副本 / 人格图鉴"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

import life_db
from life_auth import resolve_account_id

modes_router = APIRouter()

CST = timezone(timedelta(hours=8))

LEVERAGE_OPTIONS = (2, 5, 10)
LEVERAGE_DAILY_MAX = 5
LEVERAGE_10X_DAILY_MAX = 1
PK_MIN_STAKE = 20
PK_MAX_STAKE = 300
PK_RAKE = 0.10
PK_AI_WIN_RATE = 0.46
FACTION_SWITCH_COST = 50
FACTION_SETTLE_HOUR = 22
COMEBACK_SEED = 100
COMEBACK_MAX_ROUNDS = 3
COMEBACK_LEVERAGE = 2
COMEBACK_LOSS_TRIGGER = 500
DAILY_NET_WIN_CAP = 2000

PERSONALITY_LABELS = {
    "risk_taker": "梭哈客", "steady": "稳健派", "duelist": "单挑王", "peaceful": "和平Trader",
    "bull": "死多头", "bear": "死空头", "swing": "墙头草", "arena_fan": "赛场常客",
    "guesser": "纯猜党", "comeback_king": "打不死的小强", "social": "社交型",
}


class LeverageBetBody(BaseModel):
    direction: str
    leverage: int = Field(2, ge=2, le=10)
    source_round_id: str = ""


class PkBetBody(BaseModel):
    direction: str
    stake: int = Field(50, ge=PK_MIN_STAKE, le=PK_MAX_STAKE)
    vs_ai: bool = True


class FactionJoinBody(BaseModel):
    faction: str


class ComebackBetBody(BaseModel):
    direction: str


def _day_key() -> str:
    return datetime.now(CST).strftime("%Y%m%d")


def _display_name(user_id: str) -> str:
    acc = life_db.get_account_by_id(user_id) or {}
    return acc.get("display_name") or acc.get("username") or user_id[:8]


def _load_stats(uid: str) -> dict:
    from life_game import load_user
    return (load_user(uid).get("stats") or {}) if uid else {}


def _save_stats(uid: str, stats: dict) -> None:
    life_db.save_user_stats(uid, stats)


def _ensure_daily_stats(stats: dict) -> dict:
    dk = _day_key()
    daily = stats.setdefault("daily_modes", {})
    if daily.get("day_key") != dk:
        daily.clear()
        daily["day_key"] = dk
        daily["leverage_count"] = 0
        daily["leverage_10x"] = 0
        daily["guess_net"] = 0
        daily["pk_wins"] = 0
        daily["pk_streak"] = 0
        daily["pk_best_streak"] = 0
        daily["comeback_used"] = False
    return stats


def _cap_daily_win(uid: str, amount: int) -> int:
    if amount <= 0 or not uid or uid.startswith(("npc_", "ai_")):
        return amount
    from life_game import load_user, save_user

    user = load_user(uid)
    stats = _ensure_daily_stats(user.get("stats") or {})
    net = int(stats["daily_modes"].get("guess_net", 0))
    if net >= DAILY_NET_WIN_CAP:
        return 0
    allowed = min(amount, DAILY_NET_WIN_CAP - net)
    stats["daily_modes"]["guess_net"] = net + allowed
    user["stats"] = stats
    save_user(uid, user)
    return allowed


def record_personality_event(uid: str, event: str, **kw) -> None:
    if not uid or uid.startswith(("npc_", "ai_")):
        return

    def mut(stats: dict) -> None:
        stats = _ensure_daily_stats(stats)
        p = stats.setdefault("personality", {})
        counters = p.setdefault("counters", {})
        if event == "guess_leverage":
            lev = int(kw.get("leverage", 2))
            counters["leverage_total"] = int(counters.get("leverage_total", 0)) + 1
            counters["leverage_sum"] = int(counters.get("leverage_sum", 0)) + lev
            if lev >= 10:
                counters["leverage_10x"] = int(counters.get("leverage_10x", 0)) + 1
        elif event == "guess_win":
            counters["guess_wins"] = int(counters.get("guess_wins", 0)) + 1
        elif event == "pk_win":
            counters["pk_wins"] = int(counters.get("pk_wins", 0)) + 1
            counters["pk_games"] = int(counters.get("pk_games", 0)) + 1
            streak = int(stats["daily_modes"].get("pk_streak", 0)) + 1
            stats["daily_modes"]["pk_streak"] = streak
            stats["daily_modes"]["pk_best_streak"] = max(int(stats["daily_modes"].get("pk_best_streak", 0)), streak)
        elif event == "pk_loss":
            counters["pk_games"] = int(counters.get("pk_games", 0)) + 1
            stats["daily_modes"]["pk_streak"] = 0
        elif event == "faction_contrib":
            counters["faction_contrib"] = int(counters.get("faction_contrib", 0)) + int(kw.get("amount", 0))
        elif event == "comeback_win":
            counters["comeback_wins"] = int(counters.get("comeback_wins", 0)) + 1
        elif event == "arena_join":
            counters["arena_joins"] = int(counters.get("arena_joins", 0)) + 1

    life_db._mutate_user_stats(uid, mut)


def compute_personality(stats: dict) -> dict:
    stats = _ensure_daily_stats(stats or {})
    p = stats.get("personality") or {}
    c = p.get("counters") or {}
    faction = stats.get("faction") or ""
    lev_total = int(c.get("leverage_total", 0))
    lev_sum = int(c.get("leverage_sum", 0))
    lev_avg = (lev_sum / lev_total) if lev_total else 1
    pk_wins = int(c.get("pk_wins", 0))
    pk_games = int(c.get("pk_games", 0))
    pk_rate = (pk_wins / pk_games * 100) if pk_games else 0
    arena_joins = int(c.get("arena_joins", 0))
    guess_wins = int(c.get("guess_wins", 0))
    comeback_wins = int(c.get("comeback_wins", 0))

    dims = {
        "risk": min(100, int(lev_avg * 25 + int(c.get("leverage_10x", 0)) * 15)),
        "duel": min(100, pk_rate + min(pk_games, 20) * 2),
        "faction_loyalty": 80 if faction else 20,
        "arena": min(100, arena_joins * 8),
        "guess": min(100, guess_wins * 3),
        "resilience": min(100, comeback_wins * 20 + 20),
    }
    tags = []
    if dims["risk"] >= 60:
        tags.append("risk_taker")
    elif dims["risk"] < 35:
        tags.append("steady")
    if dims["duel"] >= 55:
        tags.append("duelist")
    elif pk_games < 3:
        tags.append("peaceful")
    if faction == "bull":
        tags.append("bull")
    elif faction == "bear":
        tags.append("bear")
    if dims["arena"] >= 50:
        tags.append("arena_fan")
    else:
        tags.append("guesser")
    if dims["resilience"] >= 50:
        tags.append("comeback_king")

    primary = tags[0] if tags else "guesser"
    secondary = tags[1] if len(tags) > 1 else "peaceful"
    title = f"{PERSONALITY_LABELS.get(primary, primary)}·{PERSONALITY_LABELS.get(secondary, secondary)}"

    tier = "none"
    score = sum(dims.values()) // len(dims)
    if score >= 75:
        tier = "gold"
    elif score >= 50:
        tier = "silver"
    elif score >= 25:
        tier = "bronze"

    return {
        "title": title,
        "primary": primary,
        "secondary": secondary,
        "dimensions": dims,
        "tier": tier,
        "score": score,
        "chat_prefix": f"[{tier[0].upper() if tier != 'none' else '·'}·{PERSONALITY_LABELS.get(primary, primary)[:2]}]",
    }


def set_pending_leverage(uid: str, profit: int, source_round_id: str) -> None:
    if profit <= 0:
        return
    expires = life_db.now_ms() + 120_000

    def mut(stats: dict) -> None:
        stats["pending_leverage"] = {
            "profit": profit,
            "source_round_id": source_round_id,
            "expires_at": expires,
        }

    life_db._mutate_user_stats(uid, mut)


def get_pending_leverage(stats: dict) -> Optional[dict]:
    pl = stats.get("pending_leverage")
    if not pl:
        return None
    if life_db.now_ms() > int(pl.get("expires_at", 0)):
        return None
    return pl


def clear_pending_leverage(uid: str) -> None:
    def mut(stats: dict) -> None:
        stats.pop("pending_leverage", None)

    life_db._mutate_user_stats(uid, mut)


async def settle_leverage_bets(c, round_id: str, winner_side: str) -> None:
    from life_game import load_user, save_user, _earn

    rows = [dict(r) for r in c.execute(
        "SELECT * FROM leverage_bets WHERE round_id=? AND payout=0", (round_id,)
    ).fetchall()]
    for b in rows:
        uid = b["user_id"]
        won = winner_side != "tie" and b["direction"] == winner_side
        payout = 0
        if won:
            payout = int(b["profit_stake"] * int(b["leverage"]))
            payout = _cap_daily_win(uid, payout)
            if payout > 0:
                user = load_user(uid)
                _earn(user, payout)
                save_user(uid, user)
                record_personality_event(uid, "guess_win")
        clear_pending_leverage(uid)
        c.execute("UPDATE leverage_bets SET payout=? WHERE id=?", (payout, b["id"]))
        record_personality_event(uid, "guess_leverage", leverage=int(b["leverage"]))


async def settle_pk_rooms(c, round_id: str, winner_side: str) -> list[dict]:
    from life_game import load_user, save_user, _earn

    broadcasts = []
    rows = [dict(r) for r in c.execute(
        "SELECT * FROM guess_pk_rooms WHERE round_id=? AND status='open'", (round_id,)
    ).fetchall()]
    for room in rows:
        if winner_side == "tie":
            for uid in (room["user_a"], room["user_b"]):
                if uid.startswith("npc_"):
                    continue
                user = load_user(uid)
                refund = int(room["stake"] * 0.9)
                _earn(user, refund)
                save_user(uid, user)
            c.execute(
                "UPDATE guess_pk_rooms SET status='settled', winner_id='', settled_at=? WHERE id=?",
                (life_db.now_ms(), room["id"]),
            )
            continue

        win_a = room["dir_a"] == winner_side
        win_b = room["dir_b"] == winner_side
        winner = room["user_a"] if win_a else (room["user_b"] if win_b else "")
        distributable = int(room["stake"] * 2 * (1 - PK_RAKE))
        if winner and not str(winner).startswith("npc_"):
            user = load_user(winner)
            won = _cap_daily_win(winner, distributable)
            if won > 0:
                _earn(user, won)
                save_user(winner, user)
            record_personality_event(winner, "pk_win")
            loser = room["user_b"] if winner == room["user_a"] else room["user_a"]
            if loser and not str(loser).startswith("npc_"):
                record_personality_event(loser, "pk_loss")
            streak = _load_stats(winner).get("daily_modes", {}).get("pk_streak", 0)
            if streak >= 3:
                broadcasts.append({
                    "type": "pk_streak",
                    "user_id": winner,
                    "display_name": _display_name(winner),
                    "streak": streak,
                })
        c.execute(
            "UPDATE guess_pk_rooms SET status='settled', winner_id=?, settled_at=? WHERE id=?",
            (winner, life_db.now_ms(), room["id"]),
        )
    return broadcasts


def update_faction_on_bet(c, uid: str, stake: int, payout: int, faction: str) -> None:
    if not faction or not uid or uid.startswith("npc_"):
        return
    dk = _day_key()
    net = payout - stake
    row = c.execute(
        "SELECT contrib, net_pnl FROM faction_daily WHERE day_key=? AND user_id=?",
        (dk, uid),
    ).fetchone()
    if row:
        c.execute(
            "UPDATE faction_daily SET contrib=contrib+?, net_pnl=net_pnl+?, faction=? WHERE day_key=? AND user_id=?",
            (stake, net, faction, dk, uid),
        )
    else:
        c.execute(
            "INSERT INTO faction_daily (day_key, user_id, faction, contrib, net_pnl) VALUES (?,?,?,?,?)",
            (dk, uid, faction, stake, net),
        )
    record_personality_event(uid, "faction_contrib", amount=stake)


def faction_status(c) -> dict:
    dk = _day_key()
    bulls = c.execute(
        "SELECT SUM(net_pnl) AS net, SUM(contrib) AS contrib, COUNT(*) AS members FROM faction_daily WHERE day_key=? AND faction='bull'",
        (dk,),
    ).fetchone()
    bears = c.execute(
        "SELECT SUM(net_pnl) AS net, SUM(contrib) AS contrib, COUNT(*) AS members FROM faction_daily WHERE day_key=? AND faction='bear'",
        (dk,),
    ).fetchone()
    b_net = int((dict(bulls)["net"] if bulls else 0) or 0)
    r_net = int((dict(bears)["net"] if bears else 0) or 0)
    total = abs(b_net) + abs(r_net) or 1
    return {
        "day_key": dk,
        "bull": {"net_pnl": b_net, "contrib": int((dict(bulls)["contrib"] if bulls else 0) or 0),
                 "members": int((dict(bulls)["members"] if bulls else 0) or 0),
                 "lead_pct": round(max(0, b_net) / total * 100, 1) if b_net >= r_net else 0},
        "bear": {"net_pnl": r_net, "contrib": int((dict(bears)["contrib"] if bears else 0) or 0),
                 "members": int((dict(bears)["members"] if bears else 0) or 0),
                 "lead_pct": round(max(0, r_net) / total * 100, 1) if r_net > b_net else 0},
        "leading": "bull" if b_net >= r_net else "bear",
        "settle_hour": FACTION_SETTLE_HOUR,
    }


def maybe_settle_faction_day(c) -> Optional[dict]:
    now = datetime.now(CST)
    if now.hour < FACTION_SETTLE_HOUR:
        return None
    dk = _day_key()
    if c.execute("SELECT 1 FROM faction_settlements WHERE day_key=?", (dk,)).fetchone():
        return None
    status = faction_status(c)
    winner = status["leading"]
    loser_pool = int(abs(status["bull"]["net_pnl"] if winner == "bear" else status["bear"]["net_pnl"]))
    distributable = int(loser_pool * 0.4)
    winners = [dict(r) for r in c.execute(
        "SELECT user_id, contrib FROM faction_daily WHERE day_key=? AND faction=? AND net_pnl > 0",
        (dk, winner),
    ).fetchall()]
    total_contrib = sum(int(w["contrib"]) for w in winners) or 1
    from life_game import load_user, save_user, _earn

    payouts = []
    for w in winners:
        share = int(distributable * (int(w["contrib"]) / total_contrib))
        if share > 0:
            user = load_user(w["user_id"])
            _earn(user, share)
            save_user(w["user_id"], user)
            payouts.append({"user_id": w["user_id"], "payout": share})
    c.execute(
        "INSERT INTO faction_settlements (day_key, winner_faction, pool, settled_at) VALUES (?,?,?,?)",
        (dk, winner, distributable, life_db.now_ms()),
    )
    return {"day_key": dk, "winner": winner, "pool": distributable, "payouts": payouts}


def check_comeback_trigger(uid: str) -> bool:
    from life_game import load_user, save_user

    user = load_user(uid)
    stats = _ensure_daily_stats(user.get("stats") or {})
    if stats["daily_modes"].get("comeback_used"):
        return False
    if stats.get("comeback", {}).get("active"):
        return True
    net = int(stats["daily_modes"].get("guess_net", 0))
    if net > -COMEBACK_LOSS_TRIGGER:
        return False
    stats["comeback"] = {
        "active": True,
        "seed": COMEBACK_SEED,
        "balance": COMEBACK_SEED,
        "rounds_left": COMEBACK_MAX_ROUNDS,
        "triggered_at": life_db.now_ms(),
        "day_key": _day_key(),
    }
    stats["daily_modes"]["comeback_used"] = True
    user["stats"] = stats
    save_user(uid, user)
    return True


def modes_payload(account_id: str) -> dict:
    stats = _load_stats(account_id) if account_id else {}
    stats = _ensure_daily_stats(stats)
    pl = get_pending_leverage(stats)
    comeback = stats.get("comeback") if stats.get("comeback", {}).get("active") else None
    with life_db._lock:
        with life_db._conn() as c:
            fs = faction_status(c)
            maybe_settle_faction_day(c)
            pk_open = c.execute(
                "SELECT * FROM guess_pk_rooms WHERE status='open' AND (user_a=? OR user_b=?) ORDER BY created_at DESC LIMIT 1",
                (account_id, account_id),
            ).fetchone()
            streak_board = [dict(r) for r in c.execute(
                """SELECT user_id, MAX(streak) AS best_streak FROM (
                       SELECT user_id, json_extract(stats_json, '$.daily_modes.pk_best_streak') AS streak
                       FROM life_users WHERE stats_json LIKE '%pk_best_streak%'
                   ) GROUP BY user_id ORDER BY best_streak DESC LIMIT 10"""
            ).fetchall()] if False else []
            # simplified streak from stats
    daily = stats.get("daily_modes", {})
    return {
        "pending_leverage": pl,
        "leverage_uses_left": max(0, LEVERAGE_DAILY_MAX - int(daily.get("leverage_count", 0))),
        "leverage_10x_left": max(0, LEVERAGE_10X_DAILY_MAX - int(daily.get("leverage_10x", 0))),
        "faction": stats.get("faction"),
        "faction_status": fs,
        "comeback": comeback,
        "personality": compute_personality(stats),
        "pk_streak": int(daily.get("pk_streak", 0)),
        "pk_best_streak": int(daily.get("pk_best_streak", 0)),
        "my_pk_room": dict(pk_open) if pk_open else None,
    }


@modes_router.get("/pvp/trading/modes")
async def get_trading_modes(account_id: str = Depends(resolve_account_id)):
    return {"ok": True, **modes_payload(account_id)}


@modes_router.post("/pvp/trading/guess/leverage")
async def place_leverage_bet(body: LeverageBetBody, account_id: str = Depends(resolve_account_id)):
    from life_game import load_user, save_user
    from trading_events import _ensure_guess_round, GUESS_BET_WINDOW_MS

    direction = (body.direction or "").lower()
    if direction not in ("up", "down"):
        return {"ok": False, "error": "direction 须为 up 或 down"}
    leverage = body.leverage if body.leverage in LEVERAGE_OPTIONS else 2

    user = load_user(account_id)
    stats = _ensure_daily_stats(user.get("stats") or {})
    pl = get_pending_leverage(stats)
    if not pl:
        return {"ok": False, "error": "暂无可用利润，请先赢得一局普通猜涨跌"}
    if int(stats["daily_modes"].get("leverage_count", 0)) >= LEVERAGE_DAILY_MAX:
        return {"ok": False, "error": "今日杠杆局次数已用完"}
    if leverage >= 10 and int(stats["daily_modes"].get("leverage_10x", 0)) >= LEVERAGE_10X_DAILY_MAX:
        return {"ok": False, "error": "今日 10x 已用完"}

    profit = int(pl["profit"])
    with life_db._lock:
        with life_db._conn() as c:
            rd = await _ensure_guess_round(c)
            ts = life_db.now_ms()
            if rd["status"] != "open" or ts >= rd["starts_at"] + GUESS_BET_WINDOW_MS:
                return {"ok": False, "error": "本局已封盘，等待下一局"}
            if c.execute(
                "SELECT 1 FROM leverage_bets WHERE round_id=? AND user_id=?",
                (rd["id"], account_id),
            ).fetchone():
                return {"ok": False, "error": "本局杠杆已押"}
            c.execute(
                """INSERT INTO leverage_bets (round_id, user_id, direction, profit_stake, leverage, source_round_id, created_at)
                   VALUES (?,?,?,?,?,?,?)""",
                (rd["id"], account_id, direction, profit, leverage, pl.get("source_round_id", ""), ts),
            )

    stats["daily_modes"]["leverage_count"] = int(stats["daily_modes"].get("leverage_count", 0)) + 1
    if leverage >= 10:
        stats["daily_modes"]["leverage_10x"] = int(stats["daily_modes"].get("leverage_10x", 0)) + 1
    clear_pending_leverage(account_id)
    user["stats"] = stats
    save_user(account_id, user)
    record_personality_event(account_id, "guess_leverage", leverage=leverage)
    life_db.bump_daily_task(account_id, "leverage")
    return {
        "ok": True,
        "message": f"已用 {profit} 利润押 {leverage}x {direction}",
        "modes": modes_payload(account_id),
    }


@modes_router.post("/pvp/trading/pk/bet")
async def place_pk_bet(body: PkBetBody, account_id: str = Depends(resolve_account_id)):
    from trading_events import _ensure_guess_round, GUESS_BET_WINDOW_MS
    import random

    direction = (body.direction or "").lower()
    if direction not in ("up", "down"):
        return {"ok": False, "error": "direction 须为 up 或 down"}
    stake = max(PK_MIN_STAKE, min(body.stake, PK_MAX_STAKE))
    rid = ""
    matched = False

    with life_db._lock:
        with life_db._conn() as c:
            rd = await _ensure_guess_round(c)
            ts = life_db.now_ms()
            if rd["status"] != "open" or ts >= rd["starts_at"] + GUESS_BET_WINDOW_MS:
                return {"ok": False, "error": "本局已封盘"}
            ok, balance = life_db._adjust_points_cursor(c, account_id, -stake)
            if not ok:
                return {"ok": False, "error": "积分不足", "balance": balance}

            if body.vs_ai:
                opp_id = f"npc_pk_{uuid.uuid4().hex[:6]}"
                opp_dir = "down" if direction == "up" else "up"
                if random.random() < PK_AI_WIN_RATE:
                    opp_dir = direction
                rid = f"pk_{uuid.uuid4().hex[:10]}"
                c.execute(
                    """INSERT INTO guess_pk_rooms (id, round_id, user_a, user_b, dir_a, dir_b, stake, is_npc_b, status, created_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?)""",
                    (rid, rd["id"], account_id, opp_id, direction, opp_dir, stake, 1, "open", ts),
                )
            else:
                waiting = c.execute(
                    """SELECT * FROM guess_pk_rooms WHERE status='waiting' AND user_a!=? AND stake=? LIMIT 1""",
                    (account_id, stake),
                ).fetchone()
                if waiting:
                    room = dict(waiting)
                    matched_dir = "down" if room["dir_a"] == "up" else "up"
                    c.execute(
                        """UPDATE guess_pk_rooms SET user_b=?, dir_b=?, status='open' WHERE id=?""",
                        (account_id, matched_dir, room["id"]),
                    )
                    rid = room["id"]
                    matched = True
                else:
                    rid = f"pk_{uuid.uuid4().hex[:10]}"
                    c.execute(
                        """INSERT INTO guess_pk_rooms (id, round_id, user_a, user_b, dir_a, dir_b, stake, is_npc_b, status, created_at)
                           VALUES (?,?,?,?,?,?,?,?,?,?)""",
                        (rid, rd["id"], account_id, "", direction, "", stake, 0, "waiting", ts),
                    )

    life_db.bump_daily_task(account_id, "pk")
    msg = f"PK {'匹配成功' if matched else ('等待对手' if not body.vs_ai else '已开局')} · 押{'涨' if direction == 'up' else '跌'} · {stake} 积分"
    return {
        "ok": True,
        "message": msg,
        "room_id": rid,
        "matched": matched,
        "modes": modes_payload(account_id),
    }


@modes_router.get("/pvp/trading/pk/streak-board")
async def pk_streak_board():
    with life_db._lock:
        with life_db._conn() as c:
            rows = c.execute(
                """SELECT winner_id AS user_id, COUNT(*) AS wins FROM guess_pk_rooms
                   WHERE status='settled' AND winner_id != '' AND created_at > ?
                   GROUP BY winner_id ORDER BY wins DESC LIMIT 10""",
                (life_db.now_ms() - 7 * 86400_000,),
            ).fetchall()
    items = []
    for i, r in enumerate(rows):
        d = dict(r)
        d["display_name"] = _display_name(d["user_id"])
        d["rank"] = i + 1
        items.append(d)
    return {"ok": True, "entries": items}


@modes_router.post("/pvp/trading/faction/join")
async def join_faction(body: FactionJoinBody, account_id: str = Depends(resolve_account_id)):
    from life_game import load_user, save_user, _spend

    faction = (body.faction or "").lower()
    if faction not in ("bull", "bear"):
        return {"ok": False, "error": "faction 须为 bull 或 bear"}
    user = load_user(account_id)
    stats = _ensure_daily_stats(user.get("stats") or {})
    old = stats.get("faction")
    if old and old != faction:
        if not _spend(user, FACTION_SWITCH_COST):
            save_user(account_id, user)
            return {"ok": False, "error": f"换阵营需 {FACTION_SWITCH_COST} 积分"}
    stats["faction"] = faction
    user["stats"] = stats
    save_user(account_id, user)
    return {"ok": True, "faction": faction, "modes": modes_payload(account_id)}


@modes_router.get("/pvp/trading/faction/status")
async def get_faction_status(account_id: str = Depends(resolve_account_id)):
    with life_db._lock:
        with life_db._conn() as c:
            fs = faction_status(c)
            settlement = maybe_settle_faction_day(c)
    stats = _load_stats(account_id)
    return {"ok": True, "status": fs, "my_faction": stats.get("faction"), "settlement": settlement}


@modes_router.get("/pvp/trading/comeback/status")
async def comeback_status(account_id: str = Depends(resolve_account_id)):
    triggered = check_comeback_trigger(account_id)
    return {"ok": True, "triggered": triggered, "modes": modes_payload(account_id)}


@modes_router.post("/pvp/trading/comeback/bet")
async def comeback_bet(body: ComebackBetBody, account_id: str = Depends(resolve_account_id)):
    from trading_events import _ensure_guess_round, GUESS_BET_WINDOW_MS

    direction = (body.direction or "").lower()
    if direction not in ("up", "down"):
        return {"ok": False, "error": "direction 须为 up 或 down"}
    user_stats = _load_stats(account_id)
    cb = user_stats.get("comeback")
    if not cb or not cb.get("active") or int(cb.get("rounds_left", 0)) <= 0:
        return {"ok": False, "error": "逆袭副本未开启或次数已用完"}
    seed = int(cb.get("balance", COMEBACK_SEED))
    if seed <= 0:
        return {"ok": False, "error": "逆袭金已耗尽"}

    with life_db._lock:
        with life_db._conn() as c:
            rd = await _ensure_guess_round(c)
            ts = life_db.now_ms()
            if rd["status"] != "open" or ts >= rd["starts_at"] + GUESS_BET_WINDOW_MS:
                return {"ok": False, "error": "本局已封盘"}
            if c.execute(
                "SELECT 1 FROM comeback_bets WHERE round_id=? AND user_id=?", (rd["id"], account_id)
            ).fetchone():
                return {"ok": False, "error": "本局逆袭已押"}
            c.execute(
                "INSERT INTO comeback_bets (round_id, user_id, direction, stake, leverage, created_at) VALUES (?,?,?,?,?,?)",
                (rd["id"], account_id, direction, seed, COMEBACK_LEVERAGE, ts),
            )

    def mut(stats: dict) -> None:
        cb2 = stats.get("comeback", {})
        cb2["rounds_left"] = int(cb2.get("rounds_left", 1)) - 1
        stats["comeback"] = cb2

    life_db._mutate_user_stats(account_id, mut)
    return {"ok": True, "message": f"逆袭局 · {COMEBACK_LEVERAGE}x · 押{'涨' if direction == 'up' else '跌'}", "modes": modes_payload(account_id)}


async def settle_comeback_bets(c, round_id: str, winner_side: str) -> None:
    from life_game import load_user, save_user

    rows = [dict(r) for r in c.execute(
        "SELECT * FROM comeback_bets WHERE round_id=? AND payout=0", (round_id,)
    ).fetchall()]
    for b in rows:
        uid = b["user_id"]
        user = load_user(uid)
        stats = user.get("stats") or {}
        cb = stats.get("comeback", {})
        won = winner_side != "tie" and b["direction"] == winner_side
        payout = 0
        if won:
            payout = int(b["stake"] * COMEBACK_LEVERAGE)
            cb["balance"] = payout
            if payout >= 200:
                cb["active"] = False
                record_personality_event(uid, "comeback_win")
                user["points"] = user.get("points", 0) + payout
        else:
            cb["balance"] = 0
        stats["comeback"] = cb
        user["stats"] = stats
        save_user(uid, user)
        c.execute("UPDATE comeback_bets SET payout=? WHERE id=?", (payout, b["id"]))


@modes_router.get("/pvp/trading/personality")
async def get_personality(account_id: str = Depends(resolve_account_id)):
    stats = _load_stats(account_id)
    return {"ok": True, "personality": compute_personality(stats)}
