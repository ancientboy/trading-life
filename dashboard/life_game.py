"""
交易人生 — 积分、每日任务、商城、自定义 Agent（按 X-Life-User-Id 隔离）
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Optional

import aiohttp
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

CST = timezone(timedelta(hours=8))

STARTING_POINTS = 200
MAX_ENTERTAINMENT_AGENTS = 1
MAX_TRADING_CUSTOM_AGENTS = 3

ACTIVITY_REWARDS = {"rest": 10, "dine": 15, "massage": 25, "poker": 20}
FACILITY_COSTS = {"rest": 5, "dine": 40, "massage": 50, "poker": 30}
IDLE_POINTS_PER_AGENT_PER_MIN = 3
IDLE_MAX_AGENTS = 5

DAILY_TASK_DEFS = [
    {"id": "idle_30", "label": "挂机 30 分钟", "target": 30, "reward": 50, "kind": "idle_minutes"},
    {"id": "massage_3", "label": "完成 3 次按摩", "target": 3, "reward": 40, "kind": "activity", "activity": "massage"},
    {"id": "dine_2", "label": "用餐 2 次", "target": 2, "reward": 30, "kind": "activity", "activity": "dine"},
    {"id": "dispatch_5", "label": "派遣 5 次", "target": 5, "reward": 35, "kind": "dispatch"},
]

SHOP_CATALOG = [
    {"id": "color_aurora", "type": "color", "value": "#FF6B9D", "cost": 80, "label": "极光粉"},
    {"id": "color_midnight", "type": "color", "value": "#1E3A5F", "cost": 80, "label": "午夜蓝"},
    {"id": "color_mint", "type": "color", "value": "#2DD4BF", "cost": 80, "label": "薄荷绿"},
    {"id": "hat_beret_unlock", "type": "hat", "value": "beret", "cost": 120, "label": "贝雷帽款式"},
    {"id": "hat_top_unlock", "type": "hat", "value": "top", "cost": 150, "label": "礼帽款式"},
    {"id": "hat_bobble_unlock", "type": "hat", "value": "bobble", "cost": 100, "label": "毛球帽款式"},
    {"id": "skin_sofa_gold", "type": "cosmetic", "value": "sofa_gold", "cost": 200, "label": "金色沙发皮肤"},
    {"id": "skin_table_premium", "type": "cosmetic", "value": "table_premium", "cost": 180, "label": "尊享餐桌皮肤"},
]

DEFAULT_FREE_UNLOCKS = ["color_default", "hat_beanie", "hat_cap"]

router = APIRouter()

_life_dir: Optional[Path] = None
_zhipu_key: str = ""


def init_life_game(data_dir: Path, zhipu_api_key: str = "") -> None:
    global _life_dir, _zhipu_key
    _life_dir = data_dir / "life_users"
    _life_dir.mkdir(parents=True, exist_ok=True)
    _zhipu_key = zhipu_api_key


def _today() -> str:
    return datetime.now(CST).strftime("%Y-%m-%d")


def _validate_user_id(user_id: str) -> str:
    uid = (user_id or "").strip()
    if not uid or len(uid) > 64:
        raise HTTPException(400, "Invalid X-Life-User-Id")
    return uid


def _user_path(user_id: str) -> Path:
    if _life_dir is None:
        raise HTTPException(500, "Life game not initialized")
    safe = "".join(c for c in user_id if c.isalnum() or c in "-_")
    return _life_dir / f"{safe}.json"


def _default_user() -> dict:
    tasks = {}
    for t in DAILY_TASK_DEFS:
        tasks[t["id"]] = {"progress": 0, "claimed": False}
    return {
        "points": STARTING_POINTS,
        "last_idle_tick": 0,
        "daily_date": _today(),
        "daily_tasks": tasks,
        "shop_unlocks": list(DEFAULT_FREE_UNLOCKS),
        "custom_agents": {},
        "stats": {
            "idle_ms_today": 0,
            "activities": {"rest": 0, "dine": 0, "massage": 0, "poker": 0},
            "dispatches": 0,
        },
    }


def load_user(user_id: str) -> dict:
    path = _user_path(user_id)
    if not path.exists():
        return _default_user()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return _default_user()
    return _merge_defaults(data)


def _merge_defaults(data: dict) -> dict:
    base = _default_user()
    base.update({k: v for k, v in data.items() if k != "daily_tasks"})
    if data.get("daily_date") != _today():
        base["daily_date"] = _today()
        base["daily_tasks"] = _default_user()["daily_tasks"]
        base["stats"] = {**_default_user()["stats"], "idle_ms_today": 0}
    else:
        tasks = _default_user()["daily_tasks"]
        for tid, t in (data.get("daily_tasks") or {}).items():
            if tid in tasks:
                tasks[tid] = {**tasks[tid], **t}
        base["daily_tasks"] = tasks
        base["stats"] = {**base["stats"], **(data.get("stats") or {})}
    base["shop_unlocks"] = list(set(DEFAULT_FREE_UNLOCKS + (data.get("shop_unlocks") or [])))
    base["custom_agents"] = data.get("custom_agents") or {}
    return base


def save_user(user_id: str, data: dict) -> None:
    path = _user_path(user_id)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _earn(user: dict, amount: int, reason: str = "") -> int:
    amount = max(0, int(amount))
    user["points"] = max(0, user.get("points", 0) + amount)
    return user["points"]


def _spend(user: dict, amount: int) -> bool:
    amount = max(0, int(amount))
    if user.get("points", 0) < amount:
        return False
    user["points"] -= amount
    return True


def _count_agents(custom: dict) -> tuple[int, int]:
    ent = sum(1 for a in custom.values() if a.get("agentType") == "entertainment")
    trading = sum(1 for a in custom.values() if a.get("agentType") != "entertainment")
    return ent, trading


def _public_state(user: dict) -> dict:
    return {
        "points": user["points"],
        "last_idle_tick": user.get("last_idle_tick", 0),
        "daily_date": user["daily_date"],
        "daily_tasks": user["daily_tasks"],
        "daily_task_defs": DAILY_TASK_DEFS,
        "shop_unlocks": user["shop_unlocks"],
        "shop_catalog": SHOP_CATALOG,
        "custom_agents": user["custom_agents"],
        "activity_rewards": ACTIVITY_REWARDS,
        "facility_costs": FACILITY_COSTS,
        "limits": {
            "max_entertainment": MAX_ENTERTAINMENT_AGENTS,
            "max_trading_custom": MAX_TRADING_CUSTOM_AGENTS,
        },
        "stats": user.get("stats", {}),
    }


def get_user_header(x_life_user_id: Optional[str] = Header(None)) -> str:
    if not x_life_user_id:
        raise HTTPException(401, "Missing X-Life-User-Id header")
    return _validate_user_id(x_life_user_id)


class SpendBody(BaseModel):
    amount: int
    reason: str = ""


class EarnBody(BaseModel):
    amount: int
    reason: str = ""


class IdleBody(BaseModel):
    agent_count: int = 1
    elapsed_ms: int = 0


class ActivityBody(BaseModel):
    activity: str


class DispatchBody(BaseModel):
    action: str
    cost: Optional[int] = None


class ShopBuyBody(BaseModel):
    item_id: str


class TaskClaimBody(BaseModel):
    task_id: str


class CustomAgentBody(BaseModel):
    agentType: str = "trading"
    name: str
    headwear: str = "scarf"
    hatStyle: str = "beanie"
    color: str = "#FFD700"
    desc: str = ""
    soul: str = ""
    strategy: str = ""
    market: str = ""
    interval: str = ""
    risk: str = "中"


class AgentSoulBody(BaseModel):
    content: str


class AgentSpeakBody(BaseModel):
    agent_id: str
    agent_name: str = "Agent"
    soul_md: str = ""
    context: str = "greeting"
    activity: Optional[str] = None


class MigrateBody(BaseModel):
    points: int = STARTING_POINTS
    last_idle_tick: int = 0
    custom_agents: dict = Field(default_factory=dict)
    shop_unlocks: list = Field(default_factory=list)


@router.get("/state")
async def life_state(user_id: str = Header(..., alias="X-Life-User-Id")):
    uid = _validate_user_id(user_id)
    user = load_user(uid)
    save_user(uid, user)
    return _public_state(user)


@router.post("/migrate")
async def life_migrate(body: MigrateBody, user_id: str = Header(..., alias="X-Life-User-Id")):
    uid = _validate_user_id(user_id)
    user = load_user(uid)
    if not user.get("custom_agents") and body.custom_agents:
        user["custom_agents"] = body.custom_agents
    if user.get("points", STARTING_POINTS) == STARTING_POINTS and body.points != STARTING_POINTS:
        user["points"] = max(0, body.points)
    if body.last_idle_tick:
        user["last_idle_tick"] = body.last_idle_tick
    if body.shop_unlocks:
        user["shop_unlocks"] = list(set(user["shop_unlocks"] + body.shop_unlocks))
    save_user(uid, user)
    return {"ok": True, **_public_state(user)}


@router.post("/points/spend")
async def life_spend(body: SpendBody, user_id: str = Header(..., alias="X-Life-User-Id")):
    uid = _validate_user_id(user_id)
    user = load_user(uid)
    if not _spend(user, body.amount):
        save_user(uid, user)
        return {"ok": False, "balance": user["points"], "error": "insufficient"}
    save_user(uid, user)
    return {"ok": True, "balance": user["points"], "reason": body.reason}


@router.post("/points/earn")
async def life_earn(body: EarnBody, user_id: str = Header(..., alias="X-Life-User-Id")):
    uid = _validate_user_id(user_id)
    user = load_user(uid)
    cap = 500
    amount = min(max(0, body.amount), cap)
    balance = _earn(user, amount, body.reason)
    save_user(uid, user)
    return {"ok": True, "balance": balance, "earned": amount}


@router.post("/points/idle")
async def life_idle(body: IdleBody, user_id: str = Header(..., alias="X-Life-User-Id")):
    uid = _validate_user_id(user_id)
    user = load_user(uid)
    now_ms = int(datetime.now(CST).timestamp() * 1000)
    last = user.get("last_idle_tick") or now_ms
    elapsed = body.elapsed_ms or max(0, now_ms - last)
    if elapsed < 60_000:
        return {"ok": True, "balance": user["points"], "earned": 0}
    minutes = elapsed // 60_000
    agents = min(max(0, body.agent_count), IDLE_MAX_AGENTS)
    earned = minutes * agents * IDLE_POINTS_PER_AGENT_PER_MIN
    balance = _earn(user, earned)
    user["last_idle_tick"] = now_ms
    stats = user.setdefault("stats", {})
    stats["idle_ms_today"] = stats.get("idle_ms_today", 0) + elapsed
    dt = user.setdefault("daily_tasks", {})
    idle_task = dt.get("idle_30", {"progress": 0, "claimed": False})
    idle_task["progress"] = min(30, idle_task.get("progress", 0) + minutes)
    dt["idle_30"] = idle_task
    save_user(uid, user)
    return {"ok": True, "balance": balance, "earned": earned}


@router.post("/activity/complete")
async def life_activity_complete(body: ActivityBody, user_id: str = Header(..., alias="X-Life-User-Id")):
    uid = _validate_user_id(user_id)
    user = load_user(uid)
    reward = ACTIVITY_REWARDS.get(body.activity, 0)
    balance = _earn(user, reward)
    stats = user.setdefault("stats", {})
    acts = stats.setdefault("activities", {})
    acts[body.activity] = acts.get(body.activity, 0) + 1
    dt = user.setdefault("daily_tasks", {})
    for tdef in DAILY_TASK_DEFS:
        if tdef.get("kind") == "activity" and tdef.get("activity") == body.activity:
            task = dt.get(tdef["id"], {"progress": 0, "claimed": False})
            task["progress"] = min(tdef["target"], task.get("progress", 0) + 1)
            dt[tdef["id"]] = task
    save_user(uid, user)
    return {"ok": True, "balance": balance, "earned": reward}


@router.post("/dispatch")
async def life_dispatch(body: DispatchBody, user_id: str = Header(..., alias="X-Life-User-Id")):
    uid = _validate_user_id(user_id)
    user = load_user(uid)
    cost = body.cost if body.cost is not None else FACILITY_COSTS.get(body.action, 0)
    if cost > 0 and not _spend(user, cost):
        save_user(uid, user)
        return {"ok": False, "balance": user["points"], "error": "insufficient", "cost": cost}
    stats = user.setdefault("stats", {})
    stats["dispatches"] = stats.get("dispatches", 0) + 1
    dt = user.setdefault("daily_tasks", {})
    disp = dt.get("dispatch_5", {"progress": 0, "claimed": False})
    disp["progress"] = min(5, disp.get("progress", 0) + 1)
    dt["dispatch_5"] = disp
    save_user(uid, user)
    return {"ok": True, "balance": user["points"], "cost": cost}


@router.post("/tasks/claim")
async def life_claim_task(body: TaskClaimBody, user_id: str = Header(..., alias="X-Life-User-Id")):
    uid = _validate_user_id(user_id)
    user = load_user(uid)
    tdef = next((t for t in DAILY_TASK_DEFS if t["id"] == body.task_id), None)
    if not tdef:
        raise HTTPException(404, "Unknown task")
    task = user["daily_tasks"].get(body.task_id, {"progress": 0, "claimed": False})
    if task.get("claimed"):
        return {"ok": False, "error": "already_claimed"}
    if task.get("progress", 0) < tdef["target"]:
        return {"ok": False, "error": "not_complete", "progress": task.get("progress", 0)}
    task["claimed"] = True
    user["daily_tasks"][body.task_id] = task
    balance = _earn(user, tdef["reward"])
    save_user(uid, user)
    return {"ok": True, "balance": balance, "reward": tdef["reward"]}


@router.post("/shop/buy")
async def life_shop_buy(body: ShopBuyBody, user_id: str = Header(..., alias="X-Life-User-Id")):
    uid = _validate_user_id(user_id)
    item = next((i for i in SHOP_CATALOG if i["id"] == body.item_id), None)
    if not item:
        raise HTTPException(404, "Unknown item")
    user = load_user(uid)
    if body.item_id in user["shop_unlocks"]:
        return {"ok": True, "balance": user["points"], "already_owned": True}
    if not _spend(user, item["cost"]):
        save_user(uid, user)
        return {"ok": False, "balance": user["points"], "error": "insufficient"}
    user["shop_unlocks"].append(body.item_id)
    save_user(uid, user)
    return {"ok": True, "balance": user["points"], "item": item}


@router.post("/agents")
async def life_create_agent(body: CustomAgentBody, user_id: str = Header(..., alias="X-Life-User-Id")):
    uid = _validate_user_id(user_id)
    user = load_user(uid)
    custom = user.setdefault("custom_agents", {})
    ent, trading = _count_agents(custom)
    agent_type = body.agentType if body.agentType in ("entertainment", "trading") else "trading"
    if agent_type == "entertainment" and ent >= MAX_ENTERTAINMENT_AGENTS:
        return JSONResponse_error("娱乐 Agent 已达上限（1 个）")
    if agent_type == "trading" and trading >= MAX_TRADING_CUSTOM_AGENTS:
        return JSONResponse_error("交易 Agent 已达上限（3 个）")
    soul = (body.soul or "").strip()
    if len(soul) < 20:
        return JSONResponse_error("SOUL 文档至少 20 字")
    n = 1
    while f"custom_{n}" in custom:
        n += 1
    aid = f"custom_{n}"
    meta = {
        "id": aid,
        "agentType": agent_type,
        "name": body.name.strip() or aid,
        "headwear": body.headwear,
        "hatStyle": body.hatStyle,
        "color": body.color,
        "desc": body.desc,
        "soulMd": soul,
        "strategy": body.strategy if agent_type == "trading" else "休闲陪伴",
        "market": body.market if agent_type == "trading" else "—",
        "interval": body.interval if agent_type == "trading" else "—",
        "risk": body.risk if agent_type == "trading" else "—",
    }
    custom[aid] = meta
    save_user(uid, user)
    return {"ok": True, "agent": meta, "state": _public_state(user)}


@router.put("/agents/{agent_id}/soul")
async def life_update_soul(agent_id: str, body: AgentSoulBody, user_id: str = Header(..., alias="X-Life-User-Id")):
    uid = _validate_user_id(user_id)
    user = load_user(uid)
    custom = user.get("custom_agents", {})
    if agent_id not in custom:
        raise HTTPException(404, "Agent not found")
    content = (body.content or "").strip()
    if len(content) < 10:
        raise HTTPException(400, "SOUL 内容太短")
    if len(content) > 8000:
        raise HTTPException(400, "SOUL 内容不能超过 8000 字")
    custom[agent_id]["soulMd"] = content
    save_user(uid, user)
    return {"ok": True, "message": "SOUL 已保存"}


@router.post("/agent-speak")
async def life_agent_speak(body: AgentSpeakBody, user_id: str = Header(..., alias="X-Life-User-Id")):
    _validate_user_id(user_id)
    line = await _generate_speak_line(body)
    return {"ok": True, "line": line}


def JSONResponse_error(msg: str) -> dict:
    return {"ok": False, "error": msg}


SOUL_FALLBACK = {
    "greeting": ["嗨！今天想去哪逛逛？", "要不要一起去餐厅？", "我刚做完按摩，超放松～"],
    "rest": ["躺下就不想动了…", "沙发真舒服呀", "zzZ 休息中"],
    "dine": ["这顿太满足了！", "服务员 Lily 超热情", "吃饱了才有力气玩"],
    "massage": ["感觉压力都散掉了", "技师手法真不错", "差点睡着了…"],
    "poker": ["这把运气不错！", "荷官发牌好快", "再来一局？"],
    "trading": ["盯盘中，别打扰我～", "这波趋势有意思", "策略信号出现了"],
}


async def _generate_speak_line(body: AgentSpeakBody) -> str:
    import random
    ctx = body.context or "greeting"
    pool = SOUL_FALLBACK.get(ctx, SOUL_FALLBACK["greeting"])
    if not _zhipu_key or len((body.soul_md or "").strip()) < 10:
        return random.choice(pool)
    soul_excerpt = (body.soul_md or "")[:1200]
    prompt = (
        f"你是游戏角色「{body.agent_name}」。根据以下 SOUL 人格文档，"
        f"用一句话（不超过28字、口语化、不加引号）回应当前场景：{ctx}"
        + (f"，活动：{body.activity}" if body.activity else "")
        + f"\n\nSOUL:\n{soul_excerpt}"
    )
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions",
                headers={"Authorization": f"Bearer {_zhipu_key}"},
                json={
                    "model": "glm-4-flash",
                    "messages": [
                        {"role": "system", "content": "你只输出一句简短中文台词，不要标点过多。"},
                        {"role": "user", "content": prompt},
                    ],
                    "max_tokens": 60,
                },
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                data = await resp.json()
                if "choices" in data:
                    text = data["choices"][0].get("message", {}).get("content", "").strip()
                    text = text.replace("\n", "")[:40]
                    if text:
                        return text
    except Exception:
        pass
    return random.choice(pool)
