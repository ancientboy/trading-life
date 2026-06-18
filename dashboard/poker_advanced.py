"""进阶德州 — 房间持久化、自动推进、结算"""
from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any

import life_db
from poker_bot import decide_action, merge_profile, record_hand_stats, should_use_llm
from poker_engine import (
    apply_action,
    new_tournament_state,
    public_state,
    start_new_hand,
    start_next_hand_if_ready,
)
from poker_style import AI_BOT_ROSTER, ADVANCED_BUY_INS

MAX_TABLE_PLAYERS = 7


def _load_game_state(room_row: dict) -> dict | None:
    raw = room_row.get("game_state_json") or ""
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def _save_game_state(c, room_id: str, state: dict) -> None:
    c.execute(
        "UPDATE poker_rooms SET game_state_json=?, phase=?, hand_number=?, pot=? WHERE id=?",
        (
            json.dumps(state, ensure_ascii=False),
            state.get("phase", ""),
            state.get("hand_number", 0),
            state.get("pot", 0),
            room_id,
        ),
    )


def _agent_profile_and_soul(user_id: str, agent_id: str) -> tuple[dict, str]:
    from life_game import load_user

    user = load_user(user_id)
    agents = user.get("custom_agents") or {}
    meta = agents.get(agent_id) or {}
    profile = merge_profile(meta.get("pokerProfile"))
    soul = meta.get("soulMd") or ""
    return profile, soul


def build_roster_from_db(players: list[dict], account_names: dict[str, str]) -> list[dict]:
    roster = []
    for p in players:
        uid = p["user_id"]
        aid = p.get("agent_id") or ""
        is_npc = str(uid).startswith("npc_") or str(uid).startswith("ai_")
        name = p.get("agent_name") or p.get("display_name") or account_names.get(uid) or uid
        if is_npc and uid in {x[0] for x in AI_BOT_ROSTER}:
            preset = next((x[2] for x in AI_BOT_ROSTER if x[0] == uid), "tag")
            profile = merge_profile({"preset": preset})
            soul = ""
        elif is_npc:
            profile = merge_profile({"preset": "balanced"})
            soul = ""
        else:
            profile, soul = _agent_profile_and_soul(uid, aid)
        roster.append({
            "user_id": uid,
            "agent_id": aid,
            "seat_id": p.get("seat_id", ""),
            "name": name,
            "is_npc": is_npc,
            "poker_profile": profile,
            "soul_md": soul,
        })
    return roster


async def _pick_action(state: dict, seat_idx: int) -> tuple[str, int, str]:
    p = state["players"][seat_idx]
    profile = merge_profile(p.get("poker_profile"))
    soul = p.get("soul_md") or ""
    if should_use_llm(state, seat_idx, profile):
        from poker_bot import decide_with_llm
        return await decide_with_llm(state, seat_idx, profile, soul)
    return decide_action(state, seat_idx, profile)


async def run_ticks(state: dict, max_steps: int = 8) -> dict:
    """自动推进 bot 行动，直到需要等待或达到步数上限"""
    steps = 0
    while steps < max_steps and state["status"] == "playing":
        if state["phase"] == "between_hands":
            state = start_next_hand_if_ready(state)
            steps += 1
            continue
        if state["phase"] in ("showdown", "complete") and state["status"] != "tournament_complete":
            state = start_next_hand_if_ready(state)
            steps += 1
            continue
        if state["status"] == "tournament_complete":
            break
        idx = state.get("actor_index", -1)
        if idx < 0:
            break
        action, amount, reason = await _pick_action(state, idx)
        state["last_reasoning"] = {
            "seat_index": idx,
            "name": state["players"][idx]["name"],
            "action": action,
            "reason": reason,
        }
        apply_action(state, idx, action, amount)
        steps += 1
    return state


def settle_tournament(state: dict, room: dict, players_db: list[dict], account_id: str) -> dict:
    """锦标赛结束 — 按最终筹码结算积分（仅真人）"""
    from life_game import load_user, save_user, _earn

    buy_in = room["buy_in"]
    results = []
    with life_db._lock:
        with life_db._conn() as c:
            for p in state["players"]:
                uid = p["user_id"]
                stack = p["stack"]
                is_npc = p["is_npc"]
                rank = 1 if stack > 0 and not any(
                    q["stack"] > stack and not q["eliminated"] for q in state["players"]
                ) else (8 if p["eliminated"] else 2)
                c.execute(
                    "UPDATE poker_room_players SET score=?, rank=?, stack=? WHERE room_id=? AND user_id=?",
                    (stack, rank, stack, room["id"], uid),
                )
                payout = 0
                if not is_npc:
                    # 最终筹码即返还+赢利（起始 buy_in）
                    payout = max(0, stack)
                    net = payout - buy_in
                    if payout > 0:
                        user = load_user(uid)
                        _earn(user, payout, account_id=uid)
                        save_user(uid, user)
                        if rank == 1:
                            life_db.add_season_points(uid, pvp_win=1, social=8)
                results.append({
                    "user_id": uid,
                    "agent_id": p.get("agent_id", ""),
                    "name": p["name"],
                    "is_npc": is_npc,
                    "stack": stack,
                    "rank": rank,
                    "won": payout if not is_npc else 0,
                    "eliminated": p["eliminated"],
                })
            c.execute(
                "UPDATE poker_rooms SET status='settled', settled_at=?, pot=0, phase='complete' WHERE id=?",
                (life_db.now_ms(), room["id"]),
            )

    human = next((r for r in results if r["user_id"] == account_id), None)
    balance = load_user(account_id)["points"] if human else None
    return {
        "ok": True,
        "mode": "advanced",
        "status": "tournament_complete",
        "results": sorted(results, key=lambda x: (-x["stack"], x["rank"])),
        "winner": next((r for r in results if r["rank"] == 1), None),
        "balance": balance,
        "won": human["won"] if human else 0,
        "net": (human["won"] - buy_in) if human else 0,
        "buy_in": buy_in,
    }


def init_advanced_room(
    c,
    room_id: str,
    buy_in: int,
    host_id: str,
    roster: list[dict],
    spectator: bool = False,
    create_new: bool = True,
) -> dict:
    ts = life_db.now_ms()
    state = new_tournament_state(room_id, buy_in, roster)
    state = start_new_hand(state)
    gs = json.dumps(state, ensure_ascii=False)
    if create_new:
        c.execute(
            """INSERT INTO poker_rooms
               (id, status, pot, host_user_id, buy_in, created_at, started_at, game_mode, phase, hand_number, game_state_json, spectator)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                room_id, "playing", state["pot"], host_id, buy_in, ts, ts,
                "advanced", state["phase"], state["hand_number"], gs,
                1 if spectator else 0,
            ),
        )
        for i, r in enumerate(roster):
            c.execute(
                """INSERT INTO poker_room_players
                   (room_id, user_id, agent_id, seat_id, buy_in, stack, meta_json)
                   VALUES (?,?,?,?,?,?,?)""",
                (
                    room_id, r["user_id"], r.get("agent_id", ""), r.get("seat_id", f"poker_s{i+1}"),
                    buy_in, buy_in, json.dumps({"poker_profile": r.get("poker_profile", {})}, ensure_ascii=False),
                ),
            )
    else:
        c.execute(
            """UPDATE poker_rooms SET status='playing', started_at=?, pot=?, buy_in=?,
               game_mode='advanced', phase=?, hand_number=?, game_state_json=?, spectator=? WHERE id=?""",
            (ts, state["pot"], buy_in, state["phase"], state["hand_number"], gs, 1 if spectator else 0, room_id),
        )
        for i, r in enumerate(roster):
            c.execute(
                """UPDATE poker_room_players SET stack=?, buy_in=?, meta_json=?
                   WHERE room_id=? AND user_id=?""",
                (
                    buy_in,
                    buy_in,
                    json.dumps({"poker_profile": r.get("poker_profile", {})}, ensure_ascii=False),
                    room_id,
                    r["user_id"],
                ),
            )
    return state


def pick_ai_opponents(count: int, exclude_ids: set[str]) -> list[tuple[str, str, str]]:
    pool = [x for x in AI_BOT_ROSTER if x[0] not in exclude_ids]
    out = []
    for i in range(min(count, len(pool))):
        out.append(pool[i])
    # 若不够则循环
    pi = 0
    while len(out) < count:
        out.append(pool[pi % len(pool)])
        pi += 1
    return out[:count]


async def get_advanced_state(room_id: str, account_id: str, since_seq: int = 0, auto_run: bool = True) -> dict:
    with life_db._lock:
        with life_db._conn() as c:
            room = c.execute("SELECT * FROM poker_rooms WHERE id=?", (room_id,)).fetchone()
            if not room:
                return {"ok": False, "error": "房间不存在"}
            room = dict(room)
            if room.get("game_mode") != "advanced":
                return {"ok": False, "error": "非进阶模式房间"}
            state = _load_game_state(room)
            if not state:
                return {"ok": False, "error": "牌局状态丢失"}

    if auto_run and state["status"] == "playing":
        state = await run_ticks(state, max_steps=12)
        with life_db._lock:
            with life_db._conn() as c:
                _save_game_state(c, room_id, state)
                if state["status"] == "tournament_complete":
                    players = [dict(p) for p in c.execute(
                        "SELECT * FROM poker_room_players WHERE room_id=?", (room_id,)
                    ).fetchall()]
                    room = dict(c.execute("SELECT * FROM poker_rooms WHERE id=?", (room_id,)).fetchone())

    pub = public_state(state, viewer_user_id=account_id, since_seq=since_seq)
    out = {"ok": True, "room_id": room_id, "game": pub, "status": state["status"]}

    if state["status"] == "tournament_complete" and room.get("status") != "settled":
        players = []
        with life_db._lock:
            with life_db._conn() as c:
                players = [dict(p) for p in c.execute(
                    "SELECT * FROM poker_room_players WHERE room_id=?", (room_id,)
                ).fetchall()]
        settlement = settle_tournament(state, room, players, account_id)
        out["settlement"] = settlement
    return out


def validate_advanced_buy_in(buy_in: int) -> int:
    if buy_in in ADVANCED_BUY_INS:
        return buy_in
    return min(ADVANCED_BUY_INS, key=lambda x: abs(x - buy_in))
