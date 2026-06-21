"""
交易人生 — 趣味性三阶段：社交 / 对抗 / 赛季经营
"""
from __future__ import annotations

import random
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import life_db
from life_auth import resolve_account_id, require_admin

social_router = APIRouter()
pvp_router = APIRouter()
season_router = APIRouter()

AUCTION_EXTEND_MS = 60_000
AUCTION_MIN_BID = 10


# ─── Phase 1: Social ───────────────────────────────────────────

class ChatPostBody(BaseModel):
    channel: str
    body: str
    agent_id: str = ""


class MoodSyncBody(BaseModel):
    agents: list[dict] = Field(default_factory=list)


class MentorPairBody(BaseModel):
    mentor_agent_id: str
    mentee_agent_id: str


class TableSpeakBody(BaseModel):
    channel: str
    agent_id: str
    agent_name: str = "Agent"
    soul_md: str = ""
    context: str = "greeting"
    activity: Optional[str] = None
    stress: float = 0
    mood_tag: str = "neutral"
    decision_mode: str = ""
    nearby_names: list[str] = Field(default_factory=list)
    target_agent_name: str = ""


class AgentBrainSpeakBody(BaseModel):
    channel: str = ""
    agent_id: str
    agent_name: str = "Agent"
    soul_md: str = ""
    context: str = "greeting"
    activity: Optional[str] = None
    stress: float = 0
    mood_tag: str = "neutral"
    decision_mode: str = ""
    nearby_names: list[str] = Field(default_factory=list)
    target_agent_name: str = ""
    post_to_chat: bool = False
    remember: bool = True


class AgentDialogueBody(BaseModel):
    channel: str
    agent_a_id: str
    agent_a_name: str = "Agent A"
    agent_a_soul: str = ""
    agent_b_id: str
    agent_b_name: str = "Agent B"
    agent_b_soul: str = ""
    rounds: int = 2


class AgentTeaPartyBody(BaseModel):
    channel: str
    zone: str = "hall"
    agents: list[dict] = Field(default_factory=list)
    topic: str = ""


async def _speak_with_memory(
    account_id: str,
    body: "AgentSpeakBody",
    remember: bool = True,
    remember_kind: str = "event",
    remember_prefix: str = "",
) -> str:
    from life_game import AgentSpeakBody, _generate_speak_line

    mem = life_db.memory_snippets_for_prompt(account_id, body.agent_id)
    enriched = body.model_copy(update={"memory_snippets": mem})
    line = await _generate_speak_line(enriched)
    if line and remember:
        summary = f"{remember_prefix}{line}"[:200] if remember_prefix else line[:200]
        life_db.append_agent_memory(account_id, body.agent_id, remember_kind, summary)
    return line


async def _run_agent_dialogue(
    account_id: str,
    channel: str,
    aid_a: str, name_a: str, soul_a: str,
    aid_b: str, name_b: str, soul_b: str,
    rounds: int = 2,
) -> list[dict]:
    from life_game import AgentSpeakBody
    from agent_brain import build_speak_context

    out: list[dict] = []
    prev = ""
    total = max(2, min(rounds, 3)) * 2
    for turn in range(total):
        if turn % 2 == 0:
            aid, name, soul, other = aid_a, name_a, soul_a, name_b
        else:
            aid, name, soul, other = aid_b, name_b, soul_b, name_a
        ctx = build_speak_context(
            "agent_to_agent",
            target_name=other,
            user_message=prev or f"碰到{other}",
        )
        line = await _speak_with_memory(
            account_id,
            AgentSpeakBody(
                agent_id=aid,
                agent_name=name,
                soul_md=soul,
                context=ctx,
                decision_mode="social",
                user_message=prev[:120] if prev else "",
                target_agent_name=other,
            ),
            remember_kind="social",
            remember_prefix=f"对{other}: ",
        )
        if prev:
            life_db.append_agent_memory(account_id, aid, "social", f"{other}说: {prev}"[:200])
        if not line:
            continue
        row = await _insert_agent_chat_line(account_id, channel, aid, line)
        out.append(row)
        prev = line
    if out:
        life_db.append_agent_memory(account_id, aid_a, "social", f"与{name_b}聊天"[:200])
        life_db.append_agent_memory(account_id, aid_b, "social", f"与{name_a}聊天"[:200])
    return out


TEA_PARTY_TOPICS = ["今日战况", "去哪放松", "摸鱼心得", "美食推荐", "八卦时间"]


async def _run_tea_party(
    account_id: str,
    channel: str,
    zone: str,
    agents: list[dict],
    topic: str = "",
) -> tuple[list[dict], str]:
    from life_game import AgentSpeakBody
    from agent_brain import build_speak_context

    if len(agents) < 3:
        return [], ""
    topic = (topic or random.choice(TEA_PARTY_TOPICS)).strip()[:40]
    names = [a.get("name") or a.get("agent_id") or "Agent" for a in agents[:5]]
    out: list[dict] = []
    for a in agents[:5]:
        aid = a.get("agent_id") or ""
        name = a.get("name") or aid
        soul = a.get("soul_md") or ""
        if not aid:
            continue
        others = [n for n in names if n != name]
        ctx = build_speak_context(
            "tea_party",
            nearby_names=others,
            target_name="",
        ) + f"|topic:{topic}|zone:{zone}"
        line = await _speak_with_memory(
            account_id,
            AgentSpeakBody(
                agent_id=aid,
                agent_name=name,
                soul_md=soul,
                context=ctx,
                decision_mode="social",
                nearby_names=others,
            ),
            remember_kind="social",
            remember_prefix=f"茶话会·{topic}: ",
        )
        if not line:
            continue
        row = await _insert_agent_chat_line(account_id, channel, aid, line)
        out.append(row)
    if out:
        for a in agents[:5]:
            aid = a.get("agent_id") or ""
            if aid:
                life_db.append_agent_memory(
                    account_id, aid, "social",
                    f"参加{zone}茶话会·{topic}"[:200],
                )
    return out, topic


async def _insert_agent_chat_line(
    account_id: str,
    channel: str,
    agent_id: str,
    line: str,
) -> dict:
    acc = life_db.get_account_by_id(account_id)
    ts = life_db.now_ms()
    with life_db._lock:
        with life_db._conn() as c:
            c.execute(
                "INSERT INTO chat_messages (channel, user_id, display_name, agent_id, body, kind, created_at) VALUES (?,?,?,?,?,?,?)",
                (channel, account_id, (acc or {}).get("display_name", ""), agent_id, line, "agent", ts),
            )
            mid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
    return {"id": mid, "body": line, "agent_id": agent_id, "kind": "agent", "created_at": ts}


async def _agent_replies_to_chat(
    account_id: str,
    channel: str,
    user_text: str,
    sender_agent_id: str = "",
) -> list[dict]:
    """用户发言后 — @Agent 或娱乐 Agent 随机接话。"""
    from life_game import load_user, AgentSpeakBody, _generate_speak_line
    from agent_brain import find_mentioned_agents, derive_traits, mood_tag_from_stress, build_speak_context

    user = load_user(account_id)
    custom = user.get("custom_agents") or {}
    if not custom:
        return []

    mentioned = find_mentioned_agents(user_text, custom)
    responders: list[tuple[str, dict]] = list(mentioned)

    if not responders and ("?" in user_text or "？" in user_text or "吗" in user_text):
        ents = [(aid, m) for aid, m in custom.items() if m.get("agentType") == "entertainment"]
        if ents and random.random() < 0.55:
            responders.append(random.choice(ents))

    if not responders and random.random() < 0.12:
        aid = random.choice(list(custom.keys()))
        responders.append((aid, custom[aid]))

    out: list[dict] = []
    for aid, meta in responders[:2]:
        name = meta.get("name") or aid
        soul = meta.get("soulMd") or ""
        agent_type = meta.get("agentType") or "entertainment"
        life_db.append_agent_memory(account_id, aid, "user", f"用户: {user_text[:120]}")
        mem = life_db.memory_snippets_for_prompt(account_id, aid)
        ctx = build_speak_context(
            "chat_reply",
            stress=40,
            mood_tag="neutral",
            user_message=user_text,
        )
        line = await _generate_speak_line(AgentSpeakBody(
            agent_id=aid,
            agent_name=name,
            soul_md=soul,
            context=ctx,
            decision_mode="social",
            user_message=user_text[:120],
            memory_snippets=mem,
        ))
        if not line:
            continue
        life_db.append_agent_memory(account_id, aid, "chat", f"回复: {line}"[:200])
        row = await _insert_agent_chat_line(account_id, channel, aid, line)
        out.append(row)
    return out


@social_router.get("/social/chat/{channel}")
async def get_chat(channel: str, since: int = 0, account_id: str = Depends(resolve_account_id)):
    with life_db._lock:
        with life_db._conn() as c:
            rows = c.execute(
                "SELECT id, channel, user_id, display_name, agent_id, body, kind, created_at FROM chat_messages WHERE channel=? AND created_at>? ORDER BY created_at ASC LIMIT 80",
                (channel, since),
            ).fetchall()
    return {"ok": True, "messages": [dict(r) for r in rows]}


@social_router.post("/social/chat")
async def post_chat(body: ChatPostBody, account_id: str = Depends(resolve_account_id)):
    ch = (body.channel or "").strip()[:64]
    text = (body.body or "").strip()[:200]
    if not ch or not text:
        raise HTTPException(400, "无效消息")
    acc = life_db.get_account_by_id(account_id)
    ts = life_db.now_ms()
    with life_db._lock:
        with life_db._conn() as c:
            c.execute(
                "INSERT INTO chat_messages (channel, user_id, display_name, agent_id, body, kind, created_at) VALUES (?,?,?,?,?,?,?)",
                (ch, account_id, (acc or {}).get("display_name", ""), body.agent_id, text, "user", ts),
            )
            mid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
    life_db.add_season_points(account_id, social=2)
    if body.agent_id:
        life_db.append_agent_memory(account_id, body.agent_id, "user", f"用户: {text[:120]}")
    replies = await _agent_replies_to_chat(account_id, ch, text, body.agent_id)
    return {"ok": True, "id": mid, "created_at": ts, "agent_replies": replies}


@social_router.post("/social/mood/sync")
async def sync_mood(body: MoodSyncBody, account_id: str = Depends(resolve_account_id)):
    ts = life_db.now_ms()
    with life_db._lock:
        with life_db._conn() as c:
            for a in body.agents[:20]:
                aid = (a.get("agent_id") or "").strip()
                if not aid:
                    continue
                c.execute(
                    """INSERT INTO agent_mood (user_id, agent_id, stress, mood_tag, zone, channel, updated_at)
                       VALUES (?,?,?,?,?,?,?)
                       ON CONFLICT(user_id, agent_id) DO UPDATE SET
                       stress=excluded.stress, mood_tag=excluded.mood_tag, zone=excluded.zone,
                       channel=excluded.channel, updated_at=excluded.updated_at""",
                    (
                        account_id, aid, int(a.get("stress", 0)),
                        a.get("mood_tag", "neutral"), a.get("zone", "hall"),
                        a.get("channel", ""), ts,
                    ),
                )
    return {"ok": True}


@social_router.get("/social/mood/zone/{zone}")
async def mood_in_zone(zone: str, account_id: str = Depends(resolve_account_id)):
    ts = life_db.now_ms()
    with life_db._lock:
        with life_db._conn() as c:
            rows = c.execute(
                "SELECT user_id, agent_id, stress, mood_tag, channel FROM agent_mood WHERE zone=? AND updated_at > ?",
                (zone, ts - 120_000),
            ).fetchall()
    avg = sum(r["stress"] for r in rows) / max(len(rows), 1) if rows else 50
    return {"ok": True, "agents": [dict(r) for r in rows], "avg_stress": round(avg, 1)}


@social_router.get("/social/mentor")
async def get_mentor(account_id: str = Depends(resolve_account_id)):
    with life_db._lock:
        with life_db._conn() as c:
            rows = c.execute(
                "SELECT mentor_agent_id, mentee_agent_id, paired_at FROM mentor_pairs WHERE user_id=?",
                (account_id,),
            ).fetchall()
    return {"ok": True, "pairs": [dict(r) for r in rows]}


@social_router.post("/social/mentor/pair")
async def pair_mentor(body: MentorPairBody, account_id: str = Depends(resolve_account_id)):
    from life_game import load_user

    user = load_user(account_id)
    custom = user.get("custom_agents", {})
    mentor = custom.get(body.mentor_agent_id)
    mentee = custom.get(body.mentee_agent_id)
    if not mentor or not mentee:
        return {"ok": False, "error": "Agent 不存在"}
    if mentor.get("agentType") != "entertainment":
        return {"ok": False, "error": "师傅须为娱乐 Agent"}
    if mentee.get("agentType") == "entertainment":
        return {"ok": False, "error": "徒弟须为交易 Agent"}
    with life_db._lock:
        with life_db._conn() as c:
            c.execute(
                "INSERT OR REPLACE INTO mentor_pairs (user_id, mentor_agent_id, mentee_agent_id, paired_at) VALUES (?,?,?,?)",
                (account_id, body.mentor_agent_id, body.mentee_agent_id, life_db.datetime.now(life_db.CST).isoformat()),
            )
    life_db.add_season_points(account_id, social=10)
    return {"ok": True, "mentor": body.mentor_agent_id, "mentee": body.mentee_agent_id}


@social_router.get("/social/events")
async def active_events(account_id: str = Depends(resolve_account_id)):
    ts = life_db.now_ms()
    with life_db._lock:
        with life_db._conn() as c:
            rows = c.execute(
                "SELECT * FROM npc_events WHERE starts_at <= ? AND ends_at > ?",
                (ts, ts),
            ).fetchall()
            claimed = {
                r["event_id"] for r in c.execute(
                    "SELECT event_id FROM npc_event_claims WHERE user_id=?", (account_id,)
                ).fetchall()
            }
    events = []
    for r in rows:
        d = dict(r)
        d["claimed"] = d["id"] in claimed
        events.append(d)
    return {"ok": True, "events": events}


@social_router.post("/social/events/{event_id}/claim")
async def claim_event(event_id: str, account_id: str = Depends(resolve_account_id)):
    from life_game import load_user, _earn

    ts = life_db.now_ms()
    reward = 0
    buff_type = ""
    buff_value = 0
    balance = 0
    with life_db._lock:
        with life_db._conn() as c:
            ev = c.execute(
                "SELECT * FROM npc_events WHERE id=? AND starts_at<=? AND ends_at>?",
                (event_id, ts, ts),
            ).fetchone()
            if not ev:
                return {"ok": False, "error": "活动已结束"}
            if c.execute(
                "SELECT 1 FROM npc_event_claims WHERE user_id=? AND event_id=?",
                (account_id, event_id),
            ).fetchone():
                return {"ok": False, "error": "已领取"}
            c.execute(
                "INSERT INTO npc_event_claims (user_id, event_id, claimed_at) VALUES (?,?,?)",
                (account_id, event_id, life_db.datetime.now(life_db.CST).isoformat()),
            )
            reward = int(ev["reward_points"])
            buff_type = ev["buff_type"]
            buff_value = ev["buff_value"]
            ok, balance = life_db._adjust_points_cursor(c, account_id, reward)
            if not ok:
                return {"ok": False, "error": "领取失败"}
    user = load_user(account_id)
    user["points"] = balance
    life_db.save_user_points(account_id, balance)
    life_db.add_season_points(account_id, points=reward, social=5)
    return {"ok": True, "balance": balance, "reward": reward, "buff_type": buff_type, "buff_value": buff_value}


@social_router.post("/social/table-speak")
async def table_speak(body: TableSpeakBody, account_id: str = Depends(resolve_account_id)):
    from life_game import _generate_speak_line, AgentSpeakBody
    from agent_brain import build_speak_context

    ctx = body.context or build_speak_context(
        body.decision_mode or "social",
        activity=body.activity,
        stress=body.stress,
        mood_tag=body.mood_tag,
        nearby_names=body.nearby_names,
        target_name=body.target_agent_name,
    )
    line = await _generate_speak_line(AgentSpeakBody(
        agent_id=body.agent_id,
        agent_name=body.agent_name,
        soul_md=body.soul_md,
        context=ctx,
        activity=body.activity,
        stress=body.stress,
        mood_tag=body.mood_tag,
        decision_mode=body.decision_mode,
        nearby_names=body.nearby_names,
        target_agent_name=body.target_agent_name,
    ))
    row = await _insert_agent_chat_line(account_id, body.channel, body.agent_id, line)
    return {"ok": True, "line": line, "created_at": row["created_at"], "message_id": row["id"]}


@social_router.post("/social/agent-brain/speak")
async def agent_brain_speak(body: AgentBrainSpeakBody, account_id: str = Depends(resolve_account_id)):
    """自主大脑执行层 — 生成台词，可选写入区域频道。"""
    from life_game import _generate_speak_line, AgentSpeakBody
    from agent_brain import build_speak_context

    ctx = body.context or build_speak_context(
        body.decision_mode or "greeting",
        activity=body.activity,
        stress=body.stress,
        mood_tag=body.mood_tag,
        nearby_names=body.nearby_names,
        target_name=body.target_agent_name,
    )
    line = await _speak_with_memory(
        account_id,
        AgentSpeakBody(
            agent_id=body.agent_id,
            agent_name=body.agent_name,
            soul_md=body.soul_md,
            context=ctx,
            activity=body.activity,
            stress=body.stress,
            mood_tag=body.mood_tag,
            decision_mode=body.decision_mode,
            nearby_names=body.nearby_names,
            target_agent_name=body.target_agent_name,
        ),
        remember=body.remember,
        remember_kind="event",
        remember_prefix="",
    )
    out: dict = {"ok": True, "line": line}
    if body.post_to_chat and body.channel and line:
        row = await _insert_agent_chat_line(account_id, body.channel, body.agent_id, line)
        out["chat"] = row
    return out


@social_router.post("/social/agent-brain/dialogue")
async def agent_brain_dialogue(body: AgentDialogueBody, account_id: str = Depends(resolve_account_id)):
    """Agent 互聊链 — 两人来回对话写入频道。"""
    ch = (body.channel or "").strip()[:64]
    if not ch or not body.agent_a_id or not body.agent_b_id:
        return {"ok": False, "error": "参数不完整"}
    messages = await _run_agent_dialogue(
        account_id, ch,
        body.agent_a_id, body.agent_a_name, body.agent_a_soul,
        body.agent_b_id, body.agent_b_name, body.agent_b_soul,
        max(1, min(body.rounds, 3)),
    )
    life_db.add_season_points(account_id, social=min(10, len(messages) * 2))
    return {"ok": True, "messages": messages, "turns": len(messages)}


@social_router.post("/social/agent-brain/tea-party")
async def agent_brain_tea_party(body: AgentTeaPartyBody, account_id: str = Depends(resolve_account_id)):
    """群聊茶话会 — 同区多 Agent 轮流发言。"""
    ch = (body.channel or "").strip()[:64]
    if not ch or len(body.agents) < 3:
        return {"ok": False, "error": "至少需要 3 名 Agent"}
    messages, topic_used = await _run_tea_party(account_id, ch, body.zone, body.agents, body.topic)
    life_db.add_season_points(account_id, social=min(15, len(messages) * 2))
    return {"ok": True, "messages": messages, "topic": topic_used or body.topic}


@social_router.get("/social/agent-brain/memory/{agent_id}")
async def get_agent_brain_memory(agent_id: str, account_id: str = Depends(resolve_account_id)):
    rows = life_db.get_agent_memories(account_id, agent_id, 15)
    return {"ok": True, "memories": rows}


# ─── Phase 2: PvP ────────────────────────────────────────────────

class PokerCreateBody(BaseModel):
    buy_in: int = 30
    agent_id: str = ""
    game_mode: str = "classic"


class PokerAiSpectatorBody(BaseModel):
    agent_id: str
    buy_in: int = 1000
    num_players: int = 4


class PokerStyleBody(BaseModel):
    text: str = ""


class PokerStyleFeedbackBody(BaseModel):
    feedback: str = ""


class PokerStylePresetBody(BaseModel):
    preset: str = "tag"


class PokerJoinBody(BaseModel):
    agent_id: str
    seat_id: str = ""


class PokerJoinByCodeBody(BaseModel):
    room_code: str
    agent_id: str
    seat_id: str = ""


class PokerChangeSeatBody(BaseModel):
    seat_id: str


class PokerSoloBody(BaseModel):
    agent_id: str
    buy_in: int = 30


# 系统 NPC 牌友（单人模式自动补位；荷官 Jack 仅作 NPC 发牌，不占玩家位）
NPC_POKER_ROSTER = [
    ("npc_lily", "服务员 Lily", "poker_s3"),
    ("npc_gaga", "技师 Gaga", "poker_s5"),
]

NPC_DISPLAY = {uid: name for uid, name, _ in [(t[0], t[1], t[2]) for t in NPC_POKER_ROSTER]}


def _poker_seat_index(seat_id: str) -> int:
    if seat_id and str(seat_id).startswith("poker_s"):
        try:
            return int(str(seat_id).replace("poker_s", ""))
        except ValueError:
            pass
    return 999


def _sort_poker_players(players: list) -> list[dict]:
    """按座位号排序，保证手牌与玩家一一对应。"""
    plist = [dict(p) if not isinstance(p, dict) else p for p in players]
    return sorted(plist, key=lambda p: _poker_seat_index(p.get("seat_id", "")))


def _charge_human_buy_ins(room_id: str, room: dict, players: list) -> tuple[bool, str]:
    """开局时向真人玩家收取买入积分（入座不扣）。"""
    from life_game import load_user, save_user, _spend

    buy_in = room["buy_in"]
    for p in players:
        pd = dict(p)
        uid = pd["user_id"]
        if uid.startswith("npc_") or uid.startswith("ai_"):
            continue
        if pd.get("buy_in", 0) >= buy_in:
            continue
        user = load_user(uid)
        if not _spend(user, buy_in):
            save_user(uid, user)
            acc = life_db.get_account_by_id(uid)
            name = (acc or {}).get("display_name") or uid[:8]
            return False, f"{name} 积分不足（需 {buy_in} 积分）"
        save_user(uid, user)
        with life_db._lock:
            with life_db._conn() as c:
                c.execute(
                    "UPDATE poker_room_players SET buy_in=? WHERE room_id=? AND user_id=?",
                    (buy_in, room_id, uid),
                )
    return True, ""


def _calc_room_pot(room: dict, players: list) -> int:
    buy_in = room["buy_in"]
    pot = 0
    for p in players:
        pd = dict(p)
        if pd["user_id"].startswith("npc_"):
            pot += buy_in
        elif pd.get("buy_in", 0) > 0:
            pot += pd["buy_in"]
    return pot


def _add_npc_players_to_room(c, room_id: str, buy_in: int, taken_seats: set[str]) -> None:
    for uid, _name, seat in NPC_POKER_ROSTER:
        if seat in taken_seats:
            continue
        c.execute(
            "INSERT OR IGNORE INTO poker_room_players (room_id, user_id, agent_id, seat_id, buy_in) VALUES (?,?,?,?,?)",
            (room_id, uid, f"agent_{uid}", seat, buy_in),
        )


def _player_display_name(p: dict, account_id: str) -> str:
    uid = p["user_id"]
    name = NPC_DISPLAY.get(uid)
    if name:
        return name
    if uid == account_id or not uid.startswith("npc_"):
        from life_game import load_user
        user = load_user(uid)
        agent_id = p.get("agent_id") or ""
        if agent_id and agent_id in (user.get("custom_agents") or {}):
            return user["custom_agents"][agent_id].get("name") or agent_id
        acc = life_db.get_account_by_id(uid)
        return (acc or {}).get("display_name") or uid[:8]
    return uid[:8]


NPC_COLORS = {
    "npc_lily": "#e8a0bf",
    "npc_gaga": "#7ec8a4",
    "npc_jack": "#d4af37",
}
from poker_style import AI_BOT_ROSTER as _AI_ROSTER
for _ai_uid, _ai_name, _ in _AI_ROSTER:
    NPC_COLORS.setdefault(_ai_uid, "#8a7e72")

AI_DISPLAY = {uid: name for uid, name, _ in _AI_ROSTER}
NPC_DISPLAY.update(AI_DISPLAY)


def _generate_room_code(c) -> str:
    """生成唯一 5 位数字房间号（10000–99999）。"""
    for _ in range(40):
        code = str(random.randint(10000, 99999))
        if not c.execute("SELECT 1 FROM poker_rooms WHERE id=?", (code,)).fetchone():
            return code
    raise HTTPException(500, "无法生成房间号，请稍后重试")


def _resolve_room_id(c, room_id_or_code: str) -> Optional[str]:
    """按房间 ID 或 5 位编号解析房间。"""
    key = (room_id_or_code or "").strip()
    if not key:
        return None
    if c.execute("SELECT id FROM poker_rooms WHERE id=?", (key,)).fetchone():
        return key
    if key.isdigit() and len(key) <= 5:
        padded = key.zfill(5) if len(key) < 5 else key
        row = c.execute("SELECT id FROM poker_rooms WHERE id=?", (padded,)).fetchone()
        if row:
            return row["id"]
    return None


def _enrich_poker_player(p: dict, account_id: str) -> dict:
    d = dict(p)
    uid = p["user_id"]
    d["is_npc"] = str(uid).startswith("npc_") or str(uid).startswith("ai_")
    d["display_name"] = _player_display_name(d, account_id)
    d["agent_name"] = d["display_name"]
    d["user_name"] = d["display_name"]
    d["color"] = NPC_COLORS.get(uid, "#6a8aad")
    d["headwear"] = ""
    d["hat_style"] = ""
    if not d["is_npc"]:
        from life_game import load_user
        user = load_user(uid)
        acc = life_db.get_account_by_id(uid)
        d["user_name"] = (acc or {}).get("display_name") or (acc or {}).get("username") or uid[:8]
        agent_id = d.get("agent_id") or ""
        custom = user.get("custom_agents") or {}
        if agent_id and agent_id in custom:
            ca = custom[agent_id]
            d["agent_name"] = ca.get("name") or agent_id
            d["color"] = ca.get("color") or d["color"]
            d["headwear"] = ca.get("headwear") or ""
            d["hat_style"] = ca.get("hatStyle") or ca.get("hat_style") or ""
        else:
            d["agent_name"] = d["user_name"]
    return d


def _human_count_in_room(c, room_id: str) -> int:
    return c.execute(
        """SELECT COUNT(*) FROM poker_room_players
           WHERE room_id=? AND user_id NOT LIKE 'npc_%' AND user_id NOT LIKE 'ai_%'""",
        (room_id,),
    ).fetchone()[0]


def _close_poker_room(c, room_id: str) -> None:
    """关闭等待中的空房间（删除玩家记录并标记 closed）。"""
    c.execute("DELETE FROM poker_room_players WHERE room_id=?", (room_id,))
    c.execute(
        "UPDATE poker_rooms SET status='closed', settled_at=? WHERE id=? AND status='waiting'",
        (life_db.now_ms(), room_id),
    )


def _cleanup_empty_waiting_rooms(c) -> None:
    rows = c.execute("SELECT id FROM poker_rooms WHERE status='waiting'").fetchall()
    for r in rows:
        if _human_count_in_room(c, r["id"]) == 0:
            _close_poker_room(c, r["id"])


def _leave_poker_room(c, room_id: str, user_id: str) -> bool:
    """移除玩家；若房间无真人则自动关闭。返回房间是否已关闭。"""
    c.execute(
        "DELETE FROM poker_room_players WHERE room_id=? AND user_id=?",
        (room_id, user_id),
    )
    if _human_count_in_room(c, room_id) == 0:
        _close_poker_room(c, room_id)
        return True
    return False


def _room_payload(c, room: dict, account_id: str) -> dict:
    d = dict(room)
    players = c.execute(
        "SELECT user_id, agent_id, seat_id, buy_in, score, rank FROM poker_room_players WHERE room_id=?",
        (room["id"],),
    ).fetchall()
    enriched = [_enrich_poker_player(dict(p), account_id) for p in players]
    humans = [p for p in enriched if not p["is_npc"]]
    human_count = len(humans)
    d["room_code"] = room["id"]
    d["players"] = enriched
    d["human_count"] = human_count
    d["player_names"] = [p["user_name"] for p in humans]
    d["game_mode"] = room.get("game_mode") or "classic"
    d["spectator"] = bool(room.get("spectator"))
    return d


async def _start_advanced_tournament(
    room_id: str,
    room: dict,
    players: list,
    account_id: str,
    spectator: bool = False,
) -> dict:
    """进阶模式 — 初始化锦标赛并自动推进首步"""
    from poker_advanced import build_roster_from_db, get_advanced_state, validate_advanced_buy_in
    from poker_style import ADVANCED_BUY_INS

    buy_in = validate_advanced_buy_in(room["buy_in"])
    if buy_in not in ADVANCED_BUY_INS:
        return {"ok": False, "error": f"进阶模式买入须为 {ADVANCED_BUY_INS}"}

    plist = _sort_poker_players(players)
    if len(plist) < 2:
        return {"ok": False, "error": "至少需要 2 名选手"}
    if len(plist) > 7:
        return {"ok": False, "error": "最多 7 人桌"}

    names = {}
    for p in plist:
        names[p["user_id"]] = _player_display_name(p, account_id)

    roster = build_roster_from_db(
        [_enrich_poker_player(dict(p), account_id) for p in plist],
        names,
    )

    from poker_advanced import init_advanced_room
    with life_db._lock:
        with life_db._conn() as c:
            init_advanced_room(c, room_id, buy_in, room["host_user_id"], roster, spectator=spectator, create_new=False)

    state_out = await get_advanced_state(room_id, account_id, since_seq=0, auto_run=False, max_steps=0)
    state_out["mode"] = "advanced_spectator" if spectator else "advanced"
    state_out["buy_in"] = buy_in
    state_out["room_id"] = room_id
    if state_out.get("settlement"):
        state_out["balance"] = state_out["settlement"].get("balance")
    return state_out


def _deal_poker_round(plist: list, account_id: str) -> dict:
    """发牌；首局真人必进胜者组（先爽再深玩）。"""
    from poker_hands import play_round, compare_hands

    n = len(plist)
    human_idx = next(
        (
            i for i, p in enumerate(plist)
            if p["user_id"] == account_id and not str(p["user_id"]).startswith(("npc_", "ai_"))
        ),
        None,
    )
    rig_first = human_idx is not None and life_db.is_first_poker_game(account_id)
    round_data = play_round(n)
    if rig_first:
        for _ in range(48):
            round_data = play_round(n)
            entries = round_data["players"]
            best_score = max(e["hand_score"] for e in entries)
            human = entries[human_idx]
            if compare_hands(human["hand_score"], best_score) >= 0:
                break
    return round_data


def _settle_poker_room(room_id: str, room: dict, players: list, account_id: str) -> dict:
    from life_game import load_user, save_user, _earn
    from poker_hands import card_display, compare_hands

    plist = _sort_poker_players(players)
    if not plist:
        return {"ok": False, "error": "无玩家，无法开牌"}

    round_data = _deal_poker_round(plist, account_id)
    community = round_data["community_cards"]
    pot = room["pot"]
    buy_in = room["buy_in"]

    # 按座位顺序匹配手牌（play_round 的 seat 0..n-1 对应排序后的玩家）
    hands_by_seat = {h["seat"]: h for h in round_data["players"]}
    player_hands = []
    for i, p in enumerate(plist):
        hand = hands_by_seat[i]
        player_hands.append((p, hand))

    player_hands.sort(key=lambda x: x[1]["hand_score"], reverse=True)

    # 竞争排名（并列同名次）— 使用标准德州 tuple 比牌
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
    with life_db._lock:
        with life_db._conn() as c:
            for rank_idx, (p, hand) in enumerate(player_hands):
                rank = comp_ranks[rank_idx]
                is_winner = compare_hands(hand["hand_score"], best_score) == 0
                win = split_win if is_winner else 0
                if is_winner and extra_left > 0:
                    win += 1
                    extra_left -= 1
                uid = p["user_id"]
                sc = hand["score"]
                c.execute(
                    "UPDATE poker_room_players SET score=?, rank=? WHERE room_id=? AND user_id=?",
                    (sc, rank, room_id, uid),
                )
                name = _player_display_name(p, account_id)
                results.append({
                    "user_id": uid,
                    "agent_id": p.get("agent_id", ""),
                    "name": name,
                    "is_npc": str(uid).startswith("npc_"),
                    "score": sc,
                    "rank": rank,
                    "won": win,
                    "hole_cards": hand["hole_cards"],
                    "best_cards": hand["best_cards"],
                    "hand_name": hand["hand_name"],
                    "hand_combo": hand["hand_combo"],
                    "hand_rank_key": hand.get("hand_rank_key"),
                    "hole_cards_display": [card_display(c) for c in hand["hole_cards"]],
                    "best_cards_display": [card_display(c) for c in hand["best_cards"]],
                })
            c.execute(
                "UPDATE poker_rooms SET status='settled', settled_at=?, pot=0 WHERE id=?",
                (life_db.now_ms(), room_id),
            )

    for r in results:
        if r["won"] > 0 and not r["is_npc"]:
            uid = r["user_id"]
            user = load_user(uid)
            _earn(user, r["won"], account_id=uid)
            save_user(uid, user)
            life_db.add_season_points(uid, pvp_win=1, social=5)

    for r in results:
        if not r["is_npc"] and str(r["user_id"]).startswith("acc_"):
            life_db.try_referral_poker_reward(r["user_id"])

    for r in results:
        if r.get("is_npc"):
            continue
        uid = r["user_id"]
        hand_key = r.get("hand_rank_key") or []
        hand_cat = int(hand_key[0]) if hand_key else 0
        player_buy_in = buy_in
        for p in plist:
            if p["user_id"] == uid:
                player_buy_in = p.get("buy_in", buy_in) or buy_in
                break
        net = int(r.get("won") or 0) - int(player_buy_in)
        life_db.record_weekly_poker(
            uid,
            won=int(r.get("won") or 0),
            net=net,
            won_hand=r.get("rank") == 1,
            hand_cat=hand_cat,
            hand_name=r.get("hand_name") or r.get("hand_combo") or "",
        )
        if r.get("rank") == 1 and life_db.is_poker_highlight(hand_cat, int(r.get("won") or 0), player_buy_in):
            acc = life_db.get_account_by_id(uid) or {}
            life_db.publish_poker_highlight(
                uid,
                acc.get("display_name") or acc.get("username") or r.get("name") or "玩家",
                hand_name=r.get("hand_name") or r.get("hand_combo") or "精彩牌型",
                hand_combo=r.get("hand_combo") or "",
                community=community,
                hole_cards=r.get("hole_cards") or [],
                won=int(r.get("won") or 0),
                pot=pot,
                room_id=room_id,
            )

    highlight_broadcast = None
    for r in results:
        if r.get("user_id") == account_id and r.get("rank") == 1:
            hand_key = r.get("hand_rank_key") or []
            hand_cat = int(hand_key[0]) if hand_key else 0
            player_buy_in = buy_in
            for p in plist:
                if p["user_id"] == account_id:
                    player_buy_in = p.get("buy_in", buy_in) or buy_in
                    break
            if life_db.is_poker_highlight(hand_cat, int(r.get("won") or 0), player_buy_in):
                highlight_broadcast = {
                    "hand_name": r.get("hand_name") or r.get("hand_combo") or "",
                    "won": int(r.get("won") or 0),
                    "pot": pot,
                }
            break

    caller_cost = buy_in
    for p in plist:
        if p["user_id"] == account_id:
            caller_cost = p.get("buy_in", buy_in) or buy_in
            break
    human_win = next((r["won"] for r in results if r["user_id"] == account_id), 0)
    net = human_win - caller_cost if any(p["user_id"] == account_id for p in plist) else 0

    first_win = False
    for r in results:
        if r.get("is_npc"):
            continue
        meta = life_db.record_poker_game_meta(
            r["user_id"],
            won_hand=bool(r.get("won", 0) > 0 or r.get("rank") == 1),
        )
        if r["user_id"] == account_id and meta.get("first_win"):
            first_win = True

    return {
        "ok": True,
        "results": results,
        "community_cards": community,
        "community_cards_display": [card_display(c) for c in community],
        "winner": results[0] if results else None,
        "pot": pot, "won": human_win, "cost": caller_cost, "net": net,
        "balance": load_user(account_id)["points"],
        "tie": winner_count > 1,
        "winners_count": winner_count,
        "highlight_broadcast": highlight_broadcast,
        "first_win": first_win,
    }


@pvp_router.post("/pvp/poker/solo")
def poker_solo(body: PokerSoloBody, account_id: str = Depends(resolve_account_id)):
    """单人 vs 系统 NPC（2 位 NPC 牌友 + 荷官 Jack 发牌），立即开局"""
    from life_game import load_user, save_user, _spend

    buy_in = max(10, min(body.buy_in, 500))
    user = load_user(account_id)
    if not _spend(user, buy_in):
        save_user(account_id, user)
        return {"ok": False, "error": "积分不足", "cost": buy_in, "balance": user["points"]}
    save_user(account_id, user)

    try:
        rid = f"solo_{uuid.uuid4().hex[:10]}"
        ts = life_db.now_ms()
        pot = buy_in * (1 + len(NPC_POKER_ROSTER))
        with life_db._lock:
            with life_db._conn() as c:
                c.execute(
                    "INSERT INTO poker_rooms (id, status, pot, host_user_id, buy_in, created_at, started_at) VALUES (?,?,?,?,?,?,?)",
                    (rid, "playing", pot, account_id, buy_in, ts, ts),
                )
                c.execute(
                    "INSERT INTO poker_room_players (room_id, user_id, agent_id, seat_id, buy_in) VALUES (?,?,?,?,?)",
                    (rid, account_id, body.agent_id, "poker_s2", buy_in),
                )
                for uid, name, seat in NPC_POKER_ROSTER:
                    c.execute(
                        "INSERT INTO poker_room_players (room_id, user_id, agent_id, seat_id, buy_in) VALUES (?,?,?,?,?)",
                        (rid, uid, f"agent_{uid}", seat, buy_in),
                    )
                room = c.execute("SELECT * FROM poker_rooms WHERE id=?", (rid,)).fetchone()
                players = c.execute("SELECT * FROM poker_room_players WHERE room_id=?", (rid,)).fetchall()

        out = _settle_poker_room(rid, dict(room), list(players), account_id)
        if not out.get("ok"):
            user = load_user(account_id)
            user["points"] = user.get("points", 0) + buy_in
            save_user(account_id, user)
            out["balance"] = user["points"]
            out["error"] = out.get("error") or "开牌失败，买入已退回"
            return out
        out["mode"] = "solo_npc"
        out["balance"] = load_user(account_id)["points"]
        return out
    except Exception:
        user = load_user(account_id)
        user["points"] = user.get("points", 0) + buy_in
        save_user(account_id, user)
        return {"ok": False, "error": "发牌异常，买入已退回", "balance": user["points"]}


@pvp_router.post("/pvp/poker/quick-join")
async def poker_quick_join(body: PokerJoinBody, account_id: str = Depends(resolve_account_id)):
    """快速加入等待房（入座免费）；无公开房则单人 vs NPC（开局扣买入）。"""
    with life_db._lock:
        with life_db._conn() as c:
            rows = c.execute(
                """SELECT * FROM poker_rooms WHERE status='waiting' AND id NOT LIKE 'solo_%'
                   AND COALESCE(game_mode, 'classic') = 'classic'
                   AND EXISTS (
                     SELECT 1 FROM poker_room_players p
                     WHERE p.room_id=poker_rooms.id AND p.user_id NOT LIKE 'npc_%'
                   )
                   ORDER BY created_at ASC LIMIT 10"""
            ).fetchall()
            target = None
            for r in rows:
                cnt = c.execute("SELECT COUNT(*) FROM poker_room_players WHERE room_id=?", (r["id"],)).fetchone()[0]
                if cnt < 7 and not c.execute(
                    "SELECT 1 FROM poker_room_players WHERE room_id=? AND user_id=?",
                    (r["id"], account_id),
                ).fetchone():
                    target = dict(r)
                    break

    if not target:
        return {"ok": False, "error": "暂无等待中的公开房间", "mode": "no_room"}

    with life_db._lock:
        with life_db._conn() as c:
            count = c.execute("SELECT COUNT(*) FROM poker_room_players WHERE room_id=?", (target["id"],)).fetchone()[0]
            taken = {r["seat_id"] for r in c.execute(
                "SELECT seat_id FROM poker_room_players WHERE room_id=?", (target["id"],)
            ).fetchall()}
            seat = body.seat_id
            if not seat or seat in taken:
                for i in range(1, 8):
                    candidate = f"poker_s{i}"
                    if candidate not in taken:
                        seat = candidate
                        break
                else:
                    seat = f"poker_s{(count % 7) + 1}"
            c.execute(
                "INSERT INTO poker_room_players (room_id, user_id, agent_id, seat_id, buy_in) VALUES (?,?,?,?,?)",
                (target["id"], account_id, body.agent_id, seat, 0),
            )
            payload = _room_payload(c, target, account_id)

    return {
        "ok": True, "mode": "waiting", "room_id": target["id"], "room_code": target["id"],
        "seat_id": seat, "buy_in": target["buy_in"], "room": payload,
        "message": f"已加入房间 {target['id']}（免费）· {payload['human_count']} 人在座 · 满员后点「开始牌局」才扣 {target['buy_in']} 积分",
    }


class SeatBidBody(BaseModel):
    amount: int


class DispatchEnqueueBody(BaseModel):
    agent_id: str
    action: str
    node_id: str = ""
    tier_id: str = "a"
    cost: int = 0  # 已废弃，服务端计价


class TradingPkBody(BaseModel):
    defender_id: str = ""
    stake: int = 50


@pvp_router.get("/pvp/poker/rooms")
async def list_poker_rooms(account_id: str = Depends(resolve_account_id)):
    with life_db._lock:
        with life_db._conn() as c:
            _cleanup_empty_waiting_rooms(c)
            rooms = c.execute(
                """SELECT * FROM poker_rooms WHERE status='waiting'
                   AND EXISTS (
                     SELECT 1 FROM poker_room_players p
                     WHERE p.room_id=poker_rooms.id AND p.user_id NOT LIKE 'npc_%'
                   )
                   ORDER BY created_at DESC LIMIT 20"""
            ).fetchall()
            result = [_room_payload(c, dict(r), account_id) for r in rooms]
    return {"ok": True, "rooms": result}


@pvp_router.get("/pvp/poker/rooms/mine")
async def get_my_poker_room(account_id: str = Depends(resolve_account_id)):
    """返回当前用户所在的等待中房间（用于刷新后恢复状态）。"""
    with life_db._lock:
        with life_db._conn() as c:
            _cleanup_empty_waiting_rooms(c)
            row = c.execute(
                """SELECT r.* FROM poker_rooms r
                   INNER JOIN poker_room_players p ON p.room_id = r.id
                   WHERE p.user_id = ? AND r.status = 'waiting'
                   ORDER BY r.created_at DESC LIMIT 1""",
                (account_id,),
            ).fetchone()
            if not row:
                return {"ok": True, "room": None}
            payload = _room_payload(c, dict(row), account_id)
    return {"ok": True, "room": payload}


@pvp_router.get("/pvp/poker/rooms/{room_id}")
async def get_poker_room(room_id: str, account_id: str = Depends(resolve_account_id)):
    with life_db._lock:
        with life_db._conn() as c:
            _cleanup_empty_waiting_rooms(c)
            rid = _resolve_room_id(c, room_id)
            if not rid:
                return {"ok": False, "error": "房间不存在"}
            room = c.execute("SELECT * FROM poker_rooms WHERE id=?", (rid,)).fetchone()
            if not room:
                return {"ok": False, "error": "房间不存在"}
            room = dict(room)
            if room["status"] == "waiting" and _human_count_in_room(c, rid) == 0:
                _close_poker_room(c, rid)
                return {"ok": False, "error": "房间已关闭（无人）"}
            if room["status"] in ("closed", "settled"):
                return {"ok": False, "error": "房间已关闭"}
            payload = _room_payload(c, room, account_id)
    return {"ok": True, "room": payload}


@pvp_router.post("/pvp/poker/rooms")
async def create_poker_room(body: PokerCreateBody, account_id: str = Depends(resolve_account_id)):
    from poker_advanced import validate_advanced_buy_in
    from poker_style import ADVANCED_BUY_INS

    ts = life_db.now_ms()
    game_mode = (body.game_mode or "classic").strip().lower()
    if game_mode == "advanced":
        buy_in = validate_advanced_buy_in(body.buy_in)
        if buy_in not in ADVANCED_BUY_INS:
            buy_in = ADVANCED_BUY_INS[0]
    else:
        game_mode = "classic"
        buy_in = max(10, min(body.buy_in, 500))
    agent_id = (body.agent_id or "").strip()
    seat = "poker_s1"
    with life_db._lock:
        with life_db._conn() as c:
            rid = _generate_room_code(c)
            c.execute(
                """INSERT INTO poker_rooms
                   (id, status, pot, host_user_id, buy_in, created_at, game_mode, min_players)
                   VALUES (?,?,0,?,?,?,?,?)""",
                (rid, "waiting", account_id, buy_in, ts, game_mode, 2 if game_mode == "advanced" else 2),
            )
            if agent_id:
                c.execute(
                    "INSERT INTO poker_room_players (room_id, user_id, agent_id, seat_id, buy_in) VALUES (?,?,?,?,?)",
                    (rid, account_id, agent_id, seat, 0),
                )
            room = dict(c.execute("SELECT * FROM poker_rooms WHERE id=?", (rid,)).fetchone())
            payload = _room_payload(c, room, account_id)
    mode_label = "进阶" if game_mode == "advanced" else "经典"
    return {
        "ok": True, "room_id": rid, "room_code": rid, "buy_in": buy_in, "game_mode": game_mode,
        "seat_id": seat if agent_id else "", "room": payload,
        "message": f"{mode_label}房间 {rid} 已创建 · 最多 7 人 · 买入 {buy_in}",
    }


@pvp_router.post("/pvp/poker/rooms/{room_id}/join")
async def join_poker_room(room_id: str, body: PokerJoinBody, account_id: str = Depends(resolve_account_id)):
    """入座加入房间（免费，开局时才扣买入积分）。"""
    with life_db._lock:
        with life_db._conn() as c:
            rid = _resolve_room_id(c, room_id)
            if not rid:
                return {"ok": False, "error": "房间不存在"}
            room = c.execute("SELECT * FROM poker_rooms WHERE id=? AND status='waiting'", (rid,)).fetchone()
            if not room:
                return {"ok": False, "error": "房间不可用"}
            if c.execute("SELECT 1 FROM poker_room_players WHERE room_id=? AND user_id=?", (rid, account_id)).fetchone():
                me = c.execute(
                    "SELECT seat_id, agent_id FROM poker_room_players WHERE room_id=? AND user_id=?",
                    (rid, account_id),
                ).fetchone()
                room = dict(room)
                payload = _room_payload(c, room, account_id)
                return {
                    "ok": True, "already_joined": True, "room_id": rid, "room_code": rid,
                    "seat_id": me["seat_id"] if me else "",
                    "buy_in": room["buy_in"], "room": payload,
                    "message": "已在房间中",
                }
            count = c.execute("SELECT COUNT(*) FROM poker_room_players WHERE room_id=?", (rid,)).fetchone()[0]
            if count >= 7:
                return {"ok": False, "error": "房间已满（最多 7 人）"}
            taken = {r["seat_id"] for r in c.execute(
                "SELECT seat_id FROM poker_room_players WHERE room_id=?", (rid,)
            ).fetchall()}
            seat = body.seat_id
            if not seat or seat in taken:
                for i in range(1, 8):
                    candidate = f"poker_s{i}"
                    if candidate not in taken:
                        seat = candidate
                        break
                else:
                    seat = f"poker_s{(count % 7) + 1}"
            c.execute(
                "INSERT INTO poker_room_players (room_id, user_id, agent_id, seat_id, buy_in) VALUES (?,?,?,?,?)",
                (rid, account_id, body.agent_id, seat, 0),
            )
            room = dict(room)
            payload = _room_payload(c, room, account_id)
    return {
        "ok": True, "room_id": rid, "room_code": rid, "seat_id": seat,
        "buy_in": room["buy_in"], "room": payload,
        "message": f"已加入房间 {rid} · 免费入座 · 点「开始牌局」扣 {room['buy_in']} 积分",
    }


@pvp_router.post("/pvp/poker/rooms/join-by-code")
async def join_poker_room_by_code(body: PokerJoinByCodeBody, account_id: str = Depends(resolve_account_id)):
    """通过 5 位房间编号加入。"""
    code = (body.room_code or "").strip()
    if not code.isdigit() or not (1 <= len(code) <= 5):
        return {"ok": False, "error": "请输入 5 位数字房间编号"}
    return await join_poker_room(code.zfill(5) if len(code) < 5 else code, PokerJoinBody(
        agent_id=body.agent_id, seat_id=body.seat_id,
    ), account_id)


@pvp_router.post("/pvp/poker/rooms/{room_id}/seat")
async def change_poker_seat(room_id: str, body: PokerChangeSeatBody, account_id: str = Depends(resolve_account_id)):
    """在房间内更换座位（仅等待中可换）。"""
    seat_req = (body.seat_id or "").strip()
    if not seat_req.startswith("poker_s"):
        return {"ok": False, "error": "无效座位"}
    try:
        num = int(seat_req.replace("poker_s", ""))
        if not 1 <= num <= 7:
            return {"ok": False, "error": "无效座位"}
    except ValueError:
        return {"ok": False, "error": "无效座位"}

    with life_db._lock:
        with life_db._conn() as c:
            rid = _resolve_room_id(c, room_id)
            if not rid:
                return {"ok": False, "error": "房间不存在"}
            room = c.execute("SELECT * FROM poker_rooms WHERE id=? AND status='waiting'", (rid,)).fetchone()
            if not room:
                return {"ok": False, "error": "牌局已开始，无法换座"}
            row = c.execute(
                "SELECT * FROM poker_room_players WHERE room_id=? AND user_id=?",
                (rid, account_id),
            ).fetchone()
            if not row:
                return {"ok": False, "error": "你不在该房间中"}
            player = dict(row)
            if player.get("seat_id") == seat_req:
                payload = _room_payload(c, dict(room), account_id)
                return {"ok": True, "seat_id": seat_req, "room": payload, "message": "已在该座位"}
            taken = c.execute(
                "SELECT user_id FROM poker_room_players WHERE room_id=? AND seat_id=? AND user_id!=?",
                (rid, seat_req, account_id),
            ).fetchone()
            if taken:
                return {"ok": False, "error": "该座位已被占用"}
            c.execute(
                "UPDATE poker_room_players SET seat_id=? WHERE room_id=? AND user_id=?",
                (seat_req, rid, account_id),
            )
            payload = _room_payload(c, dict(room), account_id)
    return {
        "ok": True, "room_id": rid, "seat_id": seat_req, "room": payload,
        "message": f"已换到座位 {num}",
    }


@pvp_router.post("/pvp/poker/rooms/{room_id}/leave")
async def leave_poker_room(room_id: str, account_id: str = Depends(resolve_account_id)):
    """离开房间；若房间无真人则自动关闭。"""
    with life_db._lock:
        with life_db._conn() as c:
            rid = _resolve_room_id(c, room_id)
            if not rid:
                return {"ok": True, "closed": True, "message": "房间已不存在"}
            room = c.execute("SELECT * FROM poker_rooms WHERE id=? AND status='waiting'", (rid,)).fetchone()
            if not room:
                return {"ok": True, "closed": True, "message": "房间已结束或关闭"}
            if not c.execute(
                "SELECT 1 FROM poker_room_players WHERE room_id=? AND user_id=?",
                (rid, account_id),
            ).fetchone():
                return {"ok": True, "closed": False, "message": "你已不在该房间中"}
            closed = _leave_poker_room(c, rid, account_id)
    return {
        "ok": True,
        "closed": closed,
        "room_id": rid,
        "message": "房间已关闭" if closed else "已离开房间",
    }


@pvp_router.post("/pvp/poker/rooms/{room_id}/start")
async def start_poker_room(room_id: str, account_id: str = Depends(resolve_account_id)):
    """开始牌局：此时才向所有真人收取买入积分并开牌。"""
    from life_game import load_user

    with life_db._lock:
        with life_db._conn() as c:
            room = c.execute("SELECT * FROM poker_rooms WHERE id=? AND status='waiting'", (room_id,)).fetchone()
            if not room:
                return {"ok": False, "error": "房间不可开始（可能已在进行中）"}
            players = [dict(p) for p in c.execute("SELECT * FROM poker_room_players WHERE room_id=?", (room_id,)).fetchall()]
            if not any(p["user_id"] == account_id for p in players):
                return {"ok": False, "error": "你不在该房间中，请先加入"}

    room = dict(room)
    game_mode = room.get("game_mode") or "classic"
    humans = [p for p in players if not p["user_id"].startswith("npc_") and not p["user_id"].startswith("ai_")]
    if len(humans) < room["min_players"]:
        if len(humans) == 1 and game_mode == "classic":
            taken = {p["seat_id"] for p in players}
            with life_db._lock:
                with life_db._conn() as c:
                    _add_npc_players_to_room(c, room_id, room["buy_in"], taken)
                    players = [dict(p) for p in c.execute("SELECT * FROM poker_room_players WHERE room_id=?", (room_id,)).fetchall()]
        elif game_mode == "advanced" and len(players) < 7:
            # 进阶多人：不足 7 人时用 AI 选手补位
            taken = {p["seat_id"] for p in players}
            from poker_advanced import pick_ai_opponents
            need = max(0, min(6, 7 - len(players)))
            bots = pick_ai_opponents(need, {p["user_id"] for p in players})
            with life_db._lock:
                with life_db._conn() as c:
                    si = 1
                    for uid, name, _preset in bots:
                        while f"poker_s{si}" in taken and si <= 7:
                            si += 1
                        if si > 7:
                            break
                        seat = f"poker_s{si}"
                        taken.add(seat)
                        c.execute(
                            "INSERT INTO poker_room_players (room_id, user_id, agent_id, seat_id, buy_in) VALUES (?,?,?,?,?)",
                            (room_id, uid, f"agent_{uid}", seat, 0),
                        )
                        si += 1
                    players = [dict(p) for p in c.execute("SELECT * FROM poker_room_players WHERE room_id=?", (room_id,)).fetchall()]
        else:
            return {"ok": False, "error": f"至少需要 {room['min_players']} 名玩家才能开始"}

    ok, err = _charge_human_buy_ins(room_id, room, players)
    if not ok:
        return {"ok": False, "error": err, "cost": room["buy_in"]}

    if game_mode == "advanced":
        out = await _start_advanced_tournament(room_id, room, players, account_id, spectator=False)
        out["cost"] = room["buy_in"]
        if not out.get("balance"):
            out["balance"] = load_user(account_id)["points"]
        return out

    with life_db._lock:
        with life_db._conn() as c:
            players = [dict(p) for p in c.execute("SELECT * FROM poker_room_players WHERE room_id=?", (room_id,)).fetchall()]
    pot = _calc_room_pot(room, players)
    ts = life_db.now_ms()
    with life_db._lock:
        with life_db._conn() as c:
            c.execute("UPDATE poker_rooms SET status='playing', started_at=?, pot=? WHERE id=?", (ts, pot, room_id))
            room = dict(c.execute("SELECT * FROM poker_rooms WHERE id=?", (room_id,)).fetchone())
            players = c.execute("SELECT * FROM poker_room_players WHERE room_id=?", (room_id,)).fetchall()

    out = _settle_poker_room(room_id, room, players, account_id)
    out["mode"] = "classic"
    out["balance"] = load_user(account_id)["points"]
    out["cost"] = room["buy_in"]
    return out


@pvp_router.post("/pvp/poker/rooms/{room_id}/play")
async def play_poker_round(room_id: str, account_id: str = Depends(resolve_account_id)):
    from life_game import load_user

    with life_db._lock:
        with life_db._conn() as c:
            room = c.execute("SELECT * FROM poker_rooms WHERE id=? AND status='playing'", (room_id,)).fetchone()
            if not room:
                return {"ok": False, "error": "牌局未开始，请先点「开始牌局」"}
            players = [dict(p) for p in c.execute("SELECT * FROM poker_room_players WHERE room_id=?", (room_id,)).fetchall()]
            if len(players) < 2:
                return {"ok": False, "error": "玩家不足"}

    room = dict(room)
    if room["pot"] <= 0:
        ok, err = _charge_human_buy_ins(room_id, room, players)
        if not ok:
            return {"ok": False, "error": err, "cost": room["buy_in"]}
        pot = _calc_room_pot(room, players)
        with life_db._lock:
            with life_db._conn() as c:
                c.execute("UPDATE poker_rooms SET pot=? WHERE id=?", (pot, room_id))
                room["pot"] = pot
                players = [dict(p) for p in c.execute("SELECT * FROM poker_room_players WHERE room_id=?", (room_id,)).fetchall()]

    out = _settle_poker_room(room_id, room, players, account_id)
    out["mode"] = "pvp"
    out["balance"] = load_user(account_id)["points"]
    return out


@pvp_router.get("/pvp/poker/presets")
async def poker_presets_catalog(account_id: str = Depends(resolve_account_id)):
    from poker_style import catalog_presets, ADVANCED_BUY_INS, CLASSIC_BUY_INS
    return {
        "ok": True,
        "presets": catalog_presets(),
        "advanced_buy_ins": ADVANCED_BUY_INS,
        "classic_buy_ins": CLASSIC_BUY_INS,
    }


@pvp_router.post("/pvp/poker/ai-spectator/start")
async def start_ai_spectator(body: PokerAiSpectatorBody, account_id: str = Depends(resolve_account_id)):
    """AI 观赛桌 — 用户 Agent 与 AI 选手自动博弈，用户仅观看"""
    from life_game import load_user, save_user, _spend
    from poker_advanced import init_advanced_room, get_advanced_state, validate_advanced_buy_in, pick_ai_opponents
    from poker_advanced import build_roster_from_db, _agent_profile_and_soul
    from poker_bot import merge_profile

    buy_in = validate_advanced_buy_in(body.buy_in)
    num = max(2, min(body.num_players, 7))
    agent_id = (body.agent_id or "").strip()
    if not agent_id:
        return {"ok": False, "error": "请选择你的 Agent"}

    user = load_user(account_id)
    custom = user.get("custom_agents") or {}
    if agent_id not in custom:
        return {"ok": False, "error": "Agent 不存在"}
    if not _spend(user, buy_in):
        save_user(account_id, user)
        return {"ok": False, "error": f"积分不足（需 {buy_in}）", "balance": user["points"]}
    save_user(account_id, user)

    acc = life_db.get_account_by_id(account_id)
    agent_name = custom[agent_id].get("name") or agent_id
    profile, soul = _agent_profile_and_soul(account_id, agent_id)

    roster = [{
        "user_id": account_id,
        "agent_id": agent_id,
        "seat_id": "poker_s1",
        "name": agent_name,
        "is_npc": False,
        "poker_profile": profile,
        "soul_md": soul,
    }]
    bots = pick_ai_opponents(num - 1, {account_id})
    for i, (uid, name, preset) in enumerate(bots):
        roster.append({
            "user_id": uid,
            "agent_id": f"agent_{uid}",
            "seat_id": f"poker_s{i + 2}",
            "name": name,
            "is_npc": True,
            "poker_profile": merge_profile({"preset": preset}),
            "soul_md": "",
        })

    rid = f"adv_{uuid.uuid4().hex[:10]}"
    with life_db._lock:
        with life_db._conn() as c:
            init_advanced_room(c, rid, buy_in, account_id, roster, spectator=True, create_new=True)

    out = await get_advanced_state(rid, account_id, since_seq=0, auto_run=False, max_steps=0)
    out["room_id"] = rid
    out["buy_in"] = buy_in
    out["balance"] = load_user(account_id)["points"]
    out["message"] = f"观赛开始 · {num} 人桌 · 买入 {buy_in}"
    return out


@pvp_router.get("/pvp/poker/rooms/{room_id}/advanced/state")
async def get_advanced_poker_state(
    room_id: str,
    since_seq: int = 0,
    auto_run: bool = True,
    max_steps: int = 1,
    use_llm: bool = False,
    run_until_complete: bool = False,
    account_id: str = Depends(resolve_account_id),
):
    from poker_advanced import get_advanced_state
    cap = 80 if not run_until_complete else 250
    return await get_advanced_state(
        room_id, account_id, since_seq=since_seq,
        auto_run=auto_run,
        max_steps=max(0, min(max_steps, cap)),
        use_llm=use_llm,
        run_until_complete=run_until_complete,
    )


@pvp_router.post("/pvp/poker/rooms/{room_id}/advanced/tick")
async def tick_advanced_poker(room_id: str, account_id: str = Depends(resolve_account_id)):
    from poker_advanced import get_advanced_state
    return await get_advanced_state(
        room_id, account_id, since_seq=0, auto_run=True, max_steps=40, use_llm=False,
    )


@pvp_router.get("/pvp/seats/auctions")
async def list_auctions():
    ts = life_db.now_ms()
    with life_db._lock:
        with life_db._conn() as c:
            c.execute("DELETE FROM seat_auctions WHERE ends_at > 0 AND ends_at < ?", (ts,))
            rows = c.execute("SELECT * FROM seat_auctions").fetchall()
    return {"ok": True, "auctions": [dict(r) for r in rows]}


@pvp_router.post("/pvp/seats/{seat_id}/bid")
async def bid_seat(seat_id: str, body: SeatBidBody, account_id: str = Depends(resolve_account_id)):
    ts = life_db.now_ms()
    ends = ts + AUCTION_EXTEND_MS
    with life_db._lock:
        with life_db._conn() as c:
            auc = c.execute("SELECT * FROM seat_auctions WHERE seat_id=?", (seat_id,)).fetchone()
            min_bid = (auc["high_bid"] + AUCTION_MIN_BID) if auc else AUCTION_MIN_BID
            if body.amount < min_bid:
                return {"ok": False, "error": f"出价至少 {min_bid}"}
            prev_bidder = auc["high_bidder"] if auc else None
            prev_bid = int(auc["high_bid"]) if auc else 0
            ok, balance = life_db._adjust_points_cursor(c, account_id, -body.amount)
            if not ok:
                return {"ok": False, "error": "积分不足"}
            if prev_bidder and prev_bidder != account_id and prev_bid > 0:
                life_db._adjust_points_cursor(c, prev_bidder, prev_bid)
            if auc:
                c.execute(
                    "UPDATE seat_auctions SET high_bid=?, high_bidder=?, ends_at=? WHERE seat_id=?",
                    (body.amount, account_id, ends, seat_id),
                )
            else:
                c.execute(
                    "INSERT INTO seat_auctions (seat_id, activity, high_bid, high_bidder, ends_at) VALUES (?,?,?,?,?)",
                    (seat_id, "any", body.amount, account_id, ends),
                )
    return {"ok": True, "seat_id": seat_id, "bid": body.amount, "ends_at": ends, "balance": balance}


@pvp_router.post("/pvp/dispatch/enqueue")
async def enqueue_dispatch(body: DispatchEnqueueBody, account_id: str = Depends(resolve_account_id)):
    from life_game import _dispatch_cost

    tier_id = (body.tier_id or "a").strip().lower()
    if tier_id not in ("a", "b", "c"):
        tier_id = "a"
    cost = _dispatch_cost(body.action, tier_id)
    ts = life_db.now_ms()
    with life_db._lock:
        with life_db._conn() as c:
            c.execute(
                "INSERT INTO dispatch_queue (user_id, agent_id, action, node_id, cost, enqueued_at) VALUES (?,?,?,?,?,?)",
                (account_id, body.agent_id, body.action, body.node_id, cost, ts),
            )
            qid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
    return {"ok": True, "queue_id": qid, "cost": cost}


@pvp_router.get("/pvp/dispatch/queue")
async def get_dispatch_queue(account_id: str = Depends(resolve_account_id)):
    with life_db._lock:
        with life_db._conn() as c:
            rows = c.execute(
                "SELECT * FROM dispatch_queue WHERE user_id=? AND status='pending' ORDER BY enqueued_at ASC",
                (account_id,),
            ).fetchall()
    return {"ok": True, "queue": [dict(r) for r in rows]}


@pvp_router.post("/pvp/dispatch/process")
async def process_dispatch_queue(account_id: str = Depends(resolve_account_id)):
    from life_game import FACILITY_COSTS

    ts = life_db.now_ms()
    processed = []
    with life_db._lock:
        with life_db._conn() as c:
            rows = c.execute(
                "SELECT * FROM dispatch_queue WHERE user_id=? AND status='pending' ORDER BY enqueued_at ASC LIMIT 5",
                (account_id,),
            ).fetchall()
            for row in rows:
                cost = int(row["cost"] or FACILITY_COSTS.get(row["action"], 0))
                if cost > 0:
                    ok, _ = life_db._adjust_points_cursor(c, account_id, -cost)
                    if not ok:
                        continue
                c.execute(
                    "UPDATE dispatch_queue SET status='done', processed_at=? WHERE id=?",
                    (ts, row["id"]),
                )
                processed.append(dict(row))
    for _ in processed:
        life_db.add_season_points(account_id, social=1)
    return {"ok": True, "processed": processed}


@pvp_router.post("/pvp/trading-pk")
async def trading_pk(body: TradingPkBody, account_id: str = Depends(resolve_account_id)):
    from life_game import load_user, save_user, _spend, _earn

    stake = max(20, min(body.stake, 200))
    user = load_user(account_id)
    if not _spend(user, stake):
        save_user(account_id, user)
        return {"ok": False, "error": "积分不足"}
    challenger_score = random.uniform(0, 100)
    defender_id = body.defender_id or "house"
    if defender_id == "house":
        defender_score = random.uniform(30, 80)
    else:
        with life_db._lock:
            with life_db._conn() as c:
                season = life_db.get_active_season()
                if season:
                    row = c.execute(
                        "SELECT pnl_score FROM season_scores WHERE season_id=? AND user_id=?",
                        (season["id"], defender_id),
                    ).fetchone()
                    defender_score = row["pnl_score"] if row else random.uniform(20, 70)
                else:
                    defender_score = random.uniform(20, 70)
    pk_id = f"pk_{uuid.uuid4().hex[:10]}"
    winner = account_id if challenger_score >= defender_score else defender_id
    won_amount = 0
    if winner == account_id:
        won_amount = int(stake * 1.8)
        _earn(user, won_amount)
        life_db.add_season_points(account_id, pvp_win=1, social=8, pnl=challenger_score - defender_score)
    save_user(account_id, user)
    ts = life_db.now_ms()
    with life_db._lock:
        with life_db._conn() as c:
            c.execute(
                """INSERT INTO trading_pk (id, challenger_id, defender_id, challenger_score, defender_score, winner_id, stake, status, created_at, settled_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (pk_id, account_id, defender_id, challenger_score, defender_score, winner, stake, "settled", ts, ts),
            )
    return {
        "ok": True, "pk_id": pk_id, "challenger_score": round(challenger_score, 1),
        "defender_score": round(defender_score, 1), "winner_id": winner,
        "won": won_amount, "balance": user["points"],
    }


# ─── Phase 3: Season ───────────────────────────────────────────

class GuildCreateBody(BaseModel):
    name: str


class GuildJoinBody(BaseModel):
    guild_id: str


class SeasonBuyBody(BaseModel):
    item_id: str


@season_router.get("/season/current")
async def current_season(account_id: str = Depends(resolve_account_id)):
    season = life_db.get_active_season()
    if not season:
        return {"ok": False, "error": "无活跃赛季"}
    life_db.ensure_season_score(season["id"], account_id)
    guild = life_db.get_user_guild(account_id, season["id"])
    with life_db._lock:
        with life_db._conn() as c:
            score = c.execute(
                "SELECT * FROM season_scores WHERE season_id=? AND user_id=?",
                (season["id"], account_id),
            ).fetchone()
            cosmetics = c.execute(
                "SELECT * FROM season_cosmetics WHERE season_id=?", (season["id"],),
            ).fetchall()
    return {
        "ok": True,
        "season": dict(season),
        "my_score": dict(score) if score else {},
        "guild": dict(guild) if guild else None,
        "cosmetics": [dict(c) for c in cosmetics],
    }


@season_router.get("/season/leaderboard")
async def season_leaderboard(metric: str = "points", limit: int = 20):
    season = life_db.get_active_season()
    if not season:
        return {"ok": True, "entries": []}
    col = {"points": "points_earned", "social": "social_score", "pvp": "pvp_wins", "pnl": "pnl_score"}.get(metric, "points_earned")
    with life_db._lock:
        with life_db._conn() as c:
            rows = c.execute(
                f"""SELECT s.user_id, s.points_earned, s.social_score, s.pvp_wins, s.pnl_score, a.display_name, a.username
                    FROM season_scores s
                    LEFT JOIN life_accounts a ON a.id = s.user_id
                    WHERE s.season_id=?
                    ORDER BY s.{col} DESC LIMIT ?""",
                (season["id"], min(limit, 50)),
            ).fetchall()
    entries = []
    for i, r in enumerate(rows):
        d = dict(r)
        d["rank"] = i + 1
        d["name"] = d.get("display_name") or d.get("username") or d["user_id"][:8]
        entries.append(d)
    return {"ok": True, "season_id": season["id"], "metric": metric, "entries": entries}


@season_router.post("/season/guilds")
async def create_guild(body: GuildCreateBody, account_id: str = Depends(resolve_account_id)):
    season = life_db.get_active_season()
    if not season:
        return {"ok": False, "error": "无活跃赛季"}
    if life_db.get_user_guild(account_id, season["id"]):
        return {"ok": False, "error": "已在公会中"}
    name = (body.name or "").strip()[:20]
    if len(name) < 2:
        return {"ok": False, "error": "名称太短"}
    gid = f"guild_{uuid.uuid4().hex[:10]}"
    with life_db._lock:
        with life_db._conn() as c:
            c.execute(
                "INSERT INTO guilds (id, season_id, name, leader_id, created_at) VALUES (?,?,?,?,?)",
                (gid, season["id"], name, account_id, life_db.datetime.now(life_db.CST).isoformat()),
            )
            c.execute(
                "INSERT INTO guild_members (guild_id, user_id, role, joined_at) VALUES (?,?,?,?)",
                (gid, account_id, "leader", life_db.datetime.now(life_db.CST).isoformat()),
            )
    return {"ok": True, "guild_id": gid, "name": name}


@season_router.get("/season/guilds")
async def list_guilds(limit: int = 20):
    season = life_db.get_active_season()
    if not season:
        return {"ok": True, "guilds": []}
    with life_db._lock:
        with life_db._conn() as c:
            rows = c.execute(
                """SELECT g.*, COUNT(m.user_id) as member_count FROM guilds g
                   LEFT JOIN guild_members m ON m.guild_id = g.id
                   WHERE g.season_id=? GROUP BY g.id ORDER BY g.score DESC LIMIT ?""",
                (season["id"], min(limit, 30)),
            ).fetchall()
    return {"ok": True, "guilds": [dict(r) for r in rows]}


@season_router.post("/season/guilds/join")
async def join_guild(body: GuildJoinBody, account_id: str = Depends(resolve_account_id)):
    season = life_db.get_active_season()
    if not season:
        return {"ok": False, "error": "无活跃赛季"}
    if life_db.get_user_guild(account_id, season["id"]):
        return {"ok": False, "error": "已在公会中"}
    with life_db._lock:
        with life_db._conn() as c:
            guild = c.execute("SELECT * FROM guilds WHERE id=? AND season_id=?", (body.guild_id, season["id"])).fetchone()
            if not guild:
                return {"ok": False, "error": "公会不存在"}
            cnt = c.execute("SELECT COUNT(*) FROM guild_members WHERE guild_id=?", (body.guild_id,)).fetchone()[0]
            if cnt >= 8:
                return {"ok": False, "error": "公会已满"}
            c.execute(
                "INSERT INTO guild_members (guild_id, user_id, role, joined_at) VALUES (?,?,?,?)",
                (body.guild_id, account_id, "member", life_db.datetime.now(life_db.CST).isoformat()),
            )
    return {"ok": True, "guild_id": body.guild_id}


@season_router.post("/season/shop/buy")
async def buy_season_cosmetic(body: SeasonBuyBody, account_id: str = Depends(resolve_account_id)):
    from life_game import load_user, save_user, _spend

    season = life_db.get_active_season()
    if not season:
        return {"ok": False, "error": "无活跃赛季"}
    with life_db._lock:
        with life_db._conn() as c:
            item = c.execute(
                "SELECT * FROM season_cosmetics WHERE season_id=? AND item_id=?",
                (season["id"], body.item_id),
            ).fetchone()
    if not item:
        return {"ok": False, "error": "商品不存在"}
    user = load_user(account_id)
    if body.item_id in user.get("shop_unlocks", []):
        return {"ok": True, "already_owned": True, "balance": user["points"]}
    if not _spend(user, item["cost"]):
        save_user(account_id, user)
        return {"ok": False, "error": "积分不足"}
    user["shop_unlocks"].append(body.item_id)
    save_user(account_id, user)
    life_db.add_season_points(account_id, social=3)
    return {"ok": True, "balance": user["points"], "item": dict(item)}


@season_router.post("/season/settle")
async def settle_season(account_id: str = Depends(require_admin)):
    """赛季结算 — 仅管理员可触发，按排名给所有上榜用户发奖。"""
    from life_game import load_user, save_user, _earn

    season = life_db.get_active_season()
    if not season:
        return {"ok": False, "error": "无活跃赛季"}
    ts = life_db.now_ms()
    if ts < season["ends_at"]:
        return {"ok": False, "error": "赛季未结束", "ends_at": season["ends_at"]}
    rewards = {1: 500, 2: 300, 3: 200, 4: 100, 5: 100}
    settled_count = 0
    payout_summary: list[dict] = []
    with life_db._lock:
        with life_db._conn() as c:
            if c.execute("SELECT status FROM seasons WHERE id=?", (season["id"],)).fetchone()["status"] == "ended":
                return {"ok": False, "error": "赛季已结算"}
            rows = c.execute(
                "SELECT user_id, points_earned FROM season_scores WHERE season_id=? AND settled=0 ORDER BY points_earned DESC LIMIT 10",
                (season["id"],),
            ).fetchall()
            for i, r in enumerate(rows):
                uid = r["user_id"]
                reward = rewards.get(i + 1, 50)
                c.execute(
                    "UPDATE season_scores SET settled=1, rank=? WHERE season_id=? AND user_id=?",
                    (i + 1, season["id"], uid),
                )
                if not str(uid).startswith(("npc_", "ai_")):
                    ok, balance = life_db._adjust_points_cursor(c, uid, reward)
                    if ok:
                        payout_summary.append({"user_id": uid, "rank": i + 1, "reward": reward, "balance": balance})
                settled_count += 1
            c.execute("UPDATE seasons SET status='ended' WHERE id=?", (season["id"],))
    for item in payout_summary:
        user = load_user(item["user_id"])
        user["points"] = item["balance"]
        save_user(item["user_id"], user)
    life_db._seed_engagement_data()
    my_reward = next((p["reward"] for p in payout_summary if p["user_id"] == account_id), 0)
    return {"ok": True, "settled": settled_count, "my_reward": my_reward, "payouts": payout_summary}
