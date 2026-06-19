"""增长 / 裂变 — 邀请返利、公开围观"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends

import life_db
from life_auth import resolve_account_id

growth_router = APIRouter()

REFERRAL_INVITEE_BONUS = 500
REFERRAL_INVITER_SIGNUP = 300
REFERRAL_INVITER_POKER = 200


def _resolve_room_id(c, room_id_or_code: str) -> Optional[str]:
    from life_engagement import _resolve_room_id as _r
    return _r(c, room_id_or_code)


@growth_router.get("/growth/referral")
async def get_my_referral(account_id: str = Depends(resolve_account_id)):
    summary = life_db.get_referral_summary(account_id)
    return {"ok": True, **summary}


@growth_router.get("/growth/notifications")
async def get_growth_notifications(account_id: str = Depends(resolve_account_id)):
    messages = life_db.pop_life_notifications(account_id)
    return {"ok": True, "messages": messages}


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
