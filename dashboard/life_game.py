"""
交易人生 — 积分、每日任务、商城、自定义 Agent（按 X-Life-User-Id 隔离）
数据存储：SQLite（life_db.py）
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Optional

import aiohttp
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import life_db
from life_auth import router as auth_router, resolve_account_id, ensure_admin_account
from life_engagement import social_router, pvp_router, season_router

# life_trading 在模块末尾注册，避免循环导入

CST = timezone(timedelta(hours=8))

STARTING_POINTS = life_db.STARTING_POINTS
MAX_ENTERTAINMENT_AGENTS = 1
MAX_TRADING_CUSTOM_AGENTS = 3
DAILY_TASK_DEFS = life_db.DAILY_TASK_DEFS

ACTIVITY_REWARDS = {"rest": 10, "dine": 15, "massage": 25, "poker": 0}
FACILITY_COSTS = {"rest": 0, "dine": 0, "massage": 0, "poker": 0}
DAILY_ALLOWANCE = 1000
LEISURE_TIER_COSTS = {
    "dine": {"a": 0, "b": 50, "c": 120},
    "massage": {"a": 0, "b": 80, "c": 150},
}
IDLE_POINTS_PER_AGENT_PER_MIN = 3
IDLE_MAX_AGENTS = 5
IDLE_MAX_ELAPSED_PER_TICK_MS = 60_000
IDLE_DAILY_MAX_MINUTES = 120

SHOP_CATALOG = [
    {"id": "color_aurora", "type": "color", "value": "#FF6B9D", "cost": 80, "label": "极光粉"},
    {"id": "color_midnight", "type": "color", "value": "#1E3A5F", "cost": 80, "label": "午夜蓝"},
    {"id": "color_mint", "type": "color", "value": "#2DD4BF", "cost": 80, "label": "薄荷绿"},
    {"id": "hat_beret_unlock", "type": "hat", "value": "beret", "cost": 120, "label": "贝雷帽款式"},
    {"id": "hat_top_unlock", "type": "hat", "value": "top", "cost": 150, "label": "礼帽款式"},
    {"id": "hat_bobble_unlock", "type": "hat", "value": "bobble", "cost": 100, "label": "毛球帽款式"},
    {"id": "zone_skin_hall_gold", "type": "zone_skin", "value": "hall:gold", "cost": 200, "label": "大厅 · 金色 lounge 皮肤包"},
    {"id": "zone_skin_restaurant_premium", "type": "zone_skin", "value": "restaurant:premium", "cost": 180, "label": "粤菜馆 · 尊享宴席皮肤包"},
    {"id": "zone_skin_restaurant_modern", "type": "zone_skin", "value": "restaurant:modern", "cost": 220, "label": "粤菜馆 · 现代简约皮肤包"},
    {"id": "zone_skin_spa_tropical", "type": "zone_skin", "value": "spa:tropical", "cost": 200, "label": "理疗馆 · 热带度假皮肤包"},
    {"id": "zone_skin_casino_neon", "type": "zone_skin", "value": "casino:neon", "cost": 250, "label": "德州厅 · 霓虹之夜皮肤包"},
    {"id": "zone_skin_hall_bamboo", "type": "zone_skin", "value": "hall:bamboo", "cost": 180, "label": "大厅 · 竹韵商务皮肤包"},
    {"id": "zone_skin_restaurant_garden", "type": "zone_skin", "value": "restaurant:garden", "cost": 200, "label": "粤菜馆 · 岭南茶室皮肤包"},
    {"id": "zone_skin_spa_zen_ink", "type": "zone_skin", "value": "spa:zen_ink", "cost": 220, "label": "理疗馆 · 水墨禅境皮肤包"},
    {"id": "zone_skin_casino_royal", "type": "zone_skin", "value": "casino:royal", "cost": 280, "label": "德州厅 · 皇家金銮皮肤包"},
    {"id": "zone_skin_reception_luxury", "type": "zone_skin", "value": "reception:luxury", "cost": 160, "label": "前厅 · 尊享接待皮肤包"},
    # 旧版 id 兼容 — 与新版皮肤包等价
    {"id": "skin_sofa_gold", "type": "zone_skin", "value": "hall:gold", "cost": 200, "label": "大厅 · 金色 lounge（旧版）", "legacy": True},
    {"id": "skin_table_premium", "type": "zone_skin", "value": "restaurant:premium", "cost": 180, "label": "粤菜馆 · 尊享宴席（旧版）", "legacy": True},
]

ZONE_SKIN_ZONES = ("hall", "restaurant", "spa", "casino", "reception")
ZONE_SKIN_DEFAULTS = {z: "default" for z in ZONE_SKIN_ZONES}
ZONE_SKIN_OPTIONS: dict[str, list[dict[str, Any]]] = {
    "hall": [
        {"id": "default", "label": "经典大厅", "free": True},
        {"id": "gold", "label": "金色 lounge", "shop_ids": ["zone_skin_hall_gold", "skin_sofa_gold"]},
        {"id": "bamboo", "label": "竹韵商务", "shop_ids": ["zone_skin_hall_bamboo"]},
    ],
    "restaurant": [
        {"id": "default", "label": "广式经典", "free": True},
        {"id": "premium", "label": "尊享宴席", "shop_ids": ["zone_skin_restaurant_premium", "skin_table_premium"]},
        {"id": "modern", "label": "现代简约", "shop_ids": ["zone_skin_restaurant_modern"]},
        {"id": "garden", "label": "岭南茶室", "shop_ids": ["zone_skin_restaurant_garden"]},
    ],
    "spa": [
        {"id": "default", "label": "禅意 lavender", "free": True},
        {"id": "tropical", "label": "热带度假", "shop_ids": ["zone_skin_spa_tropical"]},
        {"id": "zen_ink", "label": "水墨禅境", "shop_ids": ["zone_skin_spa_zen_ink"]},
    ],
    "casino": [
        {"id": "default", "label": "经典 VIP", "free": True},
        {"id": "neon", "label": "霓虹之夜", "shop_ids": ["zone_skin_casino_neon"]},
        {"id": "royal", "label": "皇家金銮", "shop_ids": ["zone_skin_casino_royal"]},
    ],
    "reception": [
        {"id": "default", "label": "经典前厅", "free": True},
        {"id": "luxury", "label": "尊享接待", "shop_ids": ["zone_skin_reception_luxury"]},
    ],
}

DEFAULT_FREE_UNLOCKS = life_db.DEFAULT_FREE_UNLOCKS

# 系统内置交易 Agent — 归属 admin，所有用户可见，仅 admin 可操作
SYSTEM_AGENT_IDS = ["xau", "major", "altcoin", "newcoin", "momentum"]
ADMIN_USERNAME = "admin"

router = APIRouter()
router.include_router(auth_router)
router.include_router(social_router)
router.include_router(pvp_router)
router.include_router(season_router)

_zhipu_key: str = ""


def init_life_game(data_dir: Path, zhipu_api_key: str = "") -> None:
    global _zhipu_key
    life_db.init_db(data_dir)
    ensure_admin_account()
    _zhipu_key = zhipu_api_key


def _today() -> str:
    return datetime.now(CST).strftime("%Y-%m-%d")


def _validate_user_id(user_id: str) -> str:
    uid = (user_id or "").strip()
    if not uid or len(uid) > 64:
        raise HTTPException(400, "Invalid account id")
    return uid


def load_user(account_id: str) -> dict:
    return life_db.load_user(account_id)


def save_user(account_id: str, data: dict) -> None:
    life_db.save_user_data(account_id, data)


def _earn(user: dict, amount: int, reason: str = "", account_id: str = "") -> int:
    amount = max(0, int(amount))
    user["points"] = max(0, user.get("points", 0) + amount)
    if account_id and amount > 0:
        life_db.add_season_points(account_id, points=amount)
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


FREE_APPEARANCE_COLORS = {
    "#FFD700", "#3B82F6", "#F59E0B", "#A855F7", "#EF4444",
    "#10B981", "#EC4899", "#06B6D4", "#6366F1", "#E67E22",
}
FREE_HAT_STYLES = {"beanie", "cap"}
HAT_UNLOCK_MAP = {
    "beret": "hat_beret_unlock",
    "top": "hat_top_unlock",
    "bobble": "hat_bobble_unlock",
}


def _parse_zone_skin_value(value: str) -> tuple[str, str] | None:
    if not value or ":" not in value:
        return None
    zone, skin_id = value.split(":", 1)
    if zone not in ZONE_SKIN_ZONES:
        return None
    if not any(o["id"] == skin_id for o in ZONE_SKIN_OPTIONS.get(zone, [])):
        return None
    return zone, skin_id


def _zone_skin_owned(user: dict, zone: str, skin_id: str) -> bool:
    opts = ZONE_SKIN_OPTIONS.get(zone, [])
    opt = next((o for o in opts if o["id"] == skin_id), None)
    if not opt:
        return False
    if opt.get("free"):
        return True
    unlocks = set(user.get("shop_unlocks", []))
    return any(sid in unlocks for sid in opt.get("shop_ids", []))


def _normalize_zone_skins(user: dict) -> dict[str, str]:
    stats = user.get("stats") or {}
    raw = stats.get("zone_skins") or {}
    out = dict(ZONE_SKIN_DEFAULTS)
    unlocks = user.get("shop_unlocks", [])
    for item in SHOP_CATALOG:
        if item.get("type") != "zone_skin" or item["id"] not in unlocks:
            continue
        parsed = _parse_zone_skin_value(item.get("value", ""))
        if parsed:
            out[parsed[0]] = parsed[1]
    for zone in ZONE_SKIN_ZONES:
        picked = raw.get(zone)
        if picked and _zone_skin_owned(user, zone, picked):
            out[zone] = picked
    return out


def _appearance_allowed(user: dict, headwear: str, hat_style: str, color: str) -> tuple[bool, str]:
    if headwear not in ("scarf", "hat"):
        return False, "无效的配饰类型"
    if hat_style not in ("beanie", "cap", "top", "bobble", "beret"):
        return False, "无效的帽子款式"
    if headwear == "scarf" and hat_style not in FREE_HAT_STYLES:
        hat_style = "beanie"
    if hat_style not in FREE_HAT_STYLES:
        unlock_id = HAT_UNLOCK_MAP.get(hat_style)
        if unlock_id and unlock_id not in user.get("shop_unlocks", []):
            return False, "该帽子款式尚未解锁，请先在积分商城购买"
    if color not in FREE_APPEARANCE_COLORS:
        ok = any(
            i.get("type") == "color" and i.get("value") == color and i.get("id") in user.get("shop_unlocks", [])
            for i in SHOP_CATALOG
        )
        if not ok:
            return False, "该颜色尚未解锁，请先在积分商城购买"
    return True, ""


def _permissions_for(account_id: str, user: dict) -> dict:
    acc = life_db.get_account_by_id(account_id) if account_id else None
    is_admin = bool(acc and str(acc.get("username", "")).lower() == ADMIN_USERNAME)
    custom_ids = list((user.get("custom_agents") or {}).keys())
    operable = list(custom_ids)
    if is_admin:
        operable = list(dict.fromkeys(SYSTEM_AGENT_IDS + custom_ids))
    return {
        "is_admin": is_admin,
        "operable_agent_ids": operable,
        "system_agent_ids": SYSTEM_AGENT_IDS,
    }


def _public_state(user: dict, account_id: str = "") -> dict:
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
        "leisure_tier_costs": LEISURE_TIER_COSTS,
        "daily_allowance": {
            "amount": DAILY_ALLOWANCE,
            "claimed_today": user.get("stats", {}).get("daily_allowance_date") == _today(),
        },
        "limits": {
            "max_entertainment": MAX_ENTERTAINMENT_AGENTS,
            "max_trading_custom": MAX_TRADING_CUSTOM_AGENTS,
        },
        "idle_limits": {
            "daily_max_minutes": IDLE_DAILY_MAX_MINUTES,
            "points_per_agent_per_min": IDLE_POINTS_PER_AGENT_PER_MIN,
            "max_agents": IDLE_MAX_AGENTS,
        },
        "stats": user.get("stats", {}),
        "zone_skins": _normalize_zone_skins(user),
        "zone_skin_catalog": ZONE_SKIN_OPTIONS,
        "permissions": _permissions_for(account_id, user),
    }


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
    user_initiated: bool = False


class DispatchBody(BaseModel):
    action: str
    cost: Optional[int] = None


class ShopBuyBody(BaseModel):
    item_id: str


class ZoneSkinBody(BaseModel):
    zone: str
    skin_id: str = Field(alias="skinId")

    model_config = {"populate_by_name": True}


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
    strategyPreset: str = "major"


class AgentSoulBody(BaseModel):
    content: str


class AgentAppearanceBody(BaseModel):
    headwear: str = "scarf"
    hatStyle: str = "beanie"
    color: str = "#FFD700"


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


class SeatClaimBody(BaseModel):
    seat_id: str
    agent_id: str
    activity: str = ""
    until_ts: int = 0


class SeatReleaseBody(BaseModel):
    seat_id: str
    agent_id: str


@router.get("/state")
async def life_state(account_id: str = Depends(resolve_account_id)):
    uid = _validate_user_id(account_id)
    user = load_user(uid)
    save_user(uid, user)
    return _public_state(user, uid)


@router.post("/migrate")
async def life_migrate(body: MigrateBody, account_id: str = Depends(resolve_account_id)):
    uid = _validate_user_id(account_id)
    life_db.migrate_user(uid, body.points, body.last_idle_tick, body.custom_agents, body.shop_unlocks)
    user = load_user(uid)
    return {"ok": True, **_public_state(user, uid)}


@router.post("/points/spend")
async def life_spend(body: SpendBody, account_id: str = Depends(resolve_account_id)):
    uid = _validate_user_id(account_id)
    user = load_user(uid)
    if not _spend(user, body.amount):
        save_user(uid, user)
        return {"ok": False, "balance": user["points"], "error": "insufficient"}
    save_user(uid, user)
    return {"ok": True, "balance": user["points"], "reason": body.reason}


@router.post("/points/daily-claim")
async def life_daily_claim(account_id: str = Depends(resolve_account_id)):
    """每日免费领取积分（默认 1000）"""
    uid = _validate_user_id(account_id)
    user = load_user(uid)
    today = _today()
    stats = user.setdefault("stats", {})
    if stats.get("daily_allowance_date") == today:
        return {"ok": False, "balance": user["points"], "error": "already_claimed", "amount": DAILY_ALLOWANCE}
    stats["daily_allowance_date"] = today
    balance = _earn(user, DAILY_ALLOWANCE, account_id=uid)
    save_user(uid, user)
    return {"ok": True, "balance": balance, "amount": DAILY_ALLOWANCE}


@router.post("/points/earn")
async def life_earn(body: EarnBody, account_id: str = Depends(resolve_account_id)):
    uid = _validate_user_id(account_id)
    user = load_user(uid)
    cap = 500
    amount = min(max(0, body.amount), cap)
    balance = _earn(user, amount, body.reason, uid)
    save_user(uid, user)
    return {"ok": True, "balance": balance, "earned": amount}


@router.post("/points/idle")
async def life_idle(body: IdleBody, account_id: str = Depends(resolve_account_id)):
    uid = _validate_user_id(account_id)
    user = load_user(uid)
    now_ms = int(datetime.now(CST).timestamp() * 1000)
    last = user.get("last_idle_tick") or now_ms
    if last > now_ms:
        last = now_ms
    # 不信任客户端 elapsed_ms，仅用服务端时间差；单次最多结算 1 分钟
    elapsed = min(max(0, now_ms - last), IDLE_MAX_ELAPSED_PER_TICK_MS)
    if elapsed < 60_000:
        return {"ok": True, "balance": user["points"], "earned": 0}
    minutes = elapsed // 60_000
    stats = user.setdefault("stats", {})
    idle_minutes_today = stats.get("idle_minutes_today", 0)
    remaining = max(0, IDLE_DAILY_MAX_MINUTES - idle_minutes_today)
    if remaining <= 0:
        user["last_idle_tick"] = now_ms
        save_user(uid, user)
        return {"ok": True, "balance": user["points"], "earned": 0, "daily_cap": True}
    minutes = min(minutes, remaining)
    owned_count = len(user.get("custom_agents") or {})
    agents = min(max(0, owned_count), IDLE_MAX_AGENTS)
    earned = minutes * agents * IDLE_POINTS_PER_AGENT_PER_MIN
    balance = _earn(user, earned, account_id=uid)
    user["last_idle_tick"] = now_ms
    stats["idle_ms_today"] = stats.get("idle_ms_today", 0) + minutes * 60_000
    stats["idle_minutes_today"] = idle_minutes_today + minutes
    dt = user.setdefault("daily_tasks", {})
    idle_task = dt.get("idle_30", {"progress": 0, "claimed": False})
    idle_task["progress"] = min(30, idle_task.get("progress", 0) + minutes)
    dt["idle_30"] = idle_task
    save_user(uid, user)
    return {
        "ok": True, "balance": balance, "earned": earned,
        "idle_minutes_today": stats["idle_minutes_today"],
        "agent_count": agents, "owned_agent_count": owned_count,
    }


@router.post("/session/start")
async def life_session_start(account_id: str = Depends(resolve_account_id)):
    """页面打开时调用：重置挂机计时，离线期间不计入挂机。"""
    uid = _validate_user_id(account_id)
    life_db.reset_session_idle(uid)
    user = load_user(uid)
    return {"ok": True, "balance": user["points"]}


@router.post("/activity/complete")
async def life_activity_complete(body: ActivityBody, account_id: str = Depends(resolve_account_id)):
    uid = _validate_user_id(account_id)
    user = load_user(uid)
    if not body.user_initiated:
        return {"ok": True, "balance": user["points"], "earned": 0}
    reward = ACTIVITY_REWARDS.get(body.activity, 0)
    balance = _earn(user, reward, account_id=uid)
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
async def life_dispatch(body: DispatchBody, account_id: str = Depends(resolve_account_id)):
    uid = _validate_user_id(account_id)
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
async def life_claim_task(body: TaskClaimBody, account_id: str = Depends(resolve_account_id)):
    uid = _validate_user_id(account_id)
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
    balance = _earn(user, tdef["reward"], account_id=uid)
    save_user(uid, user)
    return {"ok": True, "balance": balance, "reward": tdef["reward"]}


@router.post("/shop/buy")
async def life_shop_buy(body: ShopBuyBody, account_id: str = Depends(resolve_account_id)):
    uid = _validate_user_id(account_id)
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
    if item.get("type") == "zone_skin":
        parsed = _parse_zone_skin_value(item.get("value", ""))
        if parsed:
            zone, skin_id = parsed
            stats = user.setdefault("stats", {})
            zone_skins = stats.setdefault("zone_skins", {})
            zone_skins[zone] = skin_id
            stats["zone_skins"] = zone_skins
    save_user(uid, user)
    return {"ok": True, "balance": user["points"], "item": item, "state": _public_state(user, uid)}


@router.put("/zone-skins")
async def life_set_zone_skin(body: ZoneSkinBody, account_id: str = Depends(resolve_account_id)):
    uid = _validate_user_id(account_id)
    zone = (body.zone or "").strip()
    skin_id = (body.skin_id or "").strip()
    if zone not in ZONE_SKIN_ZONES:
        raise HTTPException(400, "无效的区域")
    if not any(o["id"] == skin_id for o in ZONE_SKIN_OPTIONS.get(zone, [])):
        raise HTTPException(400, "无效的皮肤")
    user = load_user(uid)
    if not _zone_skin_owned(user, zone, skin_id):
        return {"ok": False, "error": "该皮肤尚未解锁，请先在积分商城购买"}
    stats = user.setdefault("stats", {})
    zone_skins = stats.setdefault("zone_skins", {})
    zone_skins[zone] = skin_id
    stats["zone_skins"] = zone_skins
    save_user(uid, user)
    return {"ok": True, "zone_skins": _normalize_zone_skins(user), "state": _public_state(user, uid)}


@router.post("/agents")
async def life_create_agent(body: CustomAgentBody, account_id: str = Depends(resolve_account_id)):
    uid = _validate_user_id(account_id)
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
        "strategyPreset": body.strategyPreset if agent_type == "trading" else "",
    }
    custom[aid] = meta
    save_user(uid, user)
    if agent_type == "trading":
        from life_trading import init_agent_trading, apply_preset_to_meta
        preset = body.strategyPreset if body.strategyPreset in ("xau", "major", "altcoin", "newcoin", "momentum", "custom") else "major"
        apply_preset_to_meta(meta, preset)
        custom[aid] = meta
        save_user(uid, user)
        init_agent_trading(uid, aid, meta, preset)
    return {"ok": True, "agent": meta, "state": _public_state(user, uid)}


@router.put("/agents/{agent_id}/soul")
async def life_update_soul(agent_id: str, body: AgentSoulBody, account_id: str = Depends(resolve_account_id)):
    uid = _validate_user_id(account_id)
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


@router.put("/agents/{agent_id}/appearance")
async def life_update_appearance(agent_id: str, body: AgentAppearanceBody, account_id: str = Depends(resolve_account_id)):
    uid = _validate_user_id(account_id)
    user = load_user(uid)
    custom = user.get("custom_agents", {})
    if agent_id not in custom:
        raise HTTPException(404, "Agent not found")
    ok, err = _appearance_allowed(user, body.headwear, body.hatStyle, body.color)
    if not ok:
        return {"ok": False, "error": err}
    meta = custom[agent_id]
    meta["headwear"] = body.headwear
    meta["hatStyle"] = body.hatStyle if body.headwear == "hat" else meta.get("hatStyle", "beanie")
    meta["color"] = body.color
    custom[agent_id] = meta
    save_user(uid, user)
    return {"ok": True, "message": "外形已保存", "agent": meta}


@router.post("/agent-speak")
async def life_agent_speak(body: AgentSpeakBody, account_id: str = Depends(resolve_account_id)):
    _validate_user_id(account_id)
    line = await _generate_speak_line(body)
    return {"ok": True, "line": line}


@router.get("/seats")
async def life_get_seats():
    return {"ok": True, "seats": life_db.get_all_seats()}


@router.post("/seats/claim")
async def life_claim_seat(body: SeatClaimBody, account_id: str = Depends(resolve_account_id)):
    uid = _validate_user_id(account_id)
    return life_db.claim_seat(body.seat_id, uid, body.agent_id, body.activity, body.until_ts)


@router.post("/seats/release")
async def life_release_seat(body: SeatReleaseBody, account_id: str = Depends(resolve_account_id)):
    _validate_user_id(account_id)
    return life_db.release_seat(body.seat_id, body.agent_id)


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


from life_trading import router as portfolio_router  # noqa: E402

router.include_router(portfolio_router)
