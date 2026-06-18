"""用户资产仓库与模拟交易 — 独立于系统 Agent 全局 state"""
from __future__ import annotations

import json
import random
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

import aiohttp
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

import life_db
from life_auth import resolve_account_id

CST = timezone(timedelta(hours=8))
SIM_TICK_INTERVAL_MS = 45_000
SYSTEM_AGENT_IDS = ["xau", "major", "altcoin", "newcoin", "momentum"]

router = APIRouter(prefix="/portfolio", tags=["portfolio"])

STRATEGY_PRESETS: dict[str, dict[str, Any]] = {
    "xau": {
        "label": "黄金趋势（同 XAU Agent）",
        "strategy": "趋势跟踪",
        "market": "XAUUSDT",
        "interval": "15m/1h",
        "risk": "中",
        "style": "trend",
        "symbols": ["XAUUSDT"],
        "threshold_pct": 0.35,
        "leverage": 3,
    },
    "major": {
        "label": "主流币趋势（同 Major Agent）",
        "strategy": "趋势+反转",
        "market": "BTC/ETH",
        "interval": "1h/4h",
        "risk": "中",
        "style": "trend",
        "symbols": ["BTCUSDT", "ETHUSDT"],
        "threshold_pct": 0.28,
        "leverage": 5,
    },
    "altcoin": {
        "label": "山寨波段（同 Altcoin Agent）",
        "strategy": "波段动量",
        "market": "Alt",
        "interval": "15m/1h",
        "risk": "中高",
        "style": "breakout",
        "symbols": ["SOLUSDT", "BNBUSDT", "DOGEUSDT"],
        "threshold_pct": 0.45,
        "leverage": 8,
    },
    "newcoin": {
        "label": "新币猎手（同 Newcoin Agent）",
        "strategy": "趋势突破",
        "market": "新币",
        "interval": "5m/15m",
        "risk": "高",
        "style": "breakout",
        "symbols": ["WIFUSDT", "PEPEUSDT", "SUIUSDT"],
        "threshold_pct": 0.55,
        "leverage": 10,
    },
    "momentum": {
        "label": "动量快打（同 Momentum Agent）",
        "strategy": "动量追踪",
        "market": "高波动",
        "interval": "5m/15m",
        "risk": "高",
        "style": "momentum",
        "symbols": ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
        "threshold_pct": 0.22,
        "leverage": 12,
    },
    "custom": {
        "label": "自定义策略",
        "strategy": "自定义",
        "market": "自选",
        "interval": "自定义",
        "risk": "中",
        "style": "custom",
        "symbols": ["BTCUSDT"],
        "threshold_pct": 0.3,
        "leverage": 5,
    },
}

RISK_MULT = {"低": 0.7, "中": 1.0, "中高": 1.15, "高": 1.35, "极高": 1.5}


def _now_ms() -> int:
    return int(time.time() * 1000)


def _now_iso() -> str:
    return datetime.now(CST).isoformat()


def _empty_state() -> dict:
    return {
        "positions": [],
        "trades_history": [],
        "wins": 0,
        "last_prices": {},
        "running": True,
    }


def _parse_state(raw: str) -> dict:
    try:
        st = json.loads(raw or "{}")
    except json.JSONDecodeError:
        st = {}
    base = _empty_state()
    base.update(st)
    base.setdefault("positions", [])
    base.setdefault("trades_history", [])
    base.setdefault("last_prices", {})
    return base


def preset_for(preset_id: str) -> dict:
    return dict(STRATEGY_PRESETS.get(preset_id) or STRATEGY_PRESETS["major"])


def apply_preset_to_meta(meta: dict, preset_id: str) -> dict:
    p = preset_for(preset_id)
    if preset_id != "custom":
        meta["strategyPreset"] = preset_id
        meta["strategy"] = p["strategy"]
        meta["market"] = p["market"]
        meta["interval"] = p["interval"]
        meta["risk"] = p["risk"]
    else:
        meta["strategyPreset"] = "custom"
    return meta


def init_agent_trading(user_id: str, agent_id: str, meta: dict, preset_id: str = "major") -> dict:
    portfolio = life_db.ensure_portfolio(user_id)
    existing = life_db.get_agent_trading(user_id, agent_id)
    if existing:
        return existing
    alloc = min(life_db.DEFAULT_AGENT_ALLOC_USDT, float(portfolio["cash"]))
    if alloc < 1000:
        alloc = 0.0
    if alloc > 0:
        life_db.adjust_portfolio_cash(user_id, -alloc)
    preset_id = preset_id if preset_id in STRATEGY_PRESETS else "major"
    life_db.save_agent_trading(
        user_id, agent_id,
        strategy_preset=preset_id,
        capital=alloc,
        initial_capital=alloc,
        state_json=json.dumps(_empty_state(), ensure_ascii=False),
    )
    apply_preset_to_meta(meta, preset_id)
    return life_db.get_agent_trading(user_id, agent_id) or {}


async def fetch_prices(symbols: list[str]) -> dict[str, float]:
    prices: dict[str, float] = {}
    if not symbols:
        return prices
    url = "https://fapi.binance.com/fapi/v1/ticker/price"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=8)) as resp:
                data = await resp.json()
                sym_set = set(symbols)
                for item in data:
                    sym = item.get("symbol", "")
                    if sym in sym_set:
                        prices[sym] = float(item["price"])
    except Exception:
        for sym in symbols:
            prices[sym] = float(random.uniform(100, 50000))
    return prices


def _position_size(capital: float, risk: str, leverage: int) -> float:
    mult = RISK_MULT.get(risk, 1.0)
    notional = capital * 0.08 * mult * min(leverage, 10)
    return max(50.0, min(notional, capital * 0.35))


def _maybe_open(
    state: dict, symbol: str, price: float, direction: str,
    capital: float, preset: dict, meta: dict,
) -> tuple[dict, float]:
    if any(p.get("symbol") == symbol for p in state["positions"]):
        return state, capital
    if len(state["positions"]) >= 2:
        return state, capital
    lev = int(preset.get("leverage", 5))
    qty = _position_size(capital, meta.get("risk", preset["risk"]), lev) / price
    margin = qty * price / lev
    if margin > capital * 0.4:
        return state, capital
    pos = {
        "symbol": symbol,
        "direction": direction,
        "entry_price": price,
        "quantity": round(qty, 6),
        "leverage": lev,
        "entry_type": preset.get("style", "sim"),
        "entry_reasoning": f"{preset['strategy']} 信号",
        "opened_at": _now_iso(),
    }
    state["positions"].append(pos)
    return state, capital - margin * 0.5


def _close_position(state: dict, idx: int, exit_price: float, reason: str) -> tuple[dict, float]:
    pos = state["positions"][idx]
    entry = float(pos["entry_price"])
    qty = float(pos["quantity"])
    lev = float(pos.get("leverage") or 5)
    direction = pos.get("direction", "LONG")
    if direction == "LONG":
        pnl_pct = (exit_price - entry) / entry * 100 * lev
        pnl_amount = (exit_price - entry) * qty * lev
    else:
        pnl_pct = (entry - exit_price) / entry * 100 * lev
        pnl_amount = (entry - exit_price) * qty * lev
    trade = {
        "symbol": pos["symbol"],
        "direction": direction,
        "entry_price": entry,
        "exit_price": exit_price,
        "quantity": qty,
        "leverage": lev,
        "pnl_pct": round(pnl_pct, 2),
        "pnl_amount": round(pnl_amount, 2),
        "reason": reason,
        "opened_at": pos.get("opened_at"),
        "closed_at": _now_iso(),
        "agent_type": "user_sim",
    }
    state["trades_history"].insert(0, trade)
    state["trades_history"] = state["trades_history"][:100]
    if pnl_amount > 0:
        state["wins"] = int(state.get("wins") or 0) + 1
    state["positions"].pop(idx)
    margin_return = qty * entry / lev * 0.5
    return state, pnl_amount + margin_return


def run_sim_tick(
    state: dict, capital: float, preset: dict, meta: dict, prices: dict[str, float],
) -> tuple[dict, float]:
    threshold = float(preset.get("threshold_pct", 0.3))
    risk = meta.get("risk", preset.get("risk", "中"))
    if preset.get("style") == "custom":
        threshold *= RISK_MULT.get(risk, 1.0)

    last_prices: dict[str, float] = dict(state.get("last_prices") or {})

    # 管理已有持仓
    i = 0
    while i < len(state["positions"]):
        pos = state["positions"][i]
        sym = pos["symbol"]
        price = prices.get(sym)
        if not price:
            i += 1
            continue
        entry = float(pos["entry_price"])
        lev = float(pos.get("leverage") or 5)
        if pos.get("direction") == "LONG":
            move = (price - entry) / entry * 100 * lev
        else:
            move = (entry - price) / entry * 100 * lev
        tp, sl = threshold * 1.8, -threshold * 1.2
        if move >= tp:
            state, delta = _close_position(state, i, price, "止盈")
            capital += delta
            continue
        if move <= sl:
            state, delta = _close_position(state, i, price, "止损")
            capital += delta
            continue
        i += 1

    # 开新仓
    for sym in preset.get("symbols") or ["BTCUSDT"]:
        price = prices.get(sym)
        if not price:
            continue
        prev = last_prices.get(sym)
        last_prices[sym] = price
        if not prev:
            continue
        chg = (price - prev) / prev * 100
        style = preset.get("style", "trend")
        if style == "momentum" and abs(chg) >= threshold * 0.6:
            direction = "LONG" if chg > 0 else "SHORT"
            state, capital = _maybe_open(state, sym, price, direction, capital, preset, meta)
        elif style in ("trend", "breakout") and abs(chg) >= threshold:
            direction = "LONG" if chg > 0 else "SHORT"
            if style == "breakout" and random.random() > 0.55:
                continue
            state, capital = _maybe_open(state, sym, price, direction, capital, preset, meta)
        elif style == "custom" and abs(chg) >= threshold * RISK_MULT.get(risk, 1.0):
            direction = "LONG" if chg > 0 else "SHORT"
            state, capital = _maybe_open(state, sym, price, direction, capital, preset, meta)

    state["last_prices"] = last_prices
    state["running"] = True
    return state, max(0.0, capital)


def agent_trading_view(row: dict, meta: dict) -> dict:
    st = _parse_state(row.get("state_json") or "{}")
    capital = float(row.get("capital") or 0)
    initial = float(row.get("initial_capital") or 0)
    trades = st.get("trades_history") or []
    wins = int(st.get("wins") or 0)
    preset = preset_for(row.get("strategy_preset") or "major")
    return {
        "id": row["agent_id"],
        "name": meta.get("name") or row["agent_id"],
        "strategy_preset": row.get("strategy_preset") or "major",
        "strategy": meta.get("strategy") or preset["strategy"],
        "market": meta.get("market") or preset["market"],
        "interval": meta.get("interval") or preset["interval"],
        "risk": meta.get("risk") or preset["risk"],
        "capital": round(capital, 2),
        "initial_capital": round(initial, 2),
        "pnl": round(capital - initial, 2),
        "pnl_pct": round((capital - initial) / initial * 100, 2) if initial else 0,
        "trades": len(trades),
        "wins": wins,
        "win_rate": round(wins / len(trades) * 100, 1) if trades else 0,
        "positions": st.get("positions") or [],
        "trades_history": trades[:30],
        "running": st.get("running", True),
        "is_circuit_break": False,
        "owner": "user",
    }


async def build_portfolio(user_id: str, *, run_tick: bool = True) -> dict:
    from life_game import load_user, save_user

    user = load_user(user_id)
    portfolio = life_db.ensure_portfolio(user_id)
    custom = user.get("custom_agents") or {}
    trading_agents = {
        aid: meta for aid, meta in custom.items()
        if meta.get("agentType", "trading") != "entertainment"
    }

    for aid, meta in trading_agents.items():
        if not life_db.get_agent_trading(user_id, aid):
            preset = meta.get("strategyPreset") or meta.get("strategy_preset") or "major"
            init_agent_trading(user_id, aid, meta, preset)
            user = load_user(user_id)
            custom = user.get("custom_agents") or {}

    now = _now_ms()
    last_tick = int(portfolio.get("last_sim_tick") or 0)
    should_tick = run_tick and (now - last_tick >= SIM_TICK_INTERVAL_MS)

    all_symbols: set[str] = set()
    rows = life_db.list_agent_trading(user_id)
    for row in rows:
        preset = preset_for(row.get("strategy_preset") or "major")
        all_symbols.update(preset.get("symbols") or [])

    prices = await fetch_prices(sorted(all_symbols)) if should_tick and all_symbols else {}

    agent_views = []
    total_agent_capital = 0.0
    total_agent_initial = 0.0
    total_trades = 0
    total_wins = 0

    for row in rows:
        aid = row["agent_id"]
        if aid not in trading_agents:
            continue
        meta = trading_agents[aid]
        capital = float(row.get("capital") or 0)
        if should_tick and prices:
            preset = preset_for(row.get("strategy_preset") or "major")
            if meta.get("strategyPreset") == "custom" or row.get("strategy_preset") == "custom":
                preset = dict(preset)
                preset["symbols"] = _custom_symbols(meta)
            st = _parse_state(row.get("state_json") or "{}")
            st, capital = run_sim_tick(st, capital, preset, meta, prices)
            life_db.save_agent_trading(
                user_id, aid,
                strategy_preset=row.get("strategy_preset") or "major",
                capital=capital,
                initial_capital=float(row.get("initial_capital") or 0),
                state_json=json.dumps(st, ensure_ascii=False),
            )
            row = life_db.get_agent_trading(user_id, aid) or row

        view = agent_trading_view(row, meta)
        agent_views.append(view)
        total_agent_capital += view["capital"]
        total_agent_initial += view["initial_capital"]
        total_trades += view["trades"]
        total_wins += view["wins"]

    if should_tick and rows:
        life_db.update_portfolio_tick(user_id, now)

    cash = float(portfolio.get("cash") or 0)
    initial = float(portfolio.get("initial_balance") or life_db.DEFAULT_PORTFOLIO_USDT)
    total_capital = cash + total_agent_capital
    total_pnl = total_capital - initial

    return {
        "ok": True,
        "cash": round(cash, 2),
        "initial_balance": round(initial, 2),
        "total_capital": round(total_capital, 2),
        "total_pnl": round(total_pnl, 2),
        "total_pnl_pct": round(total_pnl / initial * 100, 2) if initial else 0,
        "total_trades": total_trades,
        "total_wins": total_wins,
        "total_wr": round(total_wins / total_trades * 100, 1) if total_trades else 0,
        "agents": agent_views,
        "strategy_presets": [
            {"id": k, **{kk: vv for kk, vv in v.items() if kk != "symbols"}}
            for k, v in STRATEGY_PRESETS.items()
        ],
        "source": "user_sim",
        "system_agents_note": "大厅内系统 Agent 为全局示范盘，资产仓库仅统计你的模拟账户",
    }


def _custom_symbols(meta: dict) -> list[str]:
    market = (meta.get("market") or "BTC").upper()
    mapping = {
        "BTC": "BTCUSDT", "ETH": "ETHUSDT", "XAU": "XAUUSDT", "SOL": "SOLUSDT",
        "BTC/ETH": "BTCUSDT", "ALT": "SOLUSDT",
    }
    for k, v in mapping.items():
        if k in market:
            return [v]
    return ["BTCUSDT"]


def reset_user_portfolio(user_id: str) -> None:
    from life_game import load_user, save_user

    user = load_user(user_id)
    custom = user.get("custom_agents") or {}
    life_db.reset_portfolio(user_id)
    for aid, meta in custom.items():
        if meta.get("agentType", "trading") == "entertainment":
            continue
        preset = meta.get("strategyPreset") or "major"
        init_agent_trading(user_id, aid, meta, preset)
    save_user(user_id, user)


class StrategyBody(BaseModel):
    strategy_preset: str = "major"
    strategy: str = ""
    market: str = ""
    interval: str = ""
    risk: str = "中"


@router.get("")
async def get_portfolio(account_id: str = Depends(resolve_account_id)):
    from life_game import _validate_user_id

    uid = _validate_user_id(account_id)
    return await build_portfolio(uid, run_tick=True)


@router.get("/presets")
async def list_presets(account_id: str = Depends(resolve_account_id)):
    from life_game import _validate_user_id

    _validate_user_id(account_id)
    return {
        "ok": True,
        "presets": [
            {"id": k, **{kk: vv for kk, vv in v.items() if kk != "symbols"}}
            for k, v in STRATEGY_PRESETS.items()
        ],
        "system_agent_ids": SYSTEM_AGENT_IDS,
    }


@router.post("/reset")
async def reset_portfolio(account_id: str = Depends(resolve_account_id)):
    from life_game import _validate_user_id

    uid = _validate_user_id(account_id)
    reset_user_portfolio(uid)
    return await build_portfolio(uid, run_tick=False)


@router.post("/agents/{agent_id}/reset")
async def reset_agent(agent_id: str, account_id: str = Depends(resolve_account_id)):
    from life_game import load_user, save_user, _validate_user_id

    uid = _validate_user_id(account_id)
    user = load_user(uid)
    meta = user.get("custom_agents", {}).get(agent_id)
    if not meta:
        return {"ok": False, "error": "Agent 不存在"}
    row = life_db.get_agent_trading(uid, agent_id)
    if row:
        life_db.adjust_portfolio_cash(uid, float(row.get("capital") or 0))
        life_db.delete_agent_trading(uid, agent_id)
    preset = meta.get("strategyPreset") or "major"
    init_agent_trading(uid, agent_id, meta, preset)
    save_user(uid, user)
    return {"ok": True, "message": "已重置该 Agent 模拟盘", "portfolio": await build_portfolio(uid, run_tick=False)}


@router.put("/agents/{agent_id}/strategy")
async def update_strategy(agent_id: str, body: StrategyBody, account_id: str = Depends(resolve_account_id)):
    from life_game import load_user, save_user, _validate_user_id

    uid = _validate_user_id(account_id)
    user = load_user(uid)
    custom = user.get("custom_agents", {})
    if agent_id not in custom:
        return {"ok": False, "error": "Agent 不存在"}
    preset_id = body.strategy_preset if body.strategy_preset in STRATEGY_PRESETS else "custom"
    meta = custom[agent_id]
    meta["strategyPreset"] = preset_id
    if preset_id != "custom":
        apply_preset_to_meta(meta, preset_id)
    else:
        if body.strategy:
            meta["strategy"] = body.strategy
        if body.market:
            meta["market"] = body.market
        if body.interval:
            meta["interval"] = body.interval
        if body.risk:
            meta["risk"] = body.risk
    custom[agent_id] = meta
    save_user(uid, user)
    row = life_db.get_agent_trading(uid, agent_id)
    if row:
        life_db.save_agent_trading(
            uid, agent_id,
            strategy_preset=preset_id,
            capital=float(row.get("capital") or 0),
            initial_capital=float(row.get("initial_capital") or 0),
            state_json=row.get("state_json") or "{}",
        )
    return {"ok": True, "agent": meta, "portfolio": await build_portfolio(uid, run_tick=False)}
