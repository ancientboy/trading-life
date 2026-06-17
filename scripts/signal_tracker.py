"""
信号追踪器 - 记录每次筛选出的候选币，追踪后续走势

功能：
1. 记录每次筛选结果（时间、币种、评分、理由、当时价格）
2. 4h/8h/24h后自动对比实际涨幅
3. 统计准确率（命中率、平均涨幅、盈亏比）
4. 生成追踪报告

数据格式：
{
    "version": 1,
    "signals": [
        {
            "id": "20260516-093800-BTCUSDT",
            "timestamp": "2026-05-16T01:38:00Z",
            "symbol": "BTCUSDT",
            "action": "LONG",
            "score": 84,
            "confidence": 95,
            "entry_price": 81200.0,
            "reasoning": "三周期共振+波浪二浪回调",
            "key_factors": ["StochRSI三周期共振", "4h uptrend"],
            "wave_signal": "wave3_starting",
            "status": "pending",    # pending → checked
            "checks": {
                "4h": {"price": 81500, "change_pct": 0.37, "hit": true, "max_change_pct": 0.8},
                "8h": {"price": 80900, "change_pct": -0.37, "hit": false, "max_change_pct": 0.8},
                "24h": null  # 还没到
            },
            "final_result": null  # "win" / "loss" / null
        }
    ],
    "stats": {
        "total_signals": 0,
        "checked_4h": 0,
        "hit_4h": 0,
        "checked_24h": 0,
        "hit_24h": 0,
        "avg_change_24h": 0,
        "win_rate_4h": 0,
        "win_rate_24h": 0
    }
}
"""

import json
import time
import logging
import asyncio
import aiohttp
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict

import sys
sys.path.insert(0, str(Path(__file__).parent))
from config import DATA_DIR

logger = logging.getLogger("SignalTracker")

TRACKER_FILE = DATA_DIR / "signal_tracker.json"
HIT_THRESHOLD_PCT = 0.5  # 涨幅>=0.5%算命中


def _load_data() -> dict:
    if TRACKER_FILE.exists():
        try:
            return json.loads(TRACKER_FILE.read_text())
        except:
            pass
    return {"version": 1, "signals": [], "stats": _empty_stats()}


def _save_data(data: dict):
    TRACKER_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2))


def _empty_stats() -> dict:
    return {
        "total_signals": 0,
        "checked_4h": 0, "hit_4h": 0,
        "checked_8h": 0, "hit_8h": 0,
        "checked_24h": 0, "hit_24h": 0,
        "avg_change_4h": 0, "avg_change_8h": 0, "avg_change_24h": 0,
        "win_rate_4h": 0, "win_rate_8h": 0, "win_rate_24h": 0,
        # v21: 按入场类型分组的统计
        "by_entry_type": {
            "volume_breakout": {"count": 0, "checked_24h": 0, "hit_24h": 0, "avg_change_24h": 0, "win_rate_24h": 0},
            "pullback_confirmed": {"count": 0, "checked_24h": 0, "hit_24h": 0, "avg_change_24h": 0, "win_rate_24h": 0},
            "wave_entry": {"count": 0, "checked_24h": 0, "hit_24h": 0, "avg_change_24h": 0, "win_rate_24h": 0},
            "other": {"count": 0, "checked_24h": 0, "hit_24h": 0, "avg_change_24h": 0, "win_rate_24h": 0},
        }
    }


def record_signal(
    symbol: str,
    action: str,
    score: int,
    confidence: int,
    entry_price: float,
    reasoning: str = "",
    key_factors: list = None,
    wave_signal: str = "",
    entry_type: str = "",
    consolidation_score: int = 0,
    breakout_stage: int = 0,
) -> str:
    """记录一个新信号，返回信号ID
    
    entry_type:
        "volume_breakout" - 放量突破直接入场
        "pullback_confirmed" - 回调站稳确认入场
        "wave_entry" - 波浪分析入场（非横盘突破）
        "other" - 其他
    """
    data = _load_data()
    
    # ★ v21: 去重 — 同一币种2小时内不重复记录
    now = datetime.now(timezone.utc)
    for existing in reversed(data["signals"][-10:]):
        if existing["symbol"] == symbol and existing.get("entry_type") == (entry_type or "other"):
            try:
                prev_time = datetime.fromisoformat(existing["timestamp"])
                if (now - prev_time).total_seconds() < 7200:  # 2小时
                    logger.debug(f"去重: {symbol} {entry_type} 2小时内已有记录")
                    return existing["id"]
            except:
                pass
    sig_id = f"{now.strftime('%Y%m%d-%H%M%S')}-{symbol}"
    
    signal = {
        "id": sig_id,
        "timestamp": now.isoformat(),
        "symbol": symbol,
        "action": action,
        "score": score,
        "confidence": confidence,
        "entry_price": entry_price,
        "reasoning": reasoning[:200],
        "key_factors": key_factors or [],
        "wave_signal": wave_signal,
        "entry_type": entry_type or "other",  # v21: 入场类型
        "consolidation_score": consolidation_score,
        "breakout_stage": breakout_stage,
        "status": "pending",
        "checks": {},
        "final_result": None,
    }
    
    data["signals"].append(signal)
    data["stats"]["total_signals"] = len(data["signals"])
    
    # 只保留最近200条
    if len(data["signals"]) > 200:
        data["signals"] = data["signals"][-200:]
    
    _save_data(data)
    logger.info(f"📝 信号追踪: {sig_id} {action} @${entry_price:,.4f}")
    return sig_id


async def check_signals(session: aiohttp.ClientSession = None):
    """检查所有pending信号的后续走势"""
    data = _load_data()
    now = datetime.now(timezone.utc)
    updated = False
    
    close_session = False
    if session is None:
        session = aiohttp.ClientSession()
        close_session = True
    
    try:
        for sig in data["signals"]:
            if sig["status"] != "pending":
                continue
            
            sig_time = datetime.fromisoformat(sig["timestamp"])
            elapsed = (now - sig_time).total_seconds() / 3600  # 小时
            
            if elapsed < 4:
                continue
            
            symbol = sig["symbol"]
            entry_price = sig["entry_price"]
            
            if entry_price <= 0:
                continue  # 跳过无效价格
            
            # 获取当前价格
            current_price = await _get_price(session, symbol)
            if current_price <= 0:
                continue
            
            change_pct = (current_price / entry_price - 1) * 100
            
            # 4h 检查
            if elapsed >= 4 and "4h" not in sig["checks"]:
                sig["checks"]["4h"] = {
                    "price": current_price,
                    "change_pct": round(change_pct, 2),
                    "hit": change_pct >= HIT_THRESHOLD_PCT,
                    "checked_at": now.isoformat(),
                }
                updated = True
                logger.info(f"📊 追踪4h: {symbol} {change_pct:+.2f}% {'✅命中' if change_pct >= HIT_THRESHOLD_PCT else '❌未命中'}")
            
            # 8h 检查
            if elapsed >= 8 and "8h" not in sig["checks"]:
                sig["checks"]["8h"] = {
                    "price": current_price,
                    "change_pct": round(change_pct, 2),
                    "hit": change_pct >= HIT_THRESHOLD_PCT,
                    "checked_at": now.isoformat(),
                }
                updated = True
            
            # 24h 检查
            if elapsed >= 24 and "24h" not in sig["checks"]:
                sig["checks"]["24h"] = {
                    "price": current_price,
                    "change_pct": round(change_pct, 2),
                    "hit": change_pct >= HIT_THRESHOLD_PCT,
                    "checked_at": now.isoformat(),
                }
                sig["status"] = "checked"
                sig["final_result"] = "win" if change_pct >= HIT_THRESHOLD_PCT else "loss"
                updated = True
                logger.info(f"📊 追踪24h: {symbol} {change_pct:+.2f}% → {'🏆盈利' if change_pct >= HIT_THRESHOLD_PCT else '💀亏损'}")
    finally:
        if close_session:
            await session.close()
    
    if updated:
        data["stats"] = _calc_stats(data["signals"])
        _save_data(data)
    
    return updated


async def _get_price(session: aiohttp.ClientSession, symbol: str) -> float:
    """获取当前价格"""
    for url in [
        f"https://fapi.binance.com/fapi/v1/ticker/price?symbol={symbol}",
        f"https://api.binance.com/api/v3/ticker/price?symbol={symbol}",
    ]:
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                result = await resp.json()
                price = float(result.get("price", 0))
                if price > 0:
                    return price
        except:
            continue
    return 0


def _calc_stats(signals: list) -> dict:
    stats = _empty_stats()
    stats["total_signals"] = len(signals)
    
    changes_4h, changes_8h, changes_24h = [], [], []
    
    # v21: 按入场类型分组
    by_type = {
        "volume_breakout": {"changes": []},
        "pullback_confirmed": {"changes": []},
        "structure_breakout": {"changes": []},
        "wave_pullback": {"changes": []},
        "prelaunch_ambush": {"changes": []},
        "watch_pool_breakout": {"changes": []},
        "oversold_bounce": {"changes": []},
        "other": {"changes": []},
    }
    
    for sig in signals:
        et = sig.get("entry_type", "other")
        if et not in by_type:
            et = "other"
        
        for period, changes_list in [("4h", changes_4h), ("8h", changes_8h), ("24h", changes_24h)]:
            check = sig.get("checks", {}).get(period)
            if check:
                changes_list.append(check["change_pct"])
                if period == "24h":
                    by_type[et]["changes"].append(check["change_pct"])
    
    if changes_4h:
        stats["checked_4h"] = len(changes_4h)
        stats["hit_4h"] = sum(1 for c in changes_4h if c >= HIT_THRESHOLD_PCT)
        stats["win_rate_4h"] = round(stats["hit_4h"] / len(changes_4h) * 100, 1)
        stats["avg_change_4h"] = round(sum(changes_4h) / len(changes_4h), 2)
    
    if changes_8h:
        stats["checked_8h"] = len(changes_8h)
        stats["hit_8h"] = sum(1 for c in changes_8h if c >= HIT_THRESHOLD_PCT)
        stats["win_rate_8h"] = round(stats["hit_8h"] / len(changes_8h) * 100, 1)
        stats["avg_change_8h"] = round(sum(changes_8h) / len(changes_8h), 2)
    
    if changes_24h:
        stats["checked_24h"] = len(changes_24h)
        stats["hit_24h"] = sum(1 for c in changes_24h if c >= HIT_THRESHOLD_PCT)
        stats["win_rate_24h"] = round(stats["hit_24h"] / len(changes_24h) * 100, 1)
        stats["avg_change_24h"] = round(sum(changes_24h) / len(changes_24h), 2)
    
    # v21: 按入场类型统计
    type_names = {
        "volume_breakout": "放量突破",
        "pullback_confirmed": "回调确认",
        "structure_breakout": "结构突破",
        "wave_pullback": "波浪回调",
        "prelaunch_ambush": "提前埋伏",
        "watch_pool_breakout": "监控池突破",
        "oversold_bounce": "超卖反弹",
        "other": "其他",
    }
    for et, data in by_type.items():
        changes = data["changes"]
        if changes:
            stats["by_entry_type"][et] = {
                "name": type_names.get(et, et),
                "count": len([s for s in signals if s.get("entry_type", "other") == et]),
                "checked_24h": len(changes),
                "hit_24h": sum(1 for c in changes if c >= HIT_THRESHOLD_PCT),
                "avg_change_24h": round(sum(changes) / len(changes), 2),
                "win_rate_24h": round(sum(1 for c in changes if c >= HIT_THRESHOLD_PCT) / len(changes) * 100, 1),
            }
    
    return stats


def get_report() -> str:
    """生成追踪报告"""
    data = _load_data()
    stats = data.get("stats", _empty_stats())
    
    lines = []
    lines.append("📊 **信号追踪报告**")
    lines.append(f"总信号数: {stats.get('total_signals', 0)}")
    lines.append("")
    
    for period in ["4h", "8h", "24h"]:
        checked = stats.get(f"checked_{period}", 0)
        hit = stats.get(f"hit_{period}", 0)
        wr = stats.get(f"win_rate_{period}", 0)
        avg = stats.get(f"avg_change_{period}", 0)
        if checked > 0:
            lines.append(f"**{period}追踪**: 检查{checked}条 | 命中{hit} | 胜率{wr}% | 平均涨幅{avg:+.2f}%")
    
    # v21: 按入场类型分组统计
    by_type = stats.get("by_entry_type", {})
    has_type_data = any(v.get("checked_24h", 0) > 0 for v in by_type.values())
    if has_type_data:
        lines.append("")
        lines.append("**按入场类型(24h)**:")
        for et, ts in by_type.items():
            if ts.get("checked_24h", 0) > 0:
                name = ts.get("name", et)
                wr = ts.get("win_rate_24h", 0)
                avg = ts.get("avg_change_24h", 0)
                cnt = ts.get("checked_24h", 0)
                hit = ts.get("hit_24h", 0)
                lines.append(f"  {name}: {cnt}条 | 命中{hit} | 胜率{wr}% | 平均{avg:+.2f}%")
    
    # 最近5条信号
    recent = data.get("signals", [])[-5:]
    if recent:
        lines.append("")
        lines.append("**最近信号**:")
        for sig in reversed(recent):
            status_emoji = {"pending": "⏳", "checked": "✅" if sig.get("final_result") == "win" else "❌"}.get(sig.get("status", "pending"), "❓")
            checks_str = ""
            for p, c in sig.get("checks", {}).items():
                emoji = "📈" if c["change_pct"] >= 0 else "📉"
                checks_str += f" {p}:{c['change_pct']:+.1f}%{emoji}"
            et = sig.get("entry_type", "")
            et_tag = f"[{et}]" if et else ""
            lines.append(
                f"{status_emoji} {sig['symbol']} {sig['action']} "
                f"得分={sig['score']} {et_tag} @${sig['entry_price']:,.4f}"
                f"{checks_str}"
            )
    
    return "\n".join(lines)


def get_pending_signals_for_push(limit: int = 5) -> list:
    """获取最近的pending信号（用于推送）"""
    data = _load_data()
    pending = [s for s in data["signals"] if s["status"] == "pending"]
    return pending[-limit:]


# ============================================
# 单独运行：检查所有pending信号
# ============================================
async def run_check():
    """检查所有pending信号"""
    async with aiohttp.ClientSession() as session:
        updated = await check_signals(session)
        if updated:
            print(get_report())
        else:
            print("无新信号需要检查")


if __name__ == "__main__":
    import sys
    if "--report" in sys.argv:
        print(get_report())
    else:
        asyncio.run(run_check())
