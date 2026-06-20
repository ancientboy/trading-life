"""交易竞技 — 猜涨跌 / 短线 Agent 大赛 / 观众押注 / 多轮短线"""
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
ARENA_ENTRY_FEE = 30
ARENA_MAX_ENTRIES = 12
ARENA_PRIZE_SPLIT = (0.55, 0.25, 0.12)
ARENA_SPECTATOR_RAKE = 0.05
ARENA_LEG_INTERVAL_MS = 30_000

ARENA_MODES: dict[str, dict] = {
    "speed": {"join_ms": 45_000, "run_ms": 60_000, "label": "极速 60s"},
    "classic": {"join_ms": 60_000, "run_ms": 120_000, "label": "标准 3min"},
}

NPC_ARENA_AGENTS = [
    ("npc_major", "Major·系统", "major"),
    ("npc_momentum", "Momentum·系统", "momentum"),
    ("npc_xau", "XAU·系统", "xau"),
]

PRESET_LABELS: dict[str, str] = {
    "xau": "黄金趋势",
    "major": "主流币趋势",
    "altcoin": "山寨波段",
    "newcoin": "新币猎手",
    "momentum": "动量快打",
    "custom": "自定义",
}


class GuessBetBody(BaseModel):
    direction: str
    stake: int = Field(50, ge=GUESS_MIN_STAKE, le=GUESS_MAX_STAKE)


class ArenaJoinBody(BaseModel):
    agent_id: str


class ArenaSpectateBetBody(BaseModel):
    pick_user_id: str
    pick_rank: int = Field(1, ge=1, le=3)
    stake: int = Field(50, ge=20, le=300)


async def _fetch_btc_price() -> float:
    from life_trading import fetch_prices
    prices = await fetch_prices([GUESS_SYMBOL])
    return float(prices.get(GUESS_SYMBOL) or 95000.0)


def _display_name(user_id: str) -> str:
    acc = life_db.get_account_by_id(user_id) or {}
    return acc.get("display_name") or acc.get("username") or user_id[:8]


def _recent_first_flag(stats: dict, at_key: str, event_ms: int, window_ms: int = 120_000) -> bool:
    raw = stats.get(at_key)
    if not raw or not event_ms:
        return False
    try:
        from datetime import datetime, timezone, timedelta
        CST = timezone(timedelta(hours=8))
        if isinstance(raw, (int, float)):
            ts_ms = int(raw)
        else:
            dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=CST)
            ts_ms = int(dt.timestamp() * 1000)
        return abs(ts_ms - int(event_ms)) <= window_ms
    except Exception:
        return False


def _arena_timings(mode: str) -> tuple[int, int]:
    cfg = ARENA_MODES.get(mode) or ARENA_MODES["classic"]
    return int(cfg["join_ms"]), int(cfg["run_ms"])


def _next_arena_mode(c) -> str:
    row = c.execute(
        "SELECT duration_mode FROM arena_rounds WHERE status='settled' ORDER BY ends_at DESC LIMIT 1"
    ).fetchone()
    if not row:
        return "speed"
    last = row[0] if isinstance(row, tuple) else row["duration_mode"]
    return "classic" if last == "speed" else "speed"


def _leg_return(direction: str, entry: float, exit_price: float, leverage: float) -> float:
    if entry <= 0:
        return 0.0
    if direction == "SHORT":
        return (entry - exit_price) / entry * 100 * leverage
    return (exit_price - entry) / entry * 100 * leverage


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

    rd["winner_side"] = winner_side
    c.execute(
        "UPDATE guess_rounds SET winner_side=? WHERE id=?",
        (winner_side, round_id),
    )

    from trading_modes import (
        set_pending_leverage, settle_leverage_bets, settle_pk_rooms,
        update_faction_on_bet, settle_comeback_bets,
    )

    if winner_side == "tie":
        for b in bets:
            user = load_user(b["user_id"])
            _earn(user, b["stake"])
            save_user(b["user_id"], user)
            c.execute("UPDATE guess_bets SET payout=? WHERE id=?", (b["stake"], b["id"]))
        rd["winner_side"] = "tie"
        await settle_leverage_bets(c, round_id, "tie")
        await settle_pk_rooms(c, round_id, "tie")
        await settle_comeback_bets(c, round_id, "tie")
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
            life_db.record_guess_result(b["user_id"], won=True, payout=payout)
            profit = max(0, payout - int(b["stake"]))
            if profit > 0:
                set_pending_leverage(b["user_id"], profit, round_id)
            update_faction_on_bet(c, b["user_id"], int(b["stake"]), payout, b.get("faction") or "")
            if b.get("faction") and int(b["stake"]) > 0:
                life_db.bump_daily_task(b["user_id"], "faction_contrib", int(b["stake"]))
        elif b["user_id"] and not str(b["user_id"]).startswith(("npc_", "ai_")):
            life_db.record_guess_result(b["user_id"], won=False, payout=0)
            update_faction_on_bet(c, b["user_id"], int(b["stake"]), 0, b.get("faction") or "")
            if b.get("faction") and int(b["stake"]) > 0:
                life_db.bump_daily_task(b["user_id"], "faction_contrib", int(b["stake"]))
        c.execute("UPDATE guess_bets SET payout=? WHERE id=?", (payout, b["id"]))

    await settle_leverage_bets(c, round_id, winner_side)
    pk_broadcasts = await settle_pk_rooms(c, round_id, winner_side)
    await settle_comeback_bets(c, round_id, winner_side)
    rd["pk_broadcasts"] = pk_broadcasts

    rd["winner_side"] = winner_side
    rd["winners_count"] = len(winners)
    return rd


async def _decide_agent_direction(preset_id: str, meta: dict) -> tuple[str, float, str]:
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
    reason = "动量跟随"
    if closes_e and len(closes_e) >= 12:
        sig, signal_reason = evaluate_entry_signal(style, closes_e, closes_f, threshold, risk)
        if sig == "SHORT":
            direction = "SHORT"
        elif sig == "LONG":
            direction = "LONG"
        else:
            direction = "LONG" if closes_e[-1] >= closes_e[-5] else "SHORT"
            signal_reason = "tick 动量"
        reason = signal_reason or reason
    lev = float(eff.get("leverage") or 5)
    return direction, lev, reason


def _signal_summary(preset_id: str, direction: str, leverage: float, reason: str = "") -> str:
    label = PRESET_LABELS.get(preset_id or "major", preset_id or "策略")
    parts = [label, f"{direction} · {int(leverage)}x"]
    if reason:
        parts.append(reason)
    tags = []
    return " · ".join(parts)


def _entry_meta_for_arena(user_id: str, e: dict) -> dict:
    if e.get("is_npc"):
        return {"strategyPreset": e.get("strategy_preset") or "major", "risk": "中"}
    from life_game import load_user
    user = load_user(user_id)
    meta = (user.get("custom_agents") or {}).get(e.get("agent_id") or "", {})
    return meta or {"strategyPreset": e.get("strategy_preset") or "major", "risk": "中"}


async def _close_open_leg(c, round_id: str, e: dict, price: float) -> float:
    """平掉当前持仓腿，累加 return_pct，返回本腿收益。"""
    ep = float(e.get("leg_entry_price") or e.get("entry_price") or price)
    direction = e.get("leg_direction") or e.get("direction") or "LONG"
    lev = float(e.get("leverage") or 5)
    leg_ret = _leg_return(direction, ep, price, lev)
    legs_done = int(e.get("legs_count") or 0)
    cum = round(float(e.get("return_pct") or 0) + leg_ret, 3)
    c.execute(
        """INSERT INTO arena_trade_legs
           (round_id, user_id, leg, direction, leverage, entry_price, exit_price, return_pct, created_at)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (round_id, e["user_id"], legs_done, direction, lev, ep, price, round(leg_ret, 3), life_db.now_ms()),
    )
    c.execute(
        """UPDATE arena_entries SET return_pct=?, legs_count=?
           WHERE round_id=? AND user_id=?""",
        (cum, legs_done + 1, round_id, e["user_id"]),
    )
    e["return_pct"] = cum
    e["legs_count"] = legs_done + 1
    return leg_ret


async def _open_new_leg(c, round_id: str, e: dict, price: float) -> None:
    preset = e.get("strategy_preset") or "major"
    meta = _entry_meta_for_arena(e["user_id"], e)
    direction, lev, reason = await _decide_agent_direction(preset, meta)
    summary = _signal_summary(preset, direction, lev, reason)
    c.execute(
        """UPDATE arena_entries SET leg_entry_price=?, leg_direction=?, leverage=?, direction=?,
           signal_reason=?
           WHERE round_id=? AND user_id=?""",
        (price, direction, lev, direction, summary, round_id, e["user_id"]),
    )
    e["leg_entry_price"] = price
    e["leg_direction"] = direction
    e["leverage"] = lev
    e["direction"] = direction
    e["signal_reason"] = summary


async def _advance_arena_legs(c, rd: dict) -> None:
    """运行中每 30s 多轮开平仓。"""
    ts = life_db.now_ms()
    round_id = rd["id"]
    run_start = int(rd["join_ends_at"])
    if ts >= int(rd["ends_at"]) or ts < run_start:
        return
    leg_index = int((ts - run_start) // ARENA_LEG_INTERVAL_MS)
    round_last = int(rd.get("last_leg_index") or 0)
    if leg_index <= round_last:
        return

    price = await _fetch_btc_price()
    entries = [dict(e) for e in c.execute(
        "SELECT * FROM arena_entries WHERE round_id=?", (round_id,)
    ).fetchall()]
    for e in entries:
        await _close_open_leg(c, round_id, e, price)
        await _open_new_leg(c, round_id, e, price)

    c.execute("UPDATE arena_rounds SET last_leg_index=? WHERE id=?", (leg_index, round_id))
    rd["last_leg_index"] = leg_index


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
        if rd["status"] == "running":
            await _advance_arena_legs(c, rd)
            rd = dict(c.execute("SELECT * FROM arena_rounds WHERE id=?", (rd["id"],)).fetchone())
        if rd["status"] == "running" and ts >= rd["ends_at"]:
            await _settle_arena_round(c, rd["id"])
        else:
            return rd

    price = await _fetch_btc_price()
    mode = _next_arena_mode(c)
    join_ms, run_ms = _arena_timings(mode)
    rid = f"arena_{uuid.uuid4().hex[:10]}"
    starts = ts
    join_ends = ts + join_ms
    ends = join_ends + run_ms
    c.execute(
        """INSERT INTO arena_rounds
           (id, symbol, starts_at, join_ends_at, ends_at, status, entry_fee, prize_pool, spectate_pool,
            start_price, duration_mode, last_leg_index)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (rid, ARENA_SYMBOL, starts, join_ends, ends, "join", ARENA_ENTRY_FEE, 0, 0, price, mode, 0),
    )
    return dict(c.execute("SELECT * FROM arena_rounds WHERE id=?", (rid,)).fetchone())


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
            direction, lev, reason = await _decide_agent_direction(preset, {"strategyPreset": preset, "risk": "中"})
            summary = _signal_summary(preset, direction, lev, reason)
            c.execute(
                """INSERT OR IGNORE INTO arena_entries
                   (round_id, user_id, agent_id, agent_name, strategy_preset, is_npc, entry_fee,
                    direction, leverage, entry_price, leg_entry_price, leg_direction, legs_count, signal_reason)
                   VALUES (?,?,?,?,?,1,0,?,?,?,?,?,0,?)""",
                (round_id, uid, uid, name, preset, direction, lev, price, price, direction, summary),
            )

    price = await _fetch_btc_price()
    c.execute(
        "UPDATE arena_rounds SET status='running', start_price=?, last_leg_index=0 WHERE id=?",
        (price, round_id),
    )
    c.execute(
        """UPDATE arena_entries SET entry_price=?, leg_entry_price=?
           WHERE round_id=? AND (entry_price=0 OR leg_entry_price=0)""",
        (price, price, round_id),
    )


async def _settle_arena_round(c, round_id: str) -> dict:
    from life_game import load_user, save_user, _earn

    rd = dict(c.execute("SELECT * FROM arena_rounds WHERE id=?", (round_id,)).fetchone())
    end_price = await _fetch_btc_price()

    entries = [dict(e) for e in c.execute(
        "SELECT * FROM arena_entries WHERE round_id=?", (round_id,)
    ).fetchall()]
    for e in entries:
        await _close_open_leg(c, round_id, e, end_price)

    entries = [dict(e) for e in c.execute(
        "SELECT * FROM arena_entries WHERE round_id=?", (round_id,)
    ).fetchall()]
    start_price = float(rd.get("start_price") or end_price)
    c.execute(
        "UPDATE arena_rounds SET end_price=?, status='settled' WHERE id=?",
        (end_price, round_id),
    )

    entries.sort(key=lambda x: float(x.get("return_pct") or 0), reverse=True)
    prize_pool = int(rd.get("prize_pool") or 0)
    splits = ARENA_PRIZE_SPLIT
    rank_by_user: dict[str, int] = {}
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
            life_db.record_arena_result(e["user_id"], rank=rank, won=(rank == 1))
        c.execute(
            "UPDATE arena_entries SET rank=?, prize=?, return_pct=? WHERE round_id=? AND user_id=?",
            (rank, prize, float(e.get("return_pct") or 0), round_id, e["user_id"]),
        )
        e["rank"] = rank
        e["prize"] = prize
        rank_by_user[e["user_id"]] = rank

    winner_id = entries[0]["user_id"] if entries else ""
    spectate_pool = int(rd.get("spectate_pool") or 0)
    distributable = int(spectate_pool * (1 - ARENA_SPECTATOR_RAKE))
    spec_bets = [dict(b) for b in c.execute(
        "SELECT * FROM arena_spectator_bets WHERE round_id=?", (round_id,)
    ).fetchall()]
    win_bets = [
        b for b in spec_bets
        if rank_by_user.get(b["pick_user_id"], 0) == int(b.get("pick_rank") or 1)
    ]
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
        mode_label = (ARENA_MODES.get(rd.get("duration_mode") or "classic") or {}).get("label", "")
        legs = int(entries[0].get("legs_count") or 1)
        body = (
            f"🏆 短线大赛{(' · ' + mode_label) if mode_label else ''} · {entries[0].get('agent_name') or 'Agent'} "
            f"收益率 {entries[0]['return_pct']:+.2f}% · {legs} 轮操作 · 奖池 {prize_pool}"
        )
        ts = life_db.now_ms()
        c.execute(
            "INSERT INTO chat_messages (channel, user_id, display_name, agent_id, body, kind, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            ("global", entries[0]["user_id"], acc.get("display_name") or "选手", entries[0].get("agent_id", ""), body, "highlight", ts),
        )

    return {"round": rd, "entries": entries, "winner_id": winner_id}


def _entry_legs(c, round_id: str, user_id: str, limit: int = 5) -> list[dict]:
    rows = c.execute(
        """SELECT leg, direction, return_pct, entry_price, exit_price, created_at
           FROM arena_trade_legs WHERE round_id=? AND user_id=?
           ORDER BY leg DESC LIMIT ?""",
        (round_id, user_id, limit),
    ).fetchall()
    return [dict(r) for r in rows]


def _guess_payload(c, rd: dict, account_id: str) -> dict:
    ts = life_db.now_ms()
    bets = [dict(b) for b in c.execute("SELECT * FROM guess_bets WHERE round_id=?", (rd["id"],)).fetchall()]
    my = next((b for b in bets if b["user_id"] == account_id), None) if account_id else None
    modes_extra = {}
    if account_id:
        from trading_modes import modes_payload
        modes_extra = modes_payload(account_id)
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
        **modes_extra,
    }


def _arena_payload(c, rd: dict, account_id: str = "") -> dict:
    ts = life_db.now_ms()
    entries_raw = [dict(e) for e in c.execute(
        "SELECT * FROM arena_entries WHERE round_id=? ORDER BY return_pct DESC, agent_name ASC",
        (rd["id"],),
    ).fetchall()]
    entries = []
    for e in entries_raw:
        pub = {**e}
        pub["display_name"] = _display_name(e["user_id"]) if not e.get("is_npc") else e.get("agent_name")
        pub["signal_summary"] = e.get("signal_reason") or _signal_summary(
            e.get("strategy_preset") or "major",
            e.get("leg_direction") or e.get("direction") or "LONG",
            float(e.get("leverage") or 5),
        )
        pub["recent_legs"] = _entry_legs(c, rd["id"], e["user_id"], 8)
        pub["all_legs"] = _entry_legs(c, rd["id"], e["user_id"], 20)
        entries.append(pub)
    my_entry = next((e for e in entries if account_id and e["user_id"] == account_id), None)
    spec = []
    if account_id:
        spec = [dict(b) for b in c.execute(
            "SELECT * FROM arena_spectator_bets WHERE round_id=? AND user_id=?",
            (rd["id"], account_id),
        ).fetchall()]
    mode = rd.get("duration_mode") or "classic"
    mode_cfg = ARENA_MODES.get(mode) or ARENA_MODES["classic"]
    _, run_ms = _arena_timings(mode)
    return {
        "round_id": rd["id"],
        "symbol": rd["symbol"],
        "status": rd["status"],
        "duration_mode": mode,
        "duration_label": mode_cfg.get("label", mode),
        "run_seconds": run_ms // 1000,
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
        "leg_interval_sec": ARENA_LEG_INTERVAL_MS // 1000,
        "entries": entries,
        "my_entry": my_entry,
        "my_spectator_bets": spec,
        "can_join": rd["status"] == "join" and ts < rd["join_ends_at"] and len(entries) < ARENA_MAX_ENTRIES,
        "can_spectate_bet": rd["status"] == "join" and ts < rd["join_ends_at"],
    }


def _arena_win_rate_rows(c, limit: int = 15) -> list[dict]:
    rows = c.execute(
        """SELECT e.user_id,
                  COUNT(*) AS entries,
                  SUM(CASE WHEN e.rank = 1 THEN 1 ELSE 0 END) AS wins,
                  SUM(CASE WHEN e.rank <= 3 THEN 1 ELSE 0 END) AS podium,
                  MAX(e.return_pct) AS best_return
           FROM arena_entries e
           JOIN arena_rounds r ON r.id = e.round_id
           WHERE r.status = 'settled' AND e.is_npc = 0 AND e.rank > 0
           GROUP BY e.user_id
           HAVING entries >= 1
           ORDER BY (1.0 * wins / entries) DESC, wins DESC, best_return DESC
           LIMIT ?""",
        (min(limit, 50),),
    ).fetchall()
    out = []
    for i, r in enumerate(rows):
        d = dict(r)
        ent = int(d["entries"] or 0)
        wins = int(d["wins"] or 0)
        d["win_rate"] = round(wins / ent * 100, 1) if ent else 0
        d["display_name"] = _display_name(d["user_id"])
        d["rank"] = i + 1
        out.append(d)
    return out


@events_router.get("/pvp/trading/guess")
async def get_guess_round(account_id: str = Depends(resolve_account_id)):
    with life_db._lock:
        with life_db._conn() as c:
            rd = await _ensure_guess_round(c)
            payload = _guess_payload(c, rd, account_id)
            prev = c.execute(
                "SELECT * FROM guess_rounds WHERE status='settled' ORDER BY ends_at DESC LIMIT 1"
            ).fetchone()
            last_my = None
            if prev and account_id:
                bet_row = c.execute(
                    "SELECT * FROM guess_bets WHERE round_id=? AND user_id=?",
                    (prev["id"], account_id),
                ).fetchone()
                if bet_row:
                    last_my = dict(bet_row)
                    ws = prev["winner_side"] if "winner_side" in prev.keys() else None
                    if not ws and prev.get("end_price") and prev.get("start_price"):
                        sp, ep = float(prev["start_price"]), float(prev["end_price"])
                        ws = "tie" if abs(ep - sp) < 1e-9 else ("up" if ep > sp else "down")
                    last_my["won"] = bool(ws and ws != "tie" and last_my["direction"] == ws)
                    if last_my.get("won") and account_id:
                        from life_game import load_user
                        stats = (load_user(account_id).get("stats") or {})
                        last_my["first_win"] = _recent_first_flag(stats, "first_guess_win_at", prev["ends_at"])
                        from trading_modes import get_pending_leverage
                        pl = get_pending_leverage(stats)
                        if pl:
                            last_my["pending_leverage"] = pl
            last_pk = None
            if prev and account_id:
                from trading_modes import PK_RAKE, _display_name as _pk_name
                pk_row = c.execute(
                    """SELECT * FROM guess_pk_rooms
                       WHERE round_id=? AND status='settled'
                       AND (user_a=? OR user_b=?)
                       ORDER BY settled_at DESC LIMIT 1""",
                    (prev["id"], account_id, account_id),
                ).fetchone()
                if pk_row:
                    room = dict(pk_row)
                    ws = prev["winner_side"] if "winner_side" in prev.keys() else ""
                    if not ws and prev.get("end_price") and prev.get("start_price"):
                        sp, ep = float(prev["start_price"]), float(prev["end_price"])
                        ws = "tie" if abs(ep - sp) < 1e-9 else ("up" if ep > sp else "down")
                    is_a = room["user_a"] == account_id
                    my_dir = room["dir_a"] if is_a else room["dir_b"]
                    won = room["winner_id"] == account_id
                    opp_id = room["user_b"] if is_a else room["user_a"]
                    opp_name = "AI 对手" if str(opp_id).startswith("npc_") else _pk_name(opp_id)
                    from life_game import load_user
                    stats = (load_user(account_id).get("stats") or {})
                    streak = int(stats.get("daily_modes", {}).get("pk_streak", 0)) if won else 0
                    last_pk = {
                        "won": won,
                        "my_direction": my_dir,
                        "winner_side": ws,
                        "opponent_name": opp_name,
                        "stake": int(room["stake"]),
                        "won_amount": int(room["stake"] * 2 * (1 - PK_RAKE)) if won else 0,
                        "streak": streak,
                        "round_id": room["round_id"],
                    }
    last = dict(prev) if prev else None
    if last and last_my:
        last["my_bet"] = last_my
    return {"ok": True, "current": payload, "last_settled": last, "last_my_bet": last_my, "last_pk_result": last_pk}


@events_router.post("/pvp/trading/guess/bet")
async def place_guess_bet(body: GuessBetBody, account_id: str = Depends(resolve_account_id)):
    from life_game import load_user, save_user, _spend

    direction = (body.direction or "").lower()
    if direction not in ("up", "down"):
        return {"ok": False, "error": "direction 须为 up 或 down"}
    stake = max(GUESS_MIN_STAKE, min(body.stake, GUESS_MAX_STAKE))
    user = load_user(account_id)
    stats = user.get("stats") or {}
    faction = stats.get("faction") or ""
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
                "INSERT INTO guess_bets (round_id, user_id, direction, stake, faction, created_at) VALUES (?,?,?,?,?,?)",
                (rd["id"], account_id, direction, stake, faction, ts),
            )
            col = "pool_up" if direction == "up" else "pool_down"
            c.execute(f"UPDATE guess_rounds SET {col}={col}+? WHERE id=?", (stake, rd["id"]))
            row = dict(c.execute("SELECT * FROM guess_rounds WHERE id=?", (rd["id"],)).fetchone())
            payload = _guess_payload(c, row, account_id)

    life_db.add_season_points(account_id, social=2)
    life_db.bump_daily_task(account_id, "guess")
    return {"ok": True, "current": payload, "balance": load_user(account_id)["points"]}


@events_router.get("/pvp/trading/arena")
async def get_arena_round(account_id: str = Depends(resolve_account_id)):
    last_settled_payload = None
    with life_db._lock:
        with life_db._conn() as c:
            rd = await _ensure_arena_round(c)
            payload = _arena_payload(c, rd, account_id)
            prev = c.execute(
                "SELECT * FROM arena_rounds WHERE status='settled' ORDER BY ends_at DESC LIMIT 1"
            ).fetchone()
            if prev:
                last_settled_payload = _arena_payload(c, dict(prev), account_id)
                if account_id:
                    from life_game import load_user
                    stats = (load_user(account_id).get("stats") or {})
                    my = last_settled_payload.get("my_entry")
                    if my and my.get("rank") and int(my["rank"]) <= 3:
                        last_settled_payload["first_podium"] = _recent_first_flag(
                            stats, "first_arena_podium_at", prev["ends_at"],
                        )
    return {"ok": True, "current": payload, "last_settled": last_settled_payload}


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
    direction, lev, reason = await _decide_agent_direction(preset, meta)
    summary = _signal_summary(preset, direction, lev, reason)
    price = float(rd.get("start_price") or await _fetch_btc_price())

    with life_db._lock:
        with life_db._conn() as c:
            c.execute(
                """INSERT INTO arena_entries
                   (round_id, user_id, agent_id, agent_name, strategy_preset, is_npc, entry_fee,
                    direction, leverage, entry_price, leg_entry_price, leg_direction, legs_count, signal_reason)
                   VALUES (?,?,?,?,?,0,?,?,?,?,?,?,0,?)""",
                (rd["id"], account_id, agent_id, meta.get("name") or agent_id, preset, fee, direction, lev, price, price, direction, summary),
            )
            c.execute(
                "UPDATE arena_rounds SET prize_pool=prize_pool+? WHERE id=?",
                (fee, rd["id"]),
            )
            rd2 = dict(c.execute("SELECT * FROM arena_rounds WHERE id=?", (rd["id"],)).fetchone())
            payload = _arena_payload(c, rd2, account_id)

    life_db.add_season_points(account_id, social=3)
    mode_label = (ARENA_MODES.get(rd.get("duration_mode") or "classic") or {}).get("label", "")
    return {
        "ok": True,
        "message": f"{meta.get('name')} 已报名 · {mode_label} · AI 判定 {direction} · {lev}x · 30s 多轮短线",
        "current": payload,
        "balance": load_user(account_id)["points"],
    }


@events_router.post("/pvp/trading/arena/spectate-bet")
async def arena_spectate_bet(body: ArenaSpectateBetBody, account_id: str = Depends(resolve_account_id)):
    from life_game import load_user, save_user, _spend

    pick = (body.pick_user_id or "").strip()
    pick_rank = max(1, min(3, int(body.pick_rank or 1)))
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
                """INSERT INTO arena_spectator_bets
                   (round_id, user_id, pick_user_id, pick_rank, stake, created_at)
                   VALUES (?,?,?,?,?,?)""",
                (rd["id"], account_id, pick, pick_rank, stake, ts),
            )
            c.execute(
                "UPDATE arena_rounds SET spectate_pool=spectate_pool+? WHERE id=?",
                (stake, rd["id"]),
            )
            rd2 = dict(c.execute("SELECT * FROM arena_rounds WHERE id=?", (rd["id"],)).fetchone())
            payload = _arena_payload(c, rd2, account_id)

    rank_label = {1: "冠军", 2: "亚军", 3: "季军"}.get(pick_rank, f"第{pick_rank}名")
    return {
        "ok": True,
        "message": f"已押 {rank_label} · {stake} 积分",
        "current": payload,
        "balance": load_user(account_id)["points"],
    }


@events_router.get("/pvp/trading/arena/leaderboard")
async def arena_leaderboard(limit: int = 10):
    with life_db._lock:
        with life_db._conn() as c:
            rows = c.execute(
                """SELECT e.agent_name, e.user_id, e.return_pct, e.rank, e.prize, e.strategy_preset,
                          e.direction, e.leverage, e.legs_count, r.id as round_id, r.ends_at, r.duration_mode
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


@events_router.get("/pvp/trading/arena/win-rate")
async def arena_win_rate(limit: int = 15):
    with life_db._lock:
        with life_db._conn() as c:
            rows = _arena_win_rate_rows(c, limit)
    return {"ok": True, "entries": rows}


async def public_arena_snapshot() -> dict:
    """未登录观赛 — 当前大赛 + 三甲 + 胜率榜。"""
    with life_db._lock:
        with life_db._conn() as c:
            rd = await _ensure_arena_round(c)
            current = _arena_payload(c, rd, "")
            highlights = []
            rows = c.execute(
                """SELECT e.agent_name, e.user_id, e.return_pct, e.rank, e.prize, e.legs_count,
                          r.duration_mode, r.ends_at
                   FROM arena_entries e
                   JOIN arena_rounds r ON r.id=e.round_id
                   WHERE r.status='settled' AND e.rank > 0 AND e.rank <= 3
                   ORDER BY r.ends_at DESC LIMIT 9""",
            ).fetchall()
            for r in rows:
                d = dict(r)
                d["display_name"] = _display_name(d["user_id"]) if not str(d["user_id"]).startswith("npc_") else d["agent_name"]
                highlights.append(d)
            win_rate = _arena_win_rate_rows(c, 8)
    return {
        "ok": True,
        "current": current,
        "highlights": highlights,
        "win_rate_board": win_rate,
        "message": "注册即可参赛 · 押冠亚季军 · AI 每 30s 多轮短线操作",
    }
