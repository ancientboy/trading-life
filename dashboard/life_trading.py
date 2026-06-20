"""用户资产仓库与模拟交易 — 独立于系统 Agent 全局 state"""
from __future__ import annotations

import asyncio
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

VALID_KLINE_INTERVALS = frozenset({
    "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d",
})
FILTER_BUMP = {"1m": "5m", "3m": "15m", "5m": "15m", "15m": "1h", "30m": "1h", "1h": "4h", "2h": "4h", "4h": "1d"}
BINANCE_KLINE_URL = "https://fapi.binance.com/fapi/v1/klines"


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


def parse_kline_intervals(interval_str: str, preset: dict) -> tuple[str, str]:
    """解析用户/预设周期，如 15m/1h → (入场周期, 过滤周期)。"""
    raw = (interval_str or preset.get("interval") or "15m/1h").strip().lower()
    parts = [p.strip() for p in raw.replace(" ", "").split("/") if p.strip()]
    parts = [p if p in VALID_KLINE_INTERVALS else "15m" for p in parts]
    if len(parts) >= 2:
        return parts[0], parts[1]
    if len(parts) == 1:
        return parts[0], FILTER_BUMP.get(parts[0], "1h")
    return "15m", "1h"


def calc_ema(values: list[float], period: int) -> float:
    if len(values) < period:
        return values[-1] if values else 0.0
    k = 2 / (period + 1)
    ema = sum(values[:period]) / period
    for v in values[period:]:
        ema = v * k + ema * (1 - k)
    return ema


def calc_rsi(closes: list[float], period: int = 14) -> float:
    if len(closes) < period + 1:
        return 50.0
    gains, losses = [], []
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        gains.append(max(0.0, d))
        losses.append(max(0.0, -d))
    ag = sum(gains[:period]) / period
    al = sum(losses[:period]) / period
    for i in range(period, len(gains)):
        ag = (ag * (period - 1) + gains[i]) / period
        al = (al * (period - 1) + losses[i]) / period
    if al == 0:
        return 100.0
    return 100.0 - 100.0 / (1.0 + ag / al)


async def fetch_klines(session: aiohttp.ClientSession, symbol: str, interval: str, limit: int = 80) -> list[float]:
    candles = await fetch_klines_ohlc(session, symbol, interval, limit)
    return [c["close"] for c in candles]


async def fetch_klines_ohlc(
    session: aiohttp.ClientSession, symbol: str, interval: str, limit: int = 80,
) -> list[dict[str, float]]:
    params = {"symbol": symbol, "interval": interval, "limit": limit}
    try:
        async with session.get(BINANCE_KLINE_URL, params=params, timeout=aiohttp.ClientTimeout(total=8)) as resp:
            raw = await resp.json()
            out: list[dict[str, float]] = []
            for k in raw:
                out.append({
                    "time": int(k[0]) // 1000,
                    "open": float(k[1]),
                    "high": float(k[2]),
                    "low": float(k[3]),
                    "close": float(k[4]),
                })
            return out
    except Exception:
        return []


async def fetch_kline_map(requests: set[tuple[str, str]]) -> dict[tuple[str, str], list[float]]:
    """批量拉取 K 线收盘价，key=(symbol, interval)。"""
    out: dict[tuple[str, str], list[float]] = {}
    if not requests:
        return out
    keys = list(requests)
    async with aiohttp.ClientSession() as session:
        results = await asyncio.gather(
            *(fetch_klines(session, sym, iv) for sym, iv in keys),
            return_exceptions=True,
        )
        for key, res in zip(keys, results):
            out[key] = res if isinstance(res, list) else []
    return out


def _signal_trend(closes_e: list[float], closes_f: list[float]) -> Optional[str]:
    if len(closes_f) < 50 or len(closes_e) < 25:
        return None
    ema20_f, ema50_f = calc_ema(closes_f, 20), calc_ema(closes_f, 50)
    ema20_e = calc_ema(closes_e, 20)
    price, prev = closes_e[-1], closes_e[-2]
    rsi = calc_rsi(closes_e)
    if ema20_f > ema50_f and price > ema20_e and prev <= ema20_e and rsi < 72:
        return "LONG"
    if ema20_f < ema50_f and price < ema20_e and prev >= ema20_e and rsi > 28:
        return "SHORT"
    return None


def _signal_momentum(closes_e: list[float], threshold_pct: float) -> Optional[str]:
    if len(closes_e) < 12:
        return None
    chg = (closes_e[-1] - closes_e[-5]) / closes_e[-5] * 100
    rsi = calc_rsi(closes_e)
    if chg >= threshold_pct * 0.55 and rsi < 78:
        return "LONG"
    if chg <= -threshold_pct * 0.55 and rsi > 22:
        return "SHORT"
    return None


def _signal_breakout(closes_e: list[float], closes_f: list[float], threshold_pct: float) -> Optional[str]:
    if len(closes_e) < 22:
        return None
    window = closes_e[-21:-1]
    high20, low20 = max(window), min(window)
    price = closes_e[-1]
    trend_up = calc_ema(closes_f, 20) > calc_ema(closes_f, 50) if len(closes_f) >= 50 else True
    if price > high20 * (1 + threshold_pct / 500) and trend_up:
        return "LONG"
    if price < low20 * (1 - threshold_pct / 500) and not trend_up:
        return "SHORT"
    return None


def evaluate_entry_signal(
    style: str,
    closes_e: list[float],
    closes_f: list[float],
    threshold_pct: float,
    risk: str,
) -> tuple[Optional[str], str]:
    """根据策略风格与 K 线数据评估开仓方向，返回 (方向, 原因)。"""
    th = threshold_pct * RISK_MULT.get(risk, 1.0)
    if style == "momentum":
        sig = _signal_momentum(closes_e, th)
        return sig, f"动量 {th:.2f}% 阈值"
    if style == "breakout":
        sig = _signal_breakout(closes_e, closes_f, th)
        return sig, "结构突破"
    sig = _signal_trend(closes_e, closes_f)
    if sig:
        return sig, "EMA 趋势回调"
    if style == "custom":
        sig = _signal_momentum(closes_e, th * 0.8) or _signal_trend(closes_e, closes_f)
        return sig, "自定义综合"
    return None, ""


def _position_size(capital: float, risk: str, leverage: int) -> float:
    mult = RISK_MULT.get(risk, 1.0)
    notional = capital * 0.08 * mult * min(leverage, 10)
    return max(50.0, min(notional, capital * 0.35))


def _maybe_open(
    state: dict, symbol: str, price: float, direction: str,
    capital: float, preset: dict, meta: dict,
    signal_reason: str = "",
    interval_label: str = "",
) -> tuple[dict, float]:
    if any(p.get("symbol") == symbol for p in state["positions"]):
        return state, capital
    max_pos = int(preset.get("max_positions") or meta.get("max_positions") or 2)
    if len(state["positions"]) >= max_pos:
        return state, capital
    lev = int(preset.get("leverage") or meta.get("leverage") or 5)
    qty = _position_size(capital, meta.get("risk", preset["risk"]), lev) / price
    margin = qty * price / lev
    if margin > capital * 0.4:
        return state, capital
    reason_parts = [preset.get("strategy", "策略"), interval_label or meta.get("interval", "")]
    if signal_reason:
        reason_parts.append(signal_reason)
    pos = {
        "symbol": symbol,
        "direction": direction,
        "entry_price": price,
        "quantity": round(qty, 6),
        "leverage": lev,
        "entry_type": preset.get("style", "sim"),
        "entry_reasoning": " · ".join(p for p in reason_parts if p),
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
    state: dict,
    capital: float,
    preset: dict,
    meta: dict,
    prices: dict[str, float],
    klines: Optional[dict[tuple[str, str], list[float]]] = None,
    *,
    bootstrap: bool = False,
    bootstrap_direction: Optional[str] = None,
) -> tuple[dict, float]:
    threshold = float(preset.get("threshold_pct", 0.3))
    risk = meta.get("risk", preset.get("risk", "中"))
    style = preset.get("style", "trend")
    entry_iv, filter_iv = parse_kline_intervals(meta.get("interval", ""), preset)
    interval_label = f"{entry_iv}/{filter_iv}"

    # 管理已有持仓（实时价止盈止损）
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

    # 开新仓 — 优先 K 线策略信号，无 K 线时回退到 tick 价差
    last_prices: dict[str, float] = dict(state.get("last_prices") or {})

    if bootstrap and not state["positions"] and not state.get("trades_history"):
        sym = (preset.get("symbols") or ["BTCUSDT"])[0]
        price = prices.get(sym)
        if price:
            closes_e = (klines or {}).get((sym, entry_iv), [])
            direction = bootstrap_direction
            if not direction:
                if len(closes_e) >= 4:
                    chg = (closes_e[-1] - closes_e[-3]) / closes_e[-3] * 100
                    direction = "LONG" if chg >= 0 else "SHORT"
                else:
                    prev = last_prices.get(sym)
                    if prev:
                        direction = "LONG" if price >= prev else "SHORT"
                    else:
                        direction = "LONG"
            th_boost = preset.copy()
            th_boost["threshold_pct"] = max(0.08, threshold * 0.45)
            state, capital = _maybe_open(
                state, sym, price, direction, capital, th_boost, meta,
                "首笔体验加权", interval_label,
            )
            last_prices[sym] = price
            state["last_prices"] = last_prices
            state["running"] = True
            return state, max(0.0, capital)

    for sym in preset.get("symbols") or ["BTCUSDT"]:
        price = prices.get(sym)
        if not price:
            continue
        closes_e = (klines or {}).get((sym, entry_iv), [])
        closes_f = (klines or {}).get((sym, filter_iv), [])
        direction: Optional[str] = None
        signal_reason = ""

        if closes_e and len(closes_e) >= 12:
            direction, signal_reason = evaluate_entry_signal(style, closes_e, closes_f, threshold, risk)
        else:
            prev = last_prices.get(sym)
            last_prices[sym] = price
            if prev:
                chg = (price - prev) / prev * 100
                th = threshold * RISK_MULT.get(risk, 1.0)
                if style == "momentum" and abs(chg) >= th * 0.6:
                    direction = "LONG" if chg > 0 else "SHORT"
                    signal_reason = "tick 动量"
                elif abs(chg) >= th:
                    direction = "LONG" if chg > 0 else "SHORT"
                    signal_reason = "tick 突破"

        if direction:
            state, capital = _maybe_open(
                state, sym, price, direction, capital, preset, meta,
                signal_reason, interval_label,
            )
        last_prices[sym] = price

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
    eff = effective_preset(row.get("strategy_preset") or meta.get("strategyPreset") or "major", meta)
    return {
        "id": row["agent_id"],
        "name": meta.get("name") or row["agent_id"],
        "strategy_preset": row.get("strategy_preset") or "major",
        "strategy": meta.get("strategy") or preset["strategy"],
        "market": meta.get("market") or preset["market"],
        "interval": meta.get("interval") or preset["interval"],
        "risk": meta.get("risk") or preset["risk"],
        "leverage": eff.get("leverage"),
        "threshold_pct": eff.get("threshold_pct"),
        "soul_bias_tags": eff.get("soul_bias_tags") or [],
        "max_positions": eff.get("max_positions", 2),
        "strategy_snapshot": meta.get("strategySnapshot"),
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


def _record_new_closed_trades(user_id: str, before: dict, after: dict) -> None:
    before_keys = {
        f"{t.get('closed_at')}:{t.get('symbol')}:{t.get('pnl_amount')}"
        for t in (before.get("trades_history") or [])
    }
    for t in after.get("trades_history") or []:
        key = f"{t.get('closed_at')}:{t.get('symbol')}:{t.get('pnl_amount')}"
        if key in before_keys:
            continue
        pnl = float(t.get("pnl_amount") or 0)
        life_db.record_weekly_trading(user_id, pnl_amount=pnl, won=pnl > 0)


def detect_agent_duels(agent_views: list[dict]) -> list[dict]:
    duels: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    for i, a in enumerate(agent_views):
        for b in agent_views[i + 1:]:
            for pa in a.get("positions") or []:
                for pb in b.get("positions") or []:
                    if pa.get("symbol") != pb.get("symbol"):
                        continue
                    if pa.get("direction") == pb.get("direction"):
                        continue
                    key = (a["id"], b["id"], pa["symbol"])
                    if key in seen:
                        continue
                    seen.add(key)
                    duels.append({
                        "symbol": pa["symbol"],
                        "agent_a_id": a["id"],
                        "agent_a_name": a["name"],
                        "agent_a_direction": pa["direction"],
                        "agent_a_pnl": a["pnl"],
                        "agent_b_id": b["id"],
                        "agent_b_name": b["name"],
                        "agent_b_direction": pb["direction"],
                        "agent_b_pnl": b["pnl"],
                    })
    return duels


def sync_sibling_hedge(
    user_id: str,
    rows: list,
    trading_agents: dict,
    prices: dict[str, float],
) -> Optional[str]:
    """A 开多 → B 自动开空，制造可观看的对决。"""
    opener: Optional[tuple[str, dict, dict]] = None
    for row in rows:
        aid = row["agent_id"]
        if aid not in trading_agents:
            continue
        st = _parse_state(row.get("state_json") or "{}")
        for pos in st.get("positions") or []:
            opener = (aid, row, pos)
            break
        if opener:
            break
    if not opener:
        return None
    opener_aid, opener_row, opener_pos = opener
    sym = opener_pos["symbol"]
    opp_dir = "SHORT" if opener_pos.get("direction") == "LONG" else "LONG"
    opener_name = trading_agents[opener_aid].get("name") or opener_aid

    for row in rows:
        aid = row["agent_id"]
        if aid == opener_aid or aid not in trading_agents:
            continue
        st = _parse_state(row.get("state_json") or "{}")
        if any(p.get("symbol") == sym for p in st.get("positions") or []):
            continue
        meta = trading_agents[aid]
        preset_id = row.get("strategy_preset") or meta.get("strategyPreset") or "major"
        eff = effective_preset(preset_id, meta)
        capital = float(row.get("capital") or 0)
        price = prices.get(sym)
        if not price:
            continue
        st, capital = _maybe_open(
            st, sym, price, opp_dir, capital, eff, meta, signal_reason="跟单对冲",
        )
        life_db.save_agent_trading(
            user_id, aid,
            strategy_preset=row.get("strategy_preset") or "major",
            capital=capital,
            initial_capital=float(row.get("initial_capital") or 0),
            state_json=json.dumps(st, ensure_ascii=False),
        )
        hedger_name = meta.get("name") or aid
        label = sym.replace("USDT", "")
        return (
            f"⚔️ 交易员对决 · {opener_name} {opener_pos.get('direction')} "
            f"vs {hedger_name} {opp_dir} @ {label}"
        )
    return None


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
    bootstrap = life_db.should_bootstrap_trading(user_id)
    should_tick = run_tick and (bootstrap or (now - last_tick >= SIM_TICK_INTERVAL_MS))

    all_symbols: set[str] = set()
    rows = life_db.list_agent_trading(user_id)
    for row in rows:
        preset = preset_for(row.get("strategy_preset") or "major")
        meta_ref = trading_agents.get(row["agent_id"], {})
        eff = effective_preset(row.get("strategy_preset") or "major", meta_ref)
        all_symbols.update(eff.get("symbols") or [])

    if bootstrap:
        all_symbols.add("BTCUSDT")

    prices: dict[str, float] = {}
    if should_tick and all_symbols:
        prices = await fetch_prices(sorted(all_symbols))

    kline_requests: set[tuple[str, str]] = set()
    if should_tick:
        for row in rows:
            aid = row["agent_id"]
            if aid not in trading_agents:
                continue
            meta = trading_agents[aid]
            preset_id = row.get("strategy_preset") or meta.get("strategyPreset") or "major"
            eff = effective_preset(preset_id, meta)
            entry_iv, filter_iv = parse_kline_intervals(meta.get("interval", ""), eff)
            for sym in eff.get("symbols") or []:
                kline_requests.add((sym, entry_iv))
                kline_requests.add((sym, filter_iv))
        if bootstrap:
            kline_requests.add(("BTCUSDT", "15m"))
    klines = await fetch_kline_map(kline_requests) if kline_requests else {}

    agent_views = []
    total_agent_capital = 0.0
    total_agent_initial = 0.0
    total_trades = 0
    total_wins = 0
    prev_wins = 0
    for row in rows:
        if row["agent_id"] not in trading_agents:
            continue
        st0 = _parse_state(row.get("state_json") or "{}")
        prev_wins += int(st0.get("wins") or 0)

    first_trading_win = False
    first_trade_hook = False
    latest_win_trade: Optional[dict] = None
    trading_banter: Optional[str] = None

    trading_ids = [r["agent_id"] for r in rows if r["agent_id"] in trading_agents]
    hedge_opposite: Optional[str] = None
    bootstrap_slot = 0

    for row in rows:
        aid = row["agent_id"]
        if aid not in trading_agents:
            continue
        meta = trading_agents[aid]
        preset_id = row.get("strategy_preset") or meta.get("strategyPreset") or "major"
        eff = effective_preset(preset_id, meta)
        capital = float(row.get("capital") or 0)
        if should_tick and prices:
            st_before = _parse_state(row.get("state_json") or "{}")
            prev_pos = len(st_before.get("positions") or [])
            prev_hist = len(st_before.get("trades_history") or [])
            do_boot = (
                bootstrap
                and bootstrap_slot < min(2, len(trading_ids))
                and aid == trading_ids[bootstrap_slot]
                and prev_pos == 0
                and prev_hist == 0
            )
            boot_dir = hedge_opposite if do_boot and bootstrap_slot == 1 else None
            st, capital = run_sim_tick(
                st_before, capital, eff, meta, prices, klines,
                bootstrap=do_boot,
                bootstrap_direction=boot_dir,
            )
            _record_new_closed_trades(user_id, st_before, st)
            if do_boot and (len(st.get("positions") or []) > prev_pos or len(st.get("trades_history") or []) > prev_hist):
                first_trade_hook = True
                if st.get("positions"):
                    pos0 = st["positions"][0]
                    hedge_opposite = "SHORT" if pos0.get("direction") == "LONG" else "LONG"
                bootstrap_slot += 1
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

    if should_tick and prices and len(trading_ids) >= 2 and not bootstrap:
        hedge_msg = sync_sibling_hedge(user_id, life_db.list_agent_trading(user_id), trading_agents, prices)
        if hedge_msg:
            trading_banter = hedge_msg
            rows = life_db.list_agent_trading(user_id)
            agent_views = []
            total_agent_capital = 0.0
            total_agent_initial = 0.0
            total_trades = 0
            total_wins = 0
            for row in rows:
                aid = row["agent_id"]
                if aid not in trading_agents:
                    continue
                view = agent_trading_view(row, trading_agents[aid])
                agent_views.append(view)
                total_agent_capital += view["capital"]
                total_agent_initial += view["initial_capital"]
                total_trades += view["trades"]
                total_wins += view["wins"]

    if first_trade_hook:
        life_db.mark_trading_bootstrap_done(user_id)

    if should_tick and rows:
        life_db.update_portfolio_tick(user_id, now)

    agent_duels = detect_agent_duels(agent_views)

    new_wins = total_wins
    if should_tick and new_wins > prev_wins:
        win_meta = life_db.record_trading_win_meta(user_id, profitable=True)
        if win_meta.get("first_win"):
            first_trading_win = True
        for view in agent_views:
            for t in view.get("trades_history") or []:
                if float(t.get("pnl_amount") or 0) > 0:
                    latest_win_trade = {
                        **t,
                        "agent_id": view["id"],
                        "agent_name": view["name"],
                    }
                    break
            if latest_win_trade:
                break
        if len(agent_views) >= 2 and latest_win_trade and not trading_banter:
            a, b = agent_views[0], agent_views[1]
            sym = latest_win_trade.get("symbol", "BTC")
            pnl = float(latest_win_trade.get("pnl_amount") or 0)
            trading_banter = (
                f"📈 {a['name']} 止盈 {sym} +${pnl:.0f} · "
                f"{b['name']}：收到，我在盯 {sym} 下一波"
            )

    if agent_duels and not trading_banter:
        d0 = agent_duels[0]
        sym = d0["symbol"].replace("USDT", "")
        trading_banter = (
            f"⚔️ {d0['agent_a_name']} {d0['agent_a_direction']} vs "
            f"{d0['agent_b_name']} {d0['agent_b_direction']} · {sym} 对决进行中"
        )

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
        "sim_tick_interval_sec": SIM_TICK_INTERVAL_MS // 1000,
        "system_agents_note": "大厅内系统 Agent 为全局示范盘，资产仓库仅统计你的模拟账户",
        "first_trading_win": first_trading_win,
        "first_trade_hook": first_trade_hook,
        "latest_win": latest_win_trade,
        "trading_banter": trading_banter,
        "agent_duels": agent_duels,
    }


def apply_strategy_feedback(meta: dict, feedback: str) -> dict:
    """用户反馈微调策略 — 对标扑克 apply_style_feedback"""
    out = dict(meta)
    fb = (feedback or "").strip()
    if not fb:
        return out
    lev = int(out.get("leverage") or 5)
    th = float(out.get("threshold_pct") or out.get("thresholdPct") or 0.3)
    risk = out.get("risk") or "中"
    if any(k in fb for k in ("太保守", "太怂", "机会少", "不够激进")):
        lev = min(20, lev + 1)
        th = max(0.1, round(th - 0.05, 2))
        if risk == "低":
            risk = "中"
    if any(k in fb for k in ("太激进", "太浪", "亏太多", "杠杆太高")):
        lev = max(1, lev - 1)
        th = min(2.0, round(th + 0.05, 2))
        if risk in ("高", "极高"):
            risk = "中高"
    if any(k in fb for k in ("灵敏", "快一点", "信号慢")):
        th = max(0.1, round(th - 0.08, 2))
    if any(k in fb for k in ("稳一点", "少交易", "频率高")):
        th = min(2.0, round(th + 0.08, 2))
    out["leverage"] = lev
    out["threshold_pct"] = th
    out["thresholdPct"] = th
    out["risk"] = risk
    note = (out.get("desc") or "") + f" | 反馈:{fb[:60]}"
    out["desc"] = note[:200]
    return out


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


def apply_soul_trading_bias(preset: dict, meta: dict) -> dict:
    """SOUL 心理描述 → 轻量信号偏移（threshold / leverage）。"""
    soul = (meta.get("soulMd") or meta.get("soul_md") or "").lower()
    out = dict(preset)
    th = float(out.get("threshold_pct", 0.3))
    lev = int(out.get("leverage") or 5)
    tags: list[str] = []
    conservative = any(k in soul for k in ("保守", "稳健", "低风险", "纪律", "冷静", "观望", "稳一点"))
    aggressive = any(k in soul for k in ("激进", "冒险", "高波动", "冲动", "追涨", "快打"))
    if conservative and not aggressive:
        th = min(2.0, round(th + 0.05, 3))
        lev = max(1, lev - 1)
        tags.append("保守+阈值")
    elif aggressive and not conservative:
        th = max(0.1, round(th - 0.05, 3))
        lev = min(20, lev + 1)
        tags.append("激进-阈值")
    out["threshold_pct"] = th
    out["leverage"] = lev
    if tags:
        out["soul_bias_tags"] = tags
    return out


def effective_preset(preset_id: str, meta: dict) -> dict:
    """合并预设与用户微调参数 — 模拟盘实际执行用。"""
    p = dict(preset_for(preset_id))
    pid = meta.get("strategyPreset") or preset_id
    if pid == "custom" or preset_id == "custom":
        p["symbols"] = _custom_symbols(meta)
    if meta.get("leverage") is not None:
        p["leverage"] = max(1, min(20, int(meta["leverage"])))
    if meta.get("threshold_pct") is not None:
        p["threshold_pct"] = max(0.1, min(2.0, float(meta["threshold_pct"])))
    elif meta.get("thresholdPct") is not None:
        p["threshold_pct"] = max(0.1, min(2.0, float(meta["thresholdPct"])))
    if meta.get("max_positions") is not None:
        p["max_positions"] = max(1, min(5, int(meta["max_positions"])))
    if meta.get("risk"):
        p["risk"] = meta["risk"]
    return apply_soul_trading_bias(p, meta)


def _record_strategy_snapshot(meta: dict, row: dict) -> None:
    st = _parse_state(row.get("state_json") or "{}")
    capital = float(row.get("capital") or 0)
    initial = float(row.get("initial_capital") or 0)
    trades = st.get("trades_history") or []
    meta["strategySnapshot"] = {
        "applied_at": _now_iso(),
        "pnl": round(capital - initial, 2),
        "trades": len(trades),
        "wins": int(st.get("wins") or 0),
        "capital": round(capital, 2),
    }


def _parse_preference_rules(text: str) -> dict:
    """无 LLM 时的关键词兜底解析。"""
    t = text.lower()
    preset = "major"
    if any(k in text for k in ("黄金", "XAU", "xau")):
        preset = "xau"
    elif any(k in text for k in ("山寨", "Alt", "altcoin")):
        preset = "altcoin"
    elif any(k in text for k in ("新币", "打新", "newcoin")):
        preset = "newcoin"
    elif any(k in text for k in ("动量", "快打", "momentum")):
        preset = "momentum"
    elif any(k in text for k in ("主流", "btc", "eth", "major")):
        preset = "major"

    risk = "中"
    if any(k in text for k in ("保守", "低风险", "稳健")):
        risk = "低"
    elif any(k in text for k in ("激进", "高风险", "冒险")):
        risk = "高"
    elif "中高" in text:
        risk = "中高"

    leverage = 5
    import re
    m = re.search(r"(\d+)\s*[xX倍]?\s*杠杆|杠杆\s*(\d+)", text)
    if m:
        leverage = int(m.group(1) or m.group(2))

    threshold = None
    if any(k in text for k in ("灵敏", "敏感", "频繁")):
        threshold = 0.22
    elif any(k in text for k in ("稳健信号", "少交易", "低频")):
        threshold = 0.45

    market = ""
    if "eth" in t and "btc" not in t:
        market = "ETH"
    elif "btc" in t:
        market = "BTC"
    elif "sol" in t:
        market = "SOL"
    elif preset == "xau":
        market = "XAU"

    interval = ""
    if "5m" in t or "5分钟" in text:
        interval = "5m/15m"
    elif "1h" in t or "1小时" in text or "小时" in text:
        interval = "1h/4h"
    elif "15m" in t or "15分钟" in text:
        interval = "15m/1h"

    p = preset_for(preset)
    out = {
        "strategy_preset": preset,
        "strategy": p["strategy"],
        "market": market or p["market"],
        "interval": interval or p["interval"],
        "risk": risk,
        "leverage": leverage,
        "max_positions": 2,
    }
    if threshold is not None:
        out["threshold_pct"] = threshold
    if preset == "custom" or any(k in text for k in ("自定义", "自选")):
        out["strategy_preset"] = "custom"
        out["strategy"] = "自定义"
        out["market"] = market or "BTC"
    return out


async def parse_strategy_preference(text: str) -> dict:
    from life_game import _zhipu_key

    cleaned = (text or "").strip()
    if len(cleaned) < 4:
        return {"ok": False, "error": "请至少输入 4 个字描述你的偏好"}

    preset_ids = list(STRATEGY_PRESETS.keys())
    if not _zhipu_key:
        parsed = _parse_preference_rules(cleaned)
        return {"ok": True, "config": parsed, "source": "rules", "message": "已按关键词解析（未配置 LLM 时使用规则引擎）"}

    prompt = (
        "你是加密货币交易策略助手。用户用自然语言描述投资偏好，请输出唯一 JSON 对象，不要 markdown。\n"
        f"可选 strategy_preset: {preset_ids}\n"
        "字段: strategy_preset, strategy, market, interval, risk(低/中/中高/高), "
        "leverage(1-20整数), threshold_pct(0.15-0.8信号灵敏度,越小越灵敏), max_positions(1-3), "
        "soul_summary(可选,20字内交易人格描述)\n"
        f"用户: {cleaned}"
    )
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions",
                headers={"Authorization": f"Bearer {_zhipu_key}"},
                json={
                    "model": "glm-4-flash",
                    "messages": [
                        {"role": "system", "content": "只输出合法 JSON 对象，无其它文字。"},
                        {"role": "user", "content": prompt},
                    ],
                    "max_tokens": 400,
                },
                timeout=aiohttp.ClientTimeout(total=20),
            ) as resp:
                data = await resp.json()
                raw = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
                if raw.startswith("```"):
                    raw = raw.split("```")[1]
                    if raw.startswith("json"):
                        raw = raw[4:]
                parsed = json.loads(raw)
                pid = parsed.get("strategy_preset", "major")
                if pid not in STRATEGY_PRESETS:
                    pid = "custom"
                parsed["strategy_preset"] = pid
                if pid != "custom":
                    base = preset_for(pid)
                    parsed.setdefault("strategy", base["strategy"])
                    parsed.setdefault("market", base["market"])
                    parsed.setdefault("interval", base["interval"])
                    parsed.setdefault("risk", base["risk"])
                parsed["leverage"] = max(1, min(20, int(parsed.get("leverage") or preset_for(pid).get("leverage", 5))))
                if parsed.get("threshold_pct") is not None:
                    parsed["threshold_pct"] = max(0.1, min(2.0, float(parsed["threshold_pct"])))
                if parsed.get("max_positions") is not None:
                    parsed["max_positions"] = max(1, min(5, int(parsed["max_positions"])))
                return {"ok": True, "config": parsed, "source": "llm"}
    except Exception:
        pass
    parsed = _parse_preference_rules(cleaned)
    return {"ok": True, "config": parsed, "source": "rules", "message": "LLM 解析失败，已使用规则兜底"}


class StrategyBody(BaseModel):
    strategy_preset: str = "major"
    strategy: str = ""
    market: str = ""
    interval: str = ""
    risk: str = "中"
    leverage: Optional[int] = Field(None, ge=1, le=20)
    threshold_pct: Optional[float] = Field(None, ge=0.1, le=2.0)
    max_positions: Optional[int] = Field(None, ge=1, le=5)
    soul_md: Optional[str] = None


class PreferenceParseBody(BaseModel):
    preference_text: str = Field(..., min_length=4, max_length=500)


@router.get("/market/klines")
async def market_klines(
    symbol: str = "BTCUSDT",
    interval: str = "15m",
    limit: int = 80,
    account_id: str = Depends(resolve_account_id),
):
    from life_game import _validate_user_id

    _validate_user_id(account_id)
    sym = symbol.upper().strip()
    iv = interval.lower().strip()
    if iv not in VALID_KLINE_INTERVALS:
        iv = "15m"
    lim = max(20, min(200, int(limit)))
    async with aiohttp.ClientSession() as session:
        candles = await fetch_klines_ohlc(session, sym, iv, lim)
    return {"ok": True, "symbol": sym, "interval": iv, "candles": candles}


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
    if body.risk and preset_id != "custom":
        meta["risk"] = body.risk
    if body.leverage is not None:
        meta["leverage"] = body.leverage
    if body.threshold_pct is not None:
        meta["threshold_pct"] = round(body.threshold_pct, 3)
    if body.max_positions is not None:
        meta["max_positions"] = body.max_positions
    if body.soul_md is not None:
        meta["soulMd"] = body.soul_md.strip()
    row = life_db.get_agent_trading(uid, agent_id)
    if row:
        _record_strategy_snapshot(meta, row)
    custom[agent_id] = meta
    save_user(uid, user)
    if row:
        life_db.save_agent_trading(
            uid, agent_id,
            strategy_preset=preset_id,
            capital=float(row.get("capital") or 0),
            initial_capital=float(row.get("initial_capital") or 0),
            state_json=row.get("state_json") or "{}",
        )
    return {"ok": True, "agent": meta, "portfolio": await build_portfolio(uid, run_tick=False)}


class PreferenceParseBody(BaseModel):
    preference_text: str = Field(..., min_length=4, max_length=500)


class StrategyFeedbackBody(BaseModel):
    feedback_text: str = Field(..., min_length=2, max_length=300)


@router.post("/agents/{agent_id}/strategy/feedback")
async def strategy_feedback(agent_id: str, body: StrategyFeedbackBody, account_id: str = Depends(resolve_account_id)):
    from life_game import load_user, save_user, _validate_user_id

    uid = _validate_user_id(account_id)
    user = load_user(uid)
    custom = user.get("custom_agents") or {}
    meta = custom.get(agent_id)
    if not meta or meta.get("agentType") == "entertainment":
        return {"ok": False, "error": "须为交易 Agent"}
    updated = apply_strategy_feedback(meta, body.feedback_text)
    custom[agent_id] = updated
    save_user(uid, user)
    row = life_db.get_agent_trading(uid, agent_id)
    if row:
        life_db.save_agent_trading(
            uid, agent_id,
            strategy_preset=row.get("strategy_preset") or updated.get("strategyPreset") or "major",
            capital=float(row.get("capital") or 0),
            initial_capital=float(row.get("initial_capital") or 0),
            state_json=row.get("state_json") or "{}",
        )
    return {
        "ok": True,
        "agent": updated,
        "message": "已根据反馈微调杠杆/灵敏度/风控",
        "portfolio": await build_portfolio(uid, run_tick=False),
    }


@router.post("/agents/{agent_id}/strategy/parse-preference")
async def parse_preference(agent_id: str, body: PreferenceParseBody, account_id: str = Depends(resolve_account_id)):
    from life_game import load_user, _validate_user_id

    uid = _validate_user_id(account_id)
    user = load_user(uid)
    if agent_id not in (user.get("custom_agents") or {}):
        return {"ok": False, "error": "Agent 不存在"}
    return await parse_strategy_preference(body.preference_text)
