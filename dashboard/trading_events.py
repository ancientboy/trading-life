"""交易竞技 — 猜涨跌 / 短线 Agent 大赛 / 观众押注"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

import life_db
from life_auth import resolve_account_id

events_router = APIRouter()

GUESS_SYMBOL = "BTCUSDT"
GUESS_DURATION_MS = 60_000
GUESS_BET_WINDOW_MS = 50_000
GUESS_MIN_STAKE = 10
GUESS_MAX_STAKE = 500
GUESS_RAKE = 0.05

ARENA_SYMBOL = "BTCUSDT"
ARENA_JOIN_MS = 60_000
ARENA_RUN_MS = 120_000
ARENA_ENTRY_FEE = 30
ARENA_MAX_ENTRIES = 12
ARENA_PRIZE_SPLIT = (0.55, 0.25, 0.12)
ARENA_SPECTATOR_RAKE = 0.05

NPC_ARENA_AGENTS = [
    ("npc_major", "Major·系统", "major"),
    ("npc_momentum", "Momentum·系统", "momentum"),
    ("npc_xau", "XAU·系统", "xau"),
]


class GuessBetBody(BaseModel):
    direction: str
    stake: int = Field(50, ge=GUESS_MIN_STAKE, le=GUESS_MAX_STAKE)


class ArenaJoinBody(BaseModel):
    agent_id: str


class ArenaSpectateBetBody(BaseModel):
    pick_user_id: str
    stake: int = Field(50, ge=20, le=300)


async def _fetch_btc_price() -> float:
    from life_trading import fetch_prices
    prices = await fetch_prices([GUESS_SYMBOL])
    return float(prices.get(GUESS_SYMBOL) or 95000.0)


def _display_name(user_id: str) -> str:
    acc = life_db.get_account_by_id(user_id) or {}
    return acc.get("display_name") or acc.get("username") or user_id[:8]


async def _ensure_guess_round(c) -> dict:
    ts = life_db.now_ms()
    row = c.execute(
        "SELECT * FROM guess_rounds WHERE status IN ('open','locked') ORDER BY starts_at DESC LIMIT 1"
    ).fetchone()
    if row:
        rd = dict(row)
        if ts >= rd["ends_at"]:
            await _settle_guess_round(c, rd["id"])
        else:
            if ts >= rd["starts_at"] + GUESS_BET_WINDOW_MS and rd["status"] == "open":
                c.execute("UPDATE guess_rounds SET status='locked' WHERE id=?", (rd["id"],))
                rd["status"] = "locked"
            return rd

    price = await _fetch_btc_price()
    rid = f"guess_{uuid.uuid4().hex[:10]}"
    starts = ts
    ends = ts + GUESS_DURATION_MS
    c.execute(
        """INSERT INTO guess_rounds (id, symbol, start_price, starts_at, ends_at, status, pool_up, pool_down)
           VALUES (?,?,?,?,?,?,?,?)""",
        (rid, GUESS_SYMBOL, price, starts, ends, "open", 0, 0),
    )
    return dict(c.execute("SELECT * FROM guess_rounds WHERE id=?", (rid,)).fetchone())


async def _settle_guess_round(c, round_id: str) -> Optional[dict]:
    from life_game import load_user, save_user, _earn

    row = c.execute("SELECT * FROM guess_rounds WHERE id=?", (round_id,)).fetchone()
    if not row or row["status"] == "settled":
        return None
    rd = dict(row)
    end_price = await _fetch_btc_price()
    start_price = float(rd["start_price"])
    c.execute(
        "UPDATE guess_rounds SET end_price=?, status='settled' WHERE id=?",
        (end_price, round_id),
    )
    rd["end_price"] = end_price
    rd["status"] = "settled"

    if abs(end_price - start_price) < 1e-9:
        winner_side = "tie"
    elif end_price > start_price:
        winner_side = "up"
    else:
        winner_side = "down"

    bets = [dict(b) for b in c.execute("SELECT * FROM guess_bets WHERE round_id=?", (round_id,)).fetchall()]
    total_pool = int(rd["pool_up"]) + int(rd["pool_down"])
    distributable = int(total_pool * (1 - GUESS_RAKE))

    if winner_side == "tie":
        for b in bets:
            user = load_user(b["user_id"])
            _earn(user, b["stake"])
            save_user(b["user_id"], user)
            c.execute("UPDATE guess_bets SET payout=? WHERE id=?", (b["stake"], b["id"]))
        rd["winner_side"] = "tie"
        return rd

    win_pool = int(rd["pool_up"]) if winner_side == "up" else int(rd["pool_down"])
    winners = [b for b in bets if b["direction"] == winner_side]
    for b in bets:
        payout = 0
        if b in winners and win_pool > 0:
            payout = int(distributable * (b["stake"] / win_pool))
        if payout > 0:
            user = load_user(b["user_id"])
            _earn(user, payout)
            save_user(b["user_id"], user)
            life_db.add_season_points(b["user_id"], pvp_win=1, social=3)
        c.execute("UPDATE guess_bets SET payout=? WHERE id=?", (payout, b["id"]))

    rd["winner_side"] = winner_side
    rd["winners_count"] = len(winners)
    return rd


async def _ensure_arena_round(c) -> dict:
    ts = life_db.now_ms()
    row = c.execute(
        "SELECT * FROM arena_rounds WHERE status IN ('join','running') ORDER BY starts_at DESC LIMIT 1"
    ).fetchone()
    if row:
        rd = dict(row)
        if rd["status"] == "join" and ts >= rd["join_ends_at"]:
            await _start_arena_round(c, rd["id"])
            rd = dict(c.execute("SELECT * FROM arena_rounds WHERE id=?", (rd["id"],)).fetchone())
        if rd["status"] == "running" and ts >= rd["ends_at"]:
            await _settle_arena_round(c, rd["id"])
        else:
            return rd

    price = await _fetch_btc_price()
    rid = f"arena_{uuid.uuid4().hex[:10]}"
    starts = ts
    join_ends = ts + ARENA_JOIN_MS
    ends = join_ends + ARENA_RUN_MS
    c.execute(
        """INSERT INTO arena_rounds
           (id, symbol, starts_at, join_ends_at, ends_at, status, entry_fee, prize_pool, spectate_pool, start_price)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (rid, ARENA_SYMBOL, starts, join_ends, ends, "join", ARENA_ENTRY_FEE, 0, 0, price),
    )
    return dict(c.execute("SELECT * FROM arena_rounds WHERE id=?", (rid,)).fetchone())


async def _decide_agent_direction(preset_id: str, meta: dict) -> tuple[str, float]:
    from life_trading import (
        effective_preset, evaluate_entry_signal, fetch_kline_map,
        parse_kline_intervals,
    )

    eff = effective_preset(preset_id, meta)
    entry_iv, filter_iv = parse_kline_intervals(meta.get("interval", ""), eff)
    sym = ARENA_SYMBOL
    klines = await fetch_kline_map({(sym, entry_iv), (sym, filter_iv)})
    closes_e = klines.get((sym, entry_iv), [])
    closes_f = klines.get((sym, filter_iv), [])
    threshold = float(eff.get("threshold_pct", 0.3))
    risk = meta.get("risk") or eff.get("risk", "中")
    style = eff.get("style", "trend")
    direction = "LONG"
    if closes_e and len(closes_e) >= 12:
        sig, _ = evaluate_entry_signal(style, closes_e, closes_f, threshold, risk)
        if sig == "SHORT":
            direction = "SHORT"
        elif sig == "LONG":
            direction = "LONG"
        else:
            direction = "LONG" if closes_e[-1] >= closes_e[-5] else "SHORT"
    lev = float(eff.get("leverage") or 5)
    return direction, lev


async def _start_arena_round(c, round_id: str) -> None:
    entries = [dict(e) for e in c.execute(
        "SELECT * FROM arena_entries WHERE round_id=?", (round_id,)
    ).fetchall()]
    if len(entries) < 3:
        for uid, name, preset in NPC_ARENA_AGENTS:
            if c.execute(
                "SELECT 1 FROM arena_entries WHERE round_id=? AND user_id=?",
                (round_id, uid),
            ).fetchone():
                continue
            price = float(c.execute("SELECT start_price FROM arena_rounds WHERE id=?", (round_id,)).fetchone()[0])
            direction, lev = await _decide_agent_direction(preset, {"strategyPreset": preset, "risk": "中"})
            c.execute(
                """INSERT OR IGNORE INTO arena_entries
                   (round_id, user_id, agent_id, agent_name, strategy_preset, is_npc, entry_fee,
                    direction, leverage, entry_price)
                   VALUES (?,?,?,?,?,1,0,?,?,?)""",
                (round_id, uid, uid, name, preset, direction, lev, price),
            )

    price = await _fetch_btc_price()
    c.execute(
        "UPDATE arena_rounds SET status='running', start_price=? WHERE id=?",
        (price, round_id),
    )
    c.execute(
        "UPDATE arena_entries SET entry_price=? WHERE round_id=? AND entry_price=0",
        (price, round_id),
    )


async def _settle_arena_round(c, round_id: str) -> dict:
    from life_game import load_user, save_user, _earn

    rd = dict(c.execute("SELECT * FROM arena_rounds WHERE id=?", (round_id,)).fetchone())
    end_price = await _fetch_btc_price()
    start_price = float(rd.get("start_price") or end_price)
    c.execute(
        "UPDATE arena_rounds SET end_price=?, status='settled' WHERE id=?",
        (end_price, round_id),
    )

    entries = [dict(e) for e in c.execute(
        "SELECT * FROM arena_entries WHERE round_id=?", (round_id,)
    ).fetchall()]
    for e in entries:
        ep = float(e.get("entry_price") or start_price)
        lev = float(e.get("leverage") or 5)
        if e.get("direction") == "SHORT":
            ret = (ep - end_price) / ep * 100 * lev
        else:
            ret = (end_price - ep) / ep * 100 * lev
        e["return_pct"] = round(ret, 3)
        c.execute(
            "UPDATE arena_entries SET return_pct=?, entry_price=? WHERE round_id=? AND user_id=?",
            (e["return_pct"], ep, round_id, e["user_id"]),
        )

    entries.sort(key=lambda x: x["return_pct"], reverse=True)
    prize_pool = int(rd.get("prize_pool") or 0)
    splits = ARENA_PRIZE_SPLIT
    for i, e in enumerate(entries):
        rank = i + 1
        prize = 0
        if rank <= len(splits) and prize_pool > 0:
            prize = int(prize_pool * splits[rank - 1])
        if prize > 0 and not e.get("is_npc"):
            user = load_user(e["user_id"])
            _earn(user, prize)
            save_user(e["user_id"], user)
            life_db.add_season_points(e["user_id"], pvp_win=1 if rank == 1 else 0, pnl=e["return_pct"], social=5)
        c.execute(
            "UPDATE arena_entries SET rank=?, prize=? WHERE round_id=? AND user_id=?",
            (rank, prize, round_id, e["user_id"]),
        )
        e["rank"] = rank
        e["prize"] = prize

    winner_id = entries[0]["user_id"] if entries else ""
    spectate_pool = int(rd.get("spectate_pool") or 0)
    distributable = int(spectate_pool * (1 - ARENA_SPECTATOR_RAKE))
    spec_bets = [dict(b) for b in c.execute(
        "SELECT * FROM arena_spectator_bets WHERE round_id=?", (round_id,)
    ).fetchall()]
    win_bets = [b for b in spec_bets if b["pick_user_id"] == winner_id]
    win_stake = sum(b["stake"] for b in win_bets)
    for b in spec_bets:
        payout = 0
        if b in win_bets and win_stake > 0:
            payout = int(distributable * (b["stake"] / win_stake))
        if payout > 0:
            user = load_user(b["user_id"])
            _earn(user, payout)
            save_user(b["user_id"], user)
        c.execute("UPDATE arena_spectator_bets SET payout=? WHERE id=?", (payout, b["id"]))

    if winner_id and entries:
        acc = life_db.get_account_by_id(entries[0]["user_id"]) or {}
        body = (
            f"🏆 短线大赛 · {entries[0].get('agent_name') or 'Agent'} "
            f"收益率 {entries[0]['return_pct']:+.2f}% · 奖池 {prize_pool}"
        )
        ts = life_db.now_ms()
        c.execute(
            "INSERT INTO chat_messages (channel, user_id, display_name, agent_id, body, kind, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            ("global", entries[0]["user_id"], acc.get("display_name") or "选手", entries[0].get("agent_id", ""), body, "highlight", ts),
        )

    return {"round": rd, "entries": entries, "winner_id": winner_id}


def _guess_payload(c, rd: dict, account_id: str) -> dict:
    ts = life_db.now_ms()
    bets = [dict(b) for b in c.execute("SELECT * FROM guess_bets WHERE round_id=?", (rd["id"],)).fetchall()]
    my = next((b for b in bets if b["user_id"] == account_id), None)
    return {
        "round_id": rd["id"],
        "symbol": rd["symbol"],
        "start_price": rd["start_price"],
        "end_price": rd.get("end_price") or 0,
        "status": rd["status"],
        "pool_up": rd["pool_up"],
        "pool_down": rd["pool_down"],
        "total_pool": int(rd["pool_up"]) + int(rd["pool_down"]),
        "starts_at": rd["starts_at"],
        "ends_at": rd["ends_at"],
        "betting_open": rd["status"] == "open" and ts < rd["starts_at"] + GUESS_BET_WINDOW_MS,
        "seconds_left": max(0, (rd["ends_at"] - ts) // 1000),
        "my_bet": my,
        "bets_count": len(bets),
    }


def _arena_payload(c, rd: dict, account_id: str) -> dict:
    ts = life_db.now_ms()
    entries = [dict(e) for e in c.execute(
        "SELECT * FROM arena_entries WHERE round_id=? ORDER BY return_pct DESC, agent_name ASC",
        (rd["id"],),
    ).fetchall()]
    my_entry = next((e for e in entries if e["user_id"] == account_id), None)
    spec = [dict(b) for b in c.execute(
        "SELECT * FROM arena_spectator_bets WHERE round_id=? AND user_id=?",
        (rd["id"], account_id),
    ).fetchall()]
    return {
        "round_id": rd["id"],
        "symbol": rd["symbol"],
        "status": rd["status"],
        "entry_fee": rd["entry_fee"],
        "prize_pool": rd["prize_pool"],
        "spectate_pool": rd["spectate_pool"],
        "start_price": rd.get("start_price") or 0,
        "end_price": rd.get("end_price") or 0,
        "starts_at": rd["starts_at"],
        "join_ends_at": rd["join_ends_at"],
        "ends_at": rd["ends_at"],
        "seconds_left": max(0, (rd["ends_at"] - ts) // 1000),
        "join_seconds_left": max(0, (rd["join_ends_at"] - ts) // 1000),
        "entries": entries,
        "my_entry": my_entry,
        "my_spectator_bets": spec,
        "can_join": rd["status"] == "join" and ts < rd["join_ends_at"] and len(entries) < ARENA_MAX_ENTRIES,
        "can_spectate_bet": rd["status"] == "join" and ts < rd["join_ends_at"],
    }


@events_router.get("/pvp/trading/guess")
async def get_guess_round(account_id: str = Depends(resolve_account_id)):
    with life_db._lock:
        with life_db._conn() as c:
            rd = await _ensure_guess_round(c)
            payload = _guess_payload(c, rd, account_id)
            prev = c.execute(
                "SELECT * FROM guess_rounds WHERE status='settled' ORDER BY ends_at DESC LIMIT 1"
            ).fetchone()
    last = dict(prev) if prev else None
    return {"ok": True, "current": payload, "last_settled": last}


@events_router.post("/pvp/trading/guess/bet")
async def place_guess_bet(body: GuessBetBody, account_id: str = Depends(resolve_account_id)):
    from life_game import load_user, save_user, _spend

    direction = (body.direction or "").lower()
    if direction not in ("up", "down"):
        return {"ok": False, "error": "direction 须为 up 或 down"}
    stake = max(GUESS_MIN_STAKE, min(body.stake, GUESS_MAX_STAKE))
    user = load_user(account_id)
    if not _spend(user, stake):
        save_user(account_id, user)
        return {"ok": False, "error": "积分不足", "balance": user["points"]}
    save_user(account_id, user)

    with life_db._lock:
        with life_db._conn() as c:
            rd = await _ensure_guess_round(c)
            ts = life_db.now_ms()
            if rd["status"] != "open" or ts >= rd["starts_at"] + GUESS_BET_WINDOW_MS:
                user = load_user(account_id)
                user["points"] = user.get("points", 0) + stake
                save_user(account_id, user)
                return {"ok": False, "error": "本局已封盘", "balance": user["points"]}
            if c.execute(
                "SELECT 1 FROM guess_bets WHERE round_id=? AND user_id=?",
                (rd["id"], account_id),
            ).fetchone():
                user = load_user(account_id)
                user["points"] = user.get("points", 0) + stake
                save_user(account_id, user)
                return {"ok": False, "error": "本局已押注", "balance": user["points"]}
            c.execute(
                "INSERT INTO guess_bets (round_id, user_id, direction, stake, created_at) VALUES (?,?,?,?,?)",
                (rd["id"], account_id, direction, stake, ts),
            )
            col = "pool_up" if direction == "up" else "pool_down"
            c.execute(f"UPDATE guess_rounds SET {col}={col}+? WHERE id=?", (stake, rd["id"]))
            row = dict(c.execute("SELECT * FROM guess_rounds WHERE id=?", (rd["id"],)).fetchone())
            payload = _guess_payload(c, row, account_id)

    life_db.add_season_points(account_id, social=2)
    return {"ok": True, "current": payload, "balance": load_user(account_id)["points"]}


@events_router.get("/pvp/trading/arena")
async def get_arena_round(account_id: str = Depends(resolve_account_id)):
    with life_db._lock:
        with life_db._conn() as c:
            rd = await _ensure_arena_round(c)
            payload = _arena_payload(c, rd, account_id)
    return {"ok": True, "current": payload}


@events_router.post("/pvp/trading/arena/join")
async def join_arena(body: ArenaJoinBody, account_id: str = Depends(resolve_account_id)):
    from life_game import load_user, save_user, _spend

    agent_id = (body.agent_id or "").strip()
    user = load_user(account_id)
    meta = (user.get("custom_agents") or {}).get(agent_id)
    if not meta or meta.get("agentType") == "entertainment":
        return {"ok": False, "error": "请选择你的交易 Agent"}

    with life_db._lock:
        with life_db._conn() as c:
            rd = await _ensure_arena_round(c)
            ts = life_db.now_ms()
            if rd["status"] != "join" or ts >= rd["join_ends_at"]:
                return {"ok": False, "error": "报名已截止"}
            if c.execute(
                "SELECT 1 FROM arena_entries WHERE round_id=? AND user_id=?",
                (rd["id"], account_id),
            ).fetchone():
                return {"ok": False, "error": "已报名本局"}
            cnt = c.execute("SELECT COUNT(*) FROM arena_entries WHERE round_id=?", (rd["id"],)).fetchone()[0]
            if cnt >= ARENA_MAX_ENTRIES:
                return {"ok": False, "error": "名额已满"}

    fee = int(rd.get("entry_fee") or ARENA_ENTRY_FEE)
    if not _spend(user, fee):
        save_user(account_id, user)
        return {"ok": False, "error": f"积分不足（报名费 {fee}）", "balance": user["points"]}
    save_user(account_id, user)

    preset = meta.get("strategyPreset") or meta.get("strategy_preset") or "major"
    direction, lev = await _decide_agent_direction(preset, meta)
    price = float(rd.get("start_price") or await _fetch_btc_price())

    with life_db._lock:
        with life_db._conn() as c:
            c.execute(
                """INSERT INTO arena_entries
                   (round_id, user_id, agent_id, agent_name, strategy_preset, is_npc, entry_fee,
                    direction, leverage, entry_price)
                   VALUES (?,?,?,?,?,0,?,?,?,?)""",
                (rd["id"], account_id, agent_id, meta.get("name") or agent_id, preset, fee, direction, lev, price),
            )
            c.execute(
                "UPDATE arena_rounds SET prize_pool=prize_pool+? WHERE id=?",
                (fee, rd["id"]),
            )
            rd2 = dict(c.execute("SELECT * FROM arena_rounds WHERE id=?", (rd["id"],)).fetchone())
            payload = _arena_payload(c, rd2, account_id)

    life_db.add_season_points(account_id, social=3)
    return {
        "ok": True,
        "message": f"{meta.get('name')} 已报名 · AI 判定 {direction} · {lev}x",
        "current": payload,
        "balance": load_user(account_id)["points"],
    }


@events_router.post("/pvp/trading/arena/spectate-bet")
async def arena_spectate_bet(body: ArenaSpectateBetBody, account_id: str = Depends(resolve_account_id)):
    from life_game import load_user, save_user, _spend

    pick = (body.pick_user_id or "").strip()
    stake = max(20, min(body.stake, 300))
    if not pick:
        return {"ok": False, "error": "请选择押注选手"}

    with life_db._lock:
        with life_db._conn() as c:
            rd = await _ensure_arena_round(c)
            ts = life_db.now_ms()
            if rd["status"] != "join" or ts >= rd["join_ends_at"]:
                return {"ok": False, "error": "押注已截止"}
            if not c.execute(
                "SELECT 1 FROM arena_entries WHERE round_id=? AND user_id=?",
                (rd["id"], pick),
            ).fetchone():
                return {"ok": False, "error": "选手未报名"}
            if pick == account_id:
                return {"ok": False, "error": "不能押注自己"}

    user = load_user(account_id)
    if not _spend(user, stake):
        save_user(account_id, user)
        return {"ok": False, "error": "积分不足", "balance": user["points"]}
    save_user(account_id, user)

    with life_db._lock:
        with life_db._conn() as c:
            ts = life_db.now_ms()
            c.execute(
                """INSERT INTO arena_spectator_bets (round_id, user_id, pick_user_id, stake, created_at)
                   VALUES (?,?,?,?,?)""",
                (rd["id"], account_id, pick, stake, ts),
            )
            c.execute(
                "UPDATE arena_rounds SET spectate_pool=spectate_pool+? WHERE id=?",
                (stake, rd["id"]),
            )
            rd2 = dict(c.execute("SELECT * FROM arena_rounds WHERE id=?", (rd["id"],)).fetchone())
            payload = _arena_payload(c, rd2, account_id)

    return {"ok": True, "current": payload, "balance": load_user(account_id)["points"]}


@events_router.get("/pvp/trading/arena/leaderboard")
async def arena_leaderboard(limit: int = 10):
    with life_db._lock:
        with life_db._conn() as c:
            rows = c.execute(
                """SELECT e.agent_name, e.user_id, e.return_pct, e.rank, e.prize, e.strategy_preset,
                          e.direction, e.leverage, r.id as round_id, r.ends_at
                   FROM arena_entries e
                   JOIN arena_rounds r ON r.id=e.round_id
                   WHERE r.status='settled' AND e.rank > 0 AND e.rank <= 3
                   ORDER BY r.ends_at DESC LIMIT ?""",
                (min(limit, 30),),
            ).fetchall()
    items = []
    for r in rows:
        d = dict(r)
        d["display_name"] = _display_name(d["user_id"]) if not str(d["user_id"]).startswith("npc_") else d["agent_name"]
        items.append(d)
    return {"ok": True, "highlights": items}
