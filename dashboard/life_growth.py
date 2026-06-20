"""增长 / 裂变 — 邀请返利、公开围观、战报分享"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

import life_db
from life_auth import resolve_account_id

growth_router = APIRouter()

REFERRAL_INVITEE_BONUS = 500
REFERRAL_INVITER_SIGNUP = 300
REFERRAL_INVITER_POKER = 200


class ReferralRemindBody(BaseModel):
    invitee_id: str


def _resolve_room_id(c, room_id_or_code: str) -> Optional[str]:
    from life_engagement import _resolve_room_id as _r
    return _r(c, room_id_or_code)


@growth_router.get("/growth/referral")
async def get_my_referral(account_id: str = Depends(resolve_account_id)):
    life_db.maybe_push_pending_poker_nudges(account_id)
    summary = life_db.get_referral_summary(account_id)
    return {"ok": True, **summary}


@growth_router.post("/growth/referral/remind")
async def remind_invitee_poker(body: ReferralRemindBody, account_id: str = Depends(resolve_account_id)):
    out = life_db.remind_invitee_poker(account_id, (body.invitee_id or "").strip())
    if not out.get("ok"):
        return out
    acc = life_db.get_account_by_id(account_id) or {}
    name = acc.get("display_name") or acc.get("username") or "好友"
    return {"ok": True, "message": f"已提醒好友，等待 TA 打一局德州"}


@growth_router.get("/growth/notifications")
async def get_growth_notifications(account_id: str = Depends(resolve_account_id)):
    life_db.maybe_push_invitee_poker_nudge(account_id)
    messages = life_db.pop_life_notifications(account_id)
    return {"ok": True, "messages": messages}


@growth_router.get("/growth/weekly-report")
async def get_weekly_report(account_id: str = Depends(resolve_account_id)):
    report = life_db.get_weekly_report(account_id)
    return {"ok": True, "report": report}


@growth_router.get("/growth/poker/highlights")
async def list_poker_highlights(since_id: int = 0, limit: int = 15):
    items = life_db.list_poker_highlights(since_id=since_id, limit=limit)
    return {"ok": True, "highlights": items, "latest_id": items[-1]["id"] if items else since_id}


@growth_router.get("/public/poker/demo")
async def public_poker_demo():
    """未登录试玩 — 一键看 1 手 AI 对决（30 秒 hook）"""
    from poker_hands import play_round, card_display, compare_hands

    demo_names = ["AI·小冰", "AI·Jack", "AI·小火"]
    round_data = play_round(3)
    community = round_data["community_cards"]
    buy_in = 30
    pot = buy_in * len(demo_names)

    hands_by_seat = {h["seat"]: h for h in round_data["players"]}
    player_hands = [(demo_names[i], hands_by_seat[i]) for i in range(len(demo_names))]
    player_hands.sort(key=lambda x: x[1]["hand_score"], reverse=True)

    comp_ranks: list[int] = []
    i = 0
    while i < len(player_hands):
        j = i + 1
        while j < len(player_hands) and compare_hands(
            player_hands[j][1]["hand_score"], player_hands[i][1]["hand_score"]
        ) == 0:
            j += 1
        rank = i + 1
        for _ in range(i, j):
            comp_ranks.append(rank)
        i = j

    best_score = player_hands[0][1]["hand_score"]
    winner_count = sum(
        1 for _, h in player_hands if compare_hands(h["hand_score"], best_score) == 0
    )
    split_win = pot // winner_count if winner_count else 0
    split_extra = pot - split_win * winner_count if winner_count else 0
    extra_left = split_extra

    results = []
    for rank_idx, (name, hand) in enumerate(player_hands):
        rank = comp_ranks[rank_idx]
        is_winner = compare_hands(hand["hand_score"], best_score) == 0
        win = split_win if is_winner else 0
        if is_winner and extra_left > 0:
            win += 1
            extra_left -= 1
        results.append({
            "name": name,
            "is_npc": True,
            "score": hand["score"],
            "rank": rank,
            "won": win,
            "hole_cards": hand["hole_cards"],
            "best_cards": hand["best_cards"],
            "hand_name": hand["hand_name"],
            "hand_combo": hand["hand_combo"],
            "hole_cards_display": [card_display(c) for c in hand["hole_cards"]],
            "best_cards_display": [card_display(c) for c in hand["best_cards"]],
        })

    return {
        "ok": True,
        "demo": True,
        "mode": "demo_ai",
        "community_cards": community,
        "community_cards_display": [card_display(c) for c in community],
        "results": results,
        "pot": pot,
        "buy_in": buy_in,
        "tie": winner_count > 1,
        "winners_count": winner_count,
        "message": "注册后可亲自上桌 · 首局必得高价值分享卡",
    }


@growth_router.get("/public/trading/demo")
async def public_trading_demo():
    """未登录试看 — BTC 迷你 K 线 + 全服最近成交（30 秒 hook）"""
    import json
    import os
    from pathlib import Path

    import aiohttp

    symbol = "BTCUSDT"
    closes: list[float] = []
    price = 0.0
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                "https://fapi.binance.com/fapi/v1/klines",
                params={"symbol": symbol, "interval": "15m", "limit": 24},
                timeout=aiohttp.ClientTimeout(total=8),
            ) as resp:
                if resp.status == 200:
                    rows = await resp.json()
                    closes = [float(r[4]) for r in rows]
                    if closes:
                        price = closes[-1]
            async with session.get(
                "https://fapi.binance.com/fapi/v1/ticker/price",
                params={"symbol": symbol},
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    price = float(data.get("price") or price or 0)
    except Exception:
        pass

    if not closes:
        base = price or 95000.0
        closes = [base * (1 + (i - 12) * 0.0015) for i in range(24)]

    trades: list[dict] = []
    base_dir = Path(os.environ.get("TRADING_AGENT_ROOT", "/opt/trading-agent"))
    log_path = base_dir / "data" / "trade-log.jsonl"
    try:
        if log_path.is_file():
            lines = log_path.read_text(encoding="utf-8").strip().splitlines()[-40:]
            for line in reversed(lines):
                if not line.strip():
                    continue
                try:
                    t = json.loads(line)
                except json.JSONDecodeError:
                    continue
                pnl = t.get("pnl_amount") or t.get("pnl") or 0
                trades.append({
                    "agent": t.get("agent_type") or t.get("agent") or "系统 Agent",
                    "symbol": t.get("symbol") or "BTCUSDT",
                    "direction": t.get("direction") or "LONG",
                    "pnl_amount": round(float(pnl), 2),
                    "reason": t.get("reason") or t.get("close_reason") or "",
                    "closed_at": t.get("closed_at") or t.get("time") or "",
                })
                if len(trades) >= 8:
                    break
    except Exception:
        pass

    if not trades:
        demos = [
            ("Major Agent", "BTCUSDT", "LONG", 128.5),
            ("XAU Agent", "XAUUSDT", "LONG", 42.3),
            ("Momentum Agent", "ETHUSDT", "SHORT", 86.1),
            ("Altcoin Agent", "SOLUSDT", "LONG", -31.2),
        ]
        for i, (agent, sym, direction, pnl) in enumerate(demos):
            trades.append({
                "agent": agent,
                "symbol": sym,
                "direction": direction,
                "pnl_amount": pnl,
                "reason": "止盈" if pnl > 0 else "止损",
                "closed_at": "",
            })

    return {
        "ok": True,
        "demo": True,
        "symbol": symbol,
        "price": round(price or closes[-1], 2),
        "closes": [round(c, 2) for c in closes],
        "trades": trades,
        "message": "注册即送 5 万 USDT 模拟盘 · 一句话训练你的 AI 交易员",
    }


@growth_router.get("/public/poker/rooms/{room_id}/preview")
async def public_room_preview(room_id: str):
    """等待中房间预览 — 供 deep link 落地页展示"""
    with life_db._lock:
        with life_db._conn() as c:
            rid = _resolve_room_id(c, room_id)
            if not rid:
                return {"ok": False, "error": "房间不存在"}
            room = c.execute("SELECT * FROM poker_rooms WHERE id=?", (rid,)).fetchone()
            if not room:
                return {"ok": False, "error": "房间不存在"}
            room = dict(room)
            if room["status"] not in ("waiting", "playing"):
                return {"ok": False, "error": "房间已结束"}
            players = c.execute(
                "SELECT user_id, seat_id FROM poker_room_players WHERE room_id=?",
                (rid,),
            ).fetchall()
    humans = [dict(p) for p in players if not str(p["user_id"]).startswith(("npc_", "ai_"))]
    return {
        "ok": True,
        "room_id": rid,
        "room_code": rid,
        "status": room["status"],
        "buy_in": room["buy_in"],
        "game_mode": room.get("game_mode") or "classic",
        "human_count": len(humans),
        "max_players": 7,
    }


@growth_router.get("/public/poker/rooms/{room_id}/spectate")
async def public_poker_spectate(
    room_id: str,
    since_seq: int = 0,
    auto_run: bool = True,
    max_steps: int = 1,
):
    """公开围观进阶锦标赛 — 无需登录"""
    from poker_advanced import get_public_spectate_state
    return await get_public_spectate_state(
        room_id,
        since_seq=since_seq,
        auto_run=auto_run,
        max_steps=max(0, min(max_steps, 8)),
    )


@growth_router.get("/public/season/leaderboard")
async def public_season_leaderboard(metric: str = "points", limit: int = 20):
    from life_engagement import season_leaderboard
    return await season_leaderboard(metric=metric, limit=limit)


@growth_router.get("/public/season/info")
async def public_season_info():
    season = life_db.get_active_season()
    if not season:
        return {"ok": True, "season": None}
    return {"ok": True, "season": dict(season)}


@growth_router.get("/public/trading/arena/live")
async def public_arena_live():
    """未登录观赛 — 当前大赛排行榜 + 胜率榜（裂变 hook）"""
    from trading_events import public_arena_snapshot
    return await public_arena_snapshot()
